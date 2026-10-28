# @caplaz/eufy-stream-server

Serve Eufy camera video from an `EufyWebSocketClient` on two TCP endpoints:

| Endpoint | Format                                                                   | Address                                                            |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Raw      | Annex-B H.264 or H.265/HEVC video, without audio                         | Configured `host` and `port`; read the bound port with `getPort()` |
| Muxed    | Fragmented MP4 containing H.264/H.265 video and AAC audio when available | Random port on `127.0.0.1`; read it with `getMuxedPort()`          |

The muxed endpoint uses one in-process JMuxer per connection. It remuxes video and ADTS AAC from WebSocket events without an FFmpeg subprocess or re-encoding. Consumers still need decoder support for the camera's codec.

## Quick start

Install the package and connect to a running [eufy-security-ws server](../../docker/README.md). Camera authentication and driver setup belong to the WebSocket server/client; see the [client README](../eufy-security-client/README.md).

```bash
npm install @caplaz/eufy-stream-server @caplaz/eufy-security-client tslog
```

This example requires an already authenticated Eufy driver. Complete login, CAPTCHA, or verification-code handling using the client guide before running it.

```typescript
import { EufyWebSocketClient } from "@caplaz/eufy-security-client";
import { StreamServer } from "@caplaz/eufy-stream-server";
import { Logger, type ILogObj } from "tslog";

const logger = new Logger<ILogObj>({ minLevel: 3 });
const client = new EufyWebSocketClient("ws://localhost:3000", logger);
await client.connect();
// The socket can open before schema negotiation finishes.
const readyDeadline = Date.now() + 10000;
while (!client.isConnected()) {
  if (Date.now() >= readyDeadline) {
    client.disconnect();
    throw new Error("WebSocket schema negotiation timed out");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
// Subscribe before any authentication flow; this example requires prior login.
await client.startListening();
if (!(await client.commands.driver().isConnected()).connected) {
  client.disconnect();
  throw new Error("Authenticate the Eufy driver using the client guide first");
}

const server = new StreamServer({
  wsClient: client,
  serialNumber: "YOUR_CAMERA_SERIAL",
  host: "127.0.0.1",
  port: 0, // Let the OS choose the raw port too.
  logger,
});
server.on("error", (error) => logger.error(error));
server.on("streamError", (error) => logger.error(error));
await server.start();

console.log(`Raw video: tcp://127.0.0.1:${server.getPort()}`);
console.log(`Muxed MP4: tcp://127.0.0.1:${server.getMuxedPort()}`);

