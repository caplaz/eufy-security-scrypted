# @caplaz/eufy-security-client

TypeScript WebSocket client for a running [eufy-security-ws](https://github.com/bropat/eufy-security-ws) server. The server handles the Eufy account, device protocols, and P2P connections; this package provides commands, typed events, and connection state for Node.js applications.

Package version **0.4.1** requires Node.js **≥18.0.0**. The repository's [Docker Compose configuration](../../docker/docker-compose.yml) pins `eufy-security-ws:3.1.0`. The client requires API schema 13 or newer and prefers schema 21; schema negotiation does not guarantee every command is supported by every device or server version.

## Install and start the server

```bash
npm install @caplaz/eufy-security-client tslog
```

For a server managed by this repository, configure the Eufy credentials as described in the [Docker guide](../../docker/README.md), then run from the repository root:

```bash
docker compose -f docker/docker-compose.yml up -d
```

The default endpoint is `ws://localhost:3000`. When your application runs in another container, `localhost` refers to that container; use an address reachable from the application.

## Quick start: typed client and livestream events

`EufyWebSocketClient` is the public alias of `ApiManager`. Its constructor takes a URL and a `tslog` logger, rather than an options object. Save this example as `example.ts`, set `EUFY_DEVICE_SERIAL` to a camera serial number, and run it with your TypeScript runner (for example, `npx tsx example.ts`). Server credentials belong in the server configuration.

This example assumes login needs no new CAPTCHA or verification code. It subscribes before login so authentication challenges are visible, waits for the Eufy driver to connect, and listens for ten seconds of camera data.

```typescript
import { setTimeout as delay } from "node:timers/promises";
import { Logger } from "tslog";
import {
  DEVICE_EVENTS,
  DRIVER_EVENTS,
  EVENT_SOURCES,
  EufyWebSocketClient,
} from "@caplaz/eufy-security-client";

async function main(): Promise<void> {
  const serialNumber = process.env.EUFY_DEVICE_SERIAL;
  if (!serialNumber)
    throw new Error("Set EUFY_DEVICE_SERIAL to a camera serial");

  const client = new EufyWebSocketClient(
    process.env.EUFY_WS_URL || "ws://localhost:3000",
    new Logger({ name: "eufy", minLevel: 3 }),
  );
  client.onError((error) => console.error("WebSocket/API error:", error));

  const removeListeners = [
    client.addEventListener(
      DRIVER_EVENTS.CAPTCHA_REQUEST,
      (event) => console.error("CAPTCHA required:", event.captchaId),
      { source: EVENT_SOURCES.DRIVER },
    ),
    client.addEventListener(
      DRIVER_EVENTS.VERIFY_CODE,
      (event) => console.error("Verification required:", event.methods),
      { source: EVENT_SOURCES.DRIVER },
    ),
    client.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA,
      (event) => {
        // The protocol uses JSONBuffer, not a Node.js Buffer.
        const chunk = Buffer.from(event.buffer.data);
        console.log("Video bytes:", chunk.length, event.metadata);
      },
      { source: EVENT_SOURCES.DEVICE, serialNumber },
    ),
    client.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA,
      (event) => {
        const chunk = Buffer.from(event.buffer.data);
        console.log("Audio bytes:", chunk.length, event.metadata.audioCodec);
      },
      { source: EVENT_SOURCES.DEVICE, serialNumber },
    ),
  ];

  const camera = client.commands.device(serialNumber);
  let streamRequested = false;
  try {
    await client.connect();
    // connect() resolves when the socket opens; schema negotiation follows.
    const readyDeadline = Date.now() + 10_000;
    while (!client.isConnected()) {
      if (Date.now() > readyDeadline)
        throw new Error("Schema negotiation timed out");
      await delay(100);
    }

    // Subscribe at the server before initiating login to receive auth events.
    const initial = await client.startListening();
    if (!initial.state.driver.connected) {
      await client.connectDriver();
      const loginDeadline = Date.now() + 60_000;
      while (!(await client.commands.driver().isConnected()).connected) {
        if (Date.now() > loginDeadline) {
          throw new Error(
            "Driver login timed out; check authentication challenges",
          );
        }
        await delay(500);
      }
    }

    const { state } = await client.startListening();
    console.log("Device serials:", state.devices);
    console.log("Station serials:", state.stations);
    const { properties } = await camera.getProperties();
    console.log("Camera:", properties.name, properties.model);

    streamRequested = true;
    await camera.startLivestream();
    // Command acknowledgement and first media arrival are separate events.
    await delay(10_000);
  } finally {
    try {
      if (streamRequested && client.isConnected()) {
        await camera.stopLivestream();
      }
    } finally {
      removeListeners.forEach((remove) => remove());
      client.disconnect(); // Synchronous for EufyWebSocketClient.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Video chunks are raw encoded media, not complete playable files. Inspect `event.metadata.videoCodec` (`H264` or `H265`, depending on the camera) and audio metadata before choosing a decoder or muxer. Do not assume every camera emits AAC. The [stream-server package](../eufy-stream-server) handles TCP delivery and parameter-set caching for the Scrypted integration.

## Authentication and lifecycle

Register listeners before `startListening()`, and start server event delivery before requesting driver login. WebSocket readiness (`isConnected()`) and Eufy driver authentication are separate. A successful `connectDriver()` request alone is not proof that CAPTCHA/2FA is complete; query `commands.driver().isConnected()` or observe driver events.

For an interactive application, use the exported `AuthenticationManager`, or handle `DRIVER_EVENTS.CAPTCHA_REQUEST` and `DRIVER_EVENTS.VERIFY_CODE` yourself. The command shapes are:

```typescript
await client.commands.driver().setCaptcha({
  captchaId: "id-from-captcha-request",
  captcha: "user-entered-captcha",
});
await client.commands.driver().setVerifyCode({
  captchaId: "", // Use the current CAPTCHA ID when applicable.
  verifyCode: "user-entered-verification-code",
});
```

These statements assume the `client` from the quick start remains connected. The pending challenge can also be read through `getPendingCaptcha()` / `getPendingMfa()` and cleared with their corresponding `clearPending…()` methods.

Use `getState()`, `getSchemaInfo()`, `onStateChange(callback)` (returns an unsubscribe function), and `onError(callback)` to monitor connection state. `disconnect()` closes this client's WebSocket; it does not automatically stop camera streams. Stop the streams your application started and remove listeners during cleanup. After a reconnect, restore server listening and verify driver state before resuming operations.

## Commands and events

Commands are grouped by scope. Device/station property responses wrap their values in `properties`; `startListening()` returns serial-number lists under `state.devices` and `state.stations`.

| Operation                    | API                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Camera properties/metadata   | `client.commands.device(serial).getProperties()` / `.getPropertiesMetadata()`                               |
| Device command capabilities  | `client.commands.device(serial).getCommands()` / `.hasCommand(commandName)`                                 |
| Set a device property        | `client.commands.device(serial).setProperty("motionDetection", true)`                                       |
| Livestream status/start/stop | `client.commands.device(serial).isLivestreaming()` / `.startLivestream()` / `.stopLivestream()`             |
| RTSP status/start/stop       | `client.commands.device(serial).isRtspLivestreaming()` / `.startRtspLivestream()` / `.stopRtspLivestream()` |
| Station properties           | `client.commands.station(serial).getProperties()`                                                           |
| Set a station property       | `client.commands.station(serial).setProperty("guardMode", mode)`                                            |
| Refresh driver data          | `client.commands.driver().pollRefresh()`                                                                    |
| Typed protocol command       | `client.sendCommand(DEVICE_COMMANDS.GET_PROPERTIES, { serialNumber: serial })`                              |

Property names are checked by TypeScript; device support and valid values still depend on the model. Check capabilities and property metadata before presenting controls.

Use exported event constants and `addEventListener(eventType, callback, { source, serialNumber })`. The callback is inferred from the event and source. For example, a filtered property listener is:

```typescript
const remove = client.addEventListener(
  DEVICE_EVENTS.PROPERTY_CHANGED,
  (event) => console.log(event.serialNumber, event.name, event.value),
  { source: EVENT_SOURCES.DEVICE, serialNumber: "YOUR_CAMERA_SERIAL" },
);
// When this listener is no longer needed:
remove();
```

Filter device-specific listeners by serial number. Device-added/removed events instead carry a `device` serial field; listen by source without a serial filter for those discovery events. Event names and payloads are defined in [device events](./src/device/events.ts), [station events](./src/station/events.ts), and [driver events](./src/driver/events.ts).

## Which client should I use?

- **`EufyWebSocketClient` (`ApiManager`)**: recommended for typed events, explicit authentication/lifecycle handling, and access to all command scopes. Constructor: `new EufyWebSocketClient(wsUrl, logger)`.
- **`EufySecurityClient`**: CLI-oriented `EventEmitter` wrapper. Constructor: `new EufySecurityClient({ wsUrl, logger? })`. It provides `connect()`, async `disconnect()`, cached `getDevices()`, `startStream(serial)`, `stopStream(serial)`, and `commands`. It forwards `streamStarted`, `streamStopped`, and `streamData` (converting data into Buffers). It does not expose the typed listener API or forward every protocol event. Its device records use `serialNumber`, not `serial_number`.
- **`WebSocketClient`**: lower-level transport, used internally by `ApiManager`.

See [why this package exists](./WHY_THIS_PACKAGE.md) for the server boundary and [public exports](./src/index.ts) / [command builders](./src/api-manager-commands.ts) for the current source API.

## Troubleshooting and development

If connection fails, check the server endpoint, container logs, and network reachability. Inspect `getSchemaInfo()` after negotiation. For login problems, check the server's account configuration and authentication challenge events. For missing media, check camera capabilities, livestream events, and server logs; a command acknowledgement does not guarantee frames have arrived.

From this package directory in the repository:

```bash
npm run build
npm run typecheck
npm test
npm run test:coverage
```

Related packages: [Scrypted plugin](../eufy-security-scrypted), [stream server](../eufy-stream-server), and [private CLI](../eufy-security-cli). Licensed under [MIT](../../LICENSE).
