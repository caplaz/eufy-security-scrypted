# Eufy Security Scrypted Plugin

![Eufy Security Plugin](https://raw.githubusercontent.com/caplaz/eufy-security-scrypted/main/packages/eufy-security-scrypted/public/banner.png)

Connect supported Eufy devices to Scrypted through `eufy-security-ws`. The plugin provides video, snapshots, motion and doorbell events, station security controls, and device controls where supported by the upstream API. Device and firmware compatibility varies; check live playback in Scrypted before configuring other consumers.

## Installation

1. Start the companion WebSocket server using the [Docker guide](../../docker/README.md). This repository targets `bropat/eufy-security-ws:3.1.0` (API schema 21).
2. Install **@caplaz/eufy-security-scrypted** in Scrypted's plugin installer.
3. Enter a **WebSocket URL** reachable from Scrypted; the default is `ws://localhost:3000`.
4. Use **Connect to Eufy Cloud** in plugin settings and follow any CAPTCHA or 2FA prompts. Credentials are configured on the companion server.

If Scrypted is containerized, `localhost` is that container. On a shared Docker network, use the companion service name, for example `ws://eufy-security-ws:3000`; otherwise use a reachable host address.

### Companion server example

```yaml
services:
  eufy-security-ws:
    image: bropat/eufy-security-ws:3.1.0
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      USERNAME: ${EUFY_EMAIL}
      PASSWORD: ${EUFY_PASSWORD}
      PORT: "3000"
      LOG_LEVEL: info
    restart: unless-stopped
```

Set `EUFY_EMAIL` and `EUFY_PASSWORD` in your environment or a local `.env` file, then run `docker compose up -d`. Keep credentials out of source control. Preserve the data volume across container recreation.

## Settings

| Location           | Setting                                 | Behavior                                                                                        |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Plugin             | WebSocket URL                           | Address of the companion server                                                                 |
| Plugin             | Debug Logging                           | Detailed connection, command, and stream diagnostics                                            |
| Plugin             | Current Memory Usage                    | Read-only process RSS; there is no configurable memory threshold or threshold-triggered cleanup |
| Plugin             | Maximum Compatibility Encoders          | Shared H.265-to-H.264 encoder capacity; default 1                                               |
| Plugin             | Encoder Critical / Recovery Temperature | Defaults 85 °C / 75 °C; gate new compatibility encoders                                         |
| Camera → Streaming | H.264 Compatibility Mode                | `Auto` (default), `Force`, or `Native`; see routing below                                       |
| Camera → Streaming | Background Thumbnail Refresh            | `Off`, 30 minutes, 1 hour, 2 hours (default), or 4 hours                                        |

Other device settings are generated from the properties and metadata exposed by the server. Available controls differ by model.

## Video, audio, and snapshots

The plugin receives decrypted livestream data over WebSocket and exposes local TCP inputs to Scrypted/FFmpeg. The normal muxed path produces fragmented MP4 with native H.264 or H.265 video and usable ADTS AAC audio. Cameras without usable audio can use video-only output. Audio channels, resolution, frame rate, and startup time depend on the device and upstream session.

Several viewers can share a camera's stream. A shared HomeBase is coordinated as a single camera-stream slot: a live request may preempt another camera after its warm-up guard, while background thumbnail work never interrupts a holder. Opening many battery cameras at once can therefore cause contention. When consumers leave, the upstream session can linger briefly rather than stopping on every Rebroadcast reconnect.

Snapshots use the last cached keyframe, converted to JPEG. They do not wake the camera on demand; before any cached frame exists, the plugin returns a placeholder. A stale snapshot does not prove that a live stream is currently working. Background Thumbnail Refresh can wake an idle camera when its HomeBase slot is free, trading battery use for fresher tiles. Choose `Off` or a longer interval for battery/LTE cameras.

### 0.4.1 reliability fixes

- New muxers receive cached parameter sets immediately, so attaching between keyframes no longer waits for another keyframe just to initialize the muxer.
- Cameras reporting zero FPS use the intended 15fps fallback; reported nonzero frame rates are retained.
- An already-running upstream stream is accepted after a stale status check, while no-data monitoring remains active.
- An idle camera can recover after another camera revokes its HomeBase slot. Teardown completes before a new viewer acquires a replacement lease.

See the [release notes and contributor credits](../../CHANGELOG.md#041---2026-10-28).

## Native and compatibility streams

The plugin exposes two stable P2P stream contracts:

| Stream ID  | Contract                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p2p`      | Native P2P video. It does not start a compatibility encoder and reports the camera's actual verified codec (`H264` or `H265`); an H.265 source is never relabelled as H.264. |
| `p2p-h264` | Compatibility video. It is available only after a verified H.265 source is admitted to the compatibility encoder, and its output contract is H.264.                          |

An explicit `p2p` request is always native, regardless of mode. An explicit
`p2p-h264` request is strict: it fails with an actionable selection error when
the source codec is not verified H.265 or an encoder cannot be admitted. It
never silently falls back to `p2p`.

| Mode     | Default routing behavior                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Auto`   | Uses `p2p-h264` only for a verified H.265 source sent to an interactive local or remote live-view destination and only when an encoder is available. All other destinations, including local and remote recorders, remain native. Unknown or unverified codecs remain native; the plugin does not guess. |
| `Force`  | Uses compatibility H.264 for a verified H.265 source. A verified native H.264 source remains native. Missing codec verification or unavailable encoder capacity returns an error instead of guessing or relabelling the stream.                                                                          |
| `Native` | Always uses `p2p`; no compatibility encoder is requested.                                                                                                                                                                                                                                                |

### Capacity, prebuffer, and thermal admission

Each active compatibility transcode consumes one encoder slot and CPU capacity.
Plan capacity for the sum of continuously running compatibility prebuffers and
the peak number of interactive compatibility viewers, rather than only the
number of cameras. A continuous prebuffer holds its encoder slot and CPU for
as long as it is enabled.

Except for a continuous compatibility prebuffer, a compatibility encoder is
created only for an active consumer and may remain during the configured
post-consumer linger. It is not kept running outside that lifecycle. Native
`p2p` streams never consume a compatibility encoder slot.

The thermal governor gates new compatibility encoder admissions at 85 °C and
allows new admissions again only at or below 75 °C (with admission-triggered
sampling at most once every 30 seconds). It deliberately does not terminate an
encoder that is already running. When the host does not expose a usable
temperature reading, or reading it fails, the gate is inert, so it is a safety
limit rather than a guarantee that every platform will prevent overheating.

## Device capabilities and limitations

- Cameras expose video, snapshots, and motion state. Pan/tilt, floodlight brightness, battery state, and intercom appear only when the corresponding capability or upstream command is available.
- Doorbell rings and entry sensors use `BinarySensor`; motion sensors use `MotionSensor`. Non-camera devices are not automatically exposed as cameras.
- Locks can expose settings and refresh, but the Scrypted `Lock` interface is not currently advertised. Temperature sensor names in upstream detection do not guarantee a Scrypted temperature interface.
- Clip retrieval has station-database/P2P and cloud paths; actual availability depends on the device, storage, and server support.
- HomeKit integration uses Scrypted's HomeKit plugin. HomeKit needs H.264 video; an explicitly selected native H.265 stream remains H.265 even in `Force` mode. Select `p2p-h264` explicitly where available when a consumer needs that contract.
- Direct RTSP URL selection and the broader cold-start/codec changes proposed in PRs #41 and #45 are not part of 0.4.1.
- Upstream decryption failures occur inside the companion server before this plugin receives video; muxer or compatibility settings cannot repair missing decrypted frames.

## Troubleshooting

### No connection or devices

Check the WebSocket URL from Scrypted's network, the companion container logs, and the plugin's **Account Connection Status** and **Connection State**. A WebSocket connection alone does not establish that cloud authentication succeeded. Use **Connect to Eufy Cloud** and complete any authentication challenge.

### Black live view, repeated restarts, or stale tiles

1. Confirm the camera can stream in the Eufy app and close other active viewers while isolating the issue.
2. Enable plugin **Debug Logging**. Capture one fresh live-view attempt with matching companion-server timestamps.
3. Look for slot grants/revokes, start/stop acknowledgments, first video metadata/data, muxer output/fallback, and station-recycle lines. Cached snapshots and codec hints alone do not establish that new frames arrived.
4. For an H.265 camera, compare native playback with the compatibility stream. Compatibility conversion consumes host CPU and is subject to capacity and temperature admission.
5. For a shared HomeBase failure, include the camera-switch sequence and logs from both cameras.

Report the device and HomeBase models, firmware, plugin/Scrypted/eufy-security-ws versions, compatibility mode, and reproduction steps in a [GitHub issue](https://github.com/caplaz/eufy-security-scrypted/issues). Redact credentials and private media; replace serial numbers consistently so the handoff remains traceable.

## Security and deployment

Eufy cloud authentication and device communication run in the companion server. This is not a cloud-free integration. The default `ws://` connection and local TCP media inputs are unencrypted; use a trusted network or provide appropriate transport protection. The plugin itself does not automatically add TLS.

## Development and verification

From the repository root:

```bash
npm ci
npm run build
npm run test
npm run lint
npm run format:check

# Target the plugin
npm test --workspace=@caplaz/eufy-security-scrypted
npm run typecheck --workspace=@caplaz/eufy-security-scrypted

# Build the publishable plugin archive and inspect its package
NODE_ENV=production npm run build --workspace=@caplaz/eufy-security-scrypted
npm pack --dry-run --ignore-scripts --workspace=@caplaz/eufy-security-scrypted
```

The npm package must contain `dist/plugin.zip`; ordinary development builds write to `out/`. See the [root release guide](../../README.md#release-preparation-and-publishing) before tagging a release. Pushing a version tag publishes packages through GitHub Actions.

CI tests Node.js 18, 20, and 22. The dedicated FFmpeg job requires x264/x265 and verifies real H.265-to-H.264 conversion; the integration test self-skips locally when the required tools are unavailable. A real-JMuxer test verifies parameter-set priming and retained audio. Automated pipeline tests do not establish compatibility with every physical camera.

See the [architecture guide](ARCHITECTURE.md) for code ownership and the [client](../eufy-security-client/README.md) and [stream-server](../eufy-stream-server/README.md) docs for APIs. Contributions should include a PR description and relevant verification.

## Credits and license

Built on [eufy-security-ws](https://github.com/bropat/eufy-security-ws) by [@bropat](https://github.com/bropat) and [Scrypted](https://www.scrypted.app/). Thanks to [@realAbitbol](https://github.com/realAbitbol), [@engim4-git](https://github.com/engim4-git), and [@jeepster5](https://github.com/jeepster5) for the fixes and diagnostics included in 0.4.1; see the [changelog](../../CHANGELOG.md) for earlier contributors.

[MIT License](LICENSE).