process.once("SIGINT", async () => {
  await server.stop();
  client.disconnect();
});
```

Use the printed ports with FFmpeg or FFplay. For example:

```bash
# Replace RAW_PORT and MUXED_PORT with the values printed above.
ffplay -f h264 tcp://127.0.0.1:RAW_PORT
# For raw HEVC, use -f hevc instead of -f h264.
ffplay -f mp4 tcp://127.0.0.1:MUXED_PORT
```

A connection starts the camera stream when needed. Calling `start()` alone opens the listeners without requesting camera video. Await `start()` before reading both ports: the `started` event fires when the raw listener opens, before the muxed listener is ready.

## Stream lifecycle and 0.4.1 behavior

- Consumers include raw clients, active/pending muxed clients, snapshot requests, and metadata bootstrap holds. They keep the upstream stream needed; `getActiveConnectionCount()` counts raw clients only.
- Disconnecting the last viewer does **not** immediately stop the camera. The activity monitor checks every 5 seconds and stops an unused stream after more than 12 seconds without consumer activity. A snapshot that started its own stream uses an 8-second post-snapshot linger when no consumers remain.
- Raw clients receive cached parameter sets on connect. In 0.4.1, new muxers are also primed with cached SPS/PPS for H.264 or VPS/SPS/PPS for H.265. This lets them initialize without waiting for the next repeated parameter sets; a decoder can still need the next keyframe to display a picture.
- A camera reporting `videoFPS: 0` now uses the intended 15fps muxer fallback instead of JMuxer's 30fps default. A nonzero advertised rate is retained.
- Audio capability is detected from ADTS AAC samples for each session. The muxer briefly probes for audio; cameras without usable audio use video-only output. A `both` muxer that emits nothing for 4 seconds is rebuilt video-only. The raw endpoint always excludes audio.
- Optional station-slot coordination prevents overlapping P2P streams on one HomeBase. A revoked stream stops before its lease is released. Existing preempted consumers remain suppressed until they drain. The 0.4.1 fix clears suppression for an already idle stream and serializes new consumers behind its teardown, allowing later viewers to obtain a fresh grant.
- An upstream `device_livestream_already_running` start error is treated as success, while the no-data watchdog still checks that video arrives. `upstreamWedged` lets the integrating application arrange station recovery; the server does not itself restart the Docker service.

## Configuration

`StreamServerOptions` is exported from the package root.

| Option              | Default                              | Meaning                                                                                                             |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `wsClient`          | Required                             | Connected `EufyWebSocketClient`                                                                                     |
| `serialNumber`      | Required                             | Camera serial used to filter video/audio events                                                                     |
| `port`              | `8080`                               | Raw TCP port; `0` requests an available port                                                                        |
| `host`              | `"0.0.0.0"`                          | Raw listener bind address                                                                                           |
| `maxConnections`    | `10`                                 | Maximum concurrent raw TCP clients; does not cap muxed sockets                                                      |
| `logger`            | Internal tslog logger, `minLevel: 3` | Optional `Logger<ILogObj>`; use `minLevel: 2` for debug logs                                                        |
| `initialVideoCodec` | No public metadata hint              | Optional `"H264"` or `"H265"` hint until live metadata arrives; muxer timeout fallback is H.264 when no hint exists |
| `acquireStreamSlot` | No coordination                      | Optional `(priority: "live" \| "background", onRevoke: () => void) => lease \| null`                                |

A station lease provides `release()`, `readonly active`, `readonly whenReady: Promise<void>`, and `markDelivering()`. Its `whenReady` gates starting after another camera yields. The integrating coordinator decides whether to grant or reject an acquisition. See the [Scrypted coordinator](../eufy-security-scrypted/src/utils/station-stream-coordinator.ts) for the shared HomeBase policy.

## Snapshots and metadata

`captureSnapshot(timeoutMs = 15000)` starts streaming if needed and waits for a **new** IDR/IRAP keyframe. It returns an Annex-B `Buffer` with available cached parameter sets prepended, not JPEG data. The timeout applies to waiting for the keyframe after upstream setup. Convert the buffer with a codec-aware tool such as FFmpeg.

`getCachedKeyframe(maxAgeMs)` is the separate, synchronous cache path. It returns `{ data, codec, ageMs }` or `null`, does not wake the camera, and does not refresh an expired cache. `captureSnapshot()` does not automatically serve this cache.

```typescript
import { writeFile } from "node:fs/promises";

// With the server from the quick-start example already started:
const cached = server.getCachedKeyframe(30000);
const data = cached?.data ?? (await server.captureSnapshot(30000));
await writeFile("snapshot.annexb", data);
// H.264: ffmpeg -f h264 -i snapshot.annexb -frames:v 1 snapshot.jpg
// H.265: ffmpeg -f hevc -i snapshot.annexb -frames:v 1 snapshot.jpg
```

`getVideoMetadata()` returns the captured record, a codec hint with zero width/height/fps, or `null`. A stored record can belong to an earlier session; use `isMetadataVerifiedForCurrentSession()` when freshness matters. `waitForVideoMetadata(timeoutMs = 10000, { signal }?)` waits for current-session video metadata but does not itself start streaming.

For callers that need to wake the camera before opening a socket, `acquireMetadataWaiter(timeoutMs = 10000)` returns `{ promise, release, cancel }`. Await `promise`, then call `release()` after handing off to a real consumer; `cancel()` also releases the hold. On timeout the server can retain a short warm bootstrap hold, so a timeout does not imply immediate camera shutdown.

## API and events

| Method                                               | Return / purpose                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `start()` / `stop()`                                 | `Promise<void>`; open listeners / stop upstream and clean up listeners, sockets, timers, and protocol subscriptions |
| `getPort()` / `getMuxedPort()`                       | `number \| undefined`; actual listener ports                                                                        |
| `isRunning()`                                        | `boolean`; raw listener active state                                                                                |
| `getActiveConnectionCount()`                         | Number of raw clients                                                                                               |
| `getStats()` / `resetStats()`                        | `ServerStats` / reset streaming counters                                                                            |
| `streamVideo(data: Buffer, timestamp?, isKeyFrame?)` | `Promise<boolean>`; parse/cache raw video and broadcast it to raw clients; does not feed muxers or start upstream   |
| `getAudioStatus()`                                   | `"unknown" \| "aac" \| "none"`                                                                                      |
| `setCachedKeyframe(data, codec)`                     | Seed an empty keyframe cache; codec is `"H264" \| "H265"`, timestamp becomes now                                    |
| `holdWarmLease(ms = 60000)`                          | Request a temporary background bootstrap hold                                                                       |
| `onNextConsumerAttached(callback)`                   | Register a one-shot callback for the next raw/muxed consumer; returns its removal function                          |
| `setRecycleInFlight(value: boolean)`                 | Defer upstream starts during externally managed station recovery; rearm waiting consumers when cleared              |

`ServerStats` has `isActive`, `port`, `uptime` in milliseconds, `connections: { active, total, connections }`, and `streaming: { framesProcessed, bytesTransferred, lastFrameTime }`. Connection statistics describe the raw endpoint; use `getPort()` for an OS-assigned port rather than the configured `stats.port`.

| Event                                    | Arguments                                                          |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `started`, `stopped`                     | None                                                               |
| `clientConnected`                        | `connectionId, connectionInfo` for a raw client                    |
| `clientDisconnected`                     | `connectionId` for a raw client                                    |
| `videoStreamed`                          | `{ data, timestamp, isKeyFrame }`                                  |
| `metadataReceived`                       | Video metadata from a session's first metadata-bearing video event |
| `livestreamActive`, `livestreamInactive` | `{ serialNumber }`; confirmed upstream video state changes         |
| `upstreamWedged`                         | `{ serialNumber, reason, attempts?, staleMs?, consumers? }`        |
| `streamError`                            | Processing/upstream error                                          |
| `error`                                  | TCP listener error                                                 |

The package root exports `StreamServer`, `ConnectionManager`, `H264Parser`, and types `StreamServerOptions`, `StreamData`, `ConnectionInfo`, `ServerStats`, and `NALUnit`. `VideoMetadata` comes from `@caplaz/eufy-security-client`. Lease and metadata-waiter shapes can be inferred from the options/methods; they are not root type exports.

`H264Parser` accepts a tslog logger. It provides `extractNALUnits`, `isKeyFrame`, `validateH264Data`, and `getNALTypeName` for H.264, plus `extractNALUnitsHevc`, `isKeyFrameHevc`, `validateHevcData`, and `getNALTypeNameHevc` for H.265. Extracted NAL units have `type`, `data`, and `isKeyFrame`; use the name lookup methods for display names.

Additional root exports support the plugin's compatibility path: `H264CompatibilityRelay`, its shared relay helpers, `CompatibilityEncoderPool`, `CompatibilityEncoderCapacityError`, `ThermalGovernor`, and fMP4 box helpers. See [the source exports](src/index.ts) for their associated exported types and [the plugin README](../eufy-security-scrypted/README.md) for integration behavior.

## Troubleshooting

- Check the WebSocket server connection, camera serial, and Eufy device availability first. Battery cameras can take longer to wake than an always-powered camera.
- For silent muxed output, confirm the live codec, audio status, and `streamError` logs. Video-only output is expected when no usable ADTS audio arrives.
- For snapshots, select the correct raw input codec when converting to JPEG. Increasing the snapshot timeout does not disable upstream watchdog/recovery policy.
- Bind the raw endpoint explicitly to `127.0.0.1` for local consumers. The muxed endpoint is always local.
- Call `stop()` before disconnecting the WebSocket client so upstream teardown can complete.

## Development

From this package directory, run `npm run build`, `npm test`, or `npm run lint`. See the [root README](../../README.md) for the monorepo workflow.

[MIT license](../../LICENSE).
