# @caplaz/eufy-security-client

A TypeScript WebSocket client for Eufy security devices via the `eufy-security-ws` server. Provides type-safe commands, event handling, and streaming for Eufy cameras and doorbells.

## Why This Package

Modern Node.js versions (≥18.19.1) **cannot directly communicate with Eufy security devices** due to deprecated cryptographic protocols that have been removed for security reasons. This package solves the problem by connecting to an external `eufy-security-ws` server that handles the legacy encryption.

**📖 For a detailed explanation**, see **[WHY_THIS_PACKAGE](./WHY_THIS_PACKAGE.md)** which covers:

- Node.js compatibility matrix and technical details
- Architecture benefits and design principles
- Server setup options (Docker, local)
- Performance benchmarks and platform-specific notes

## Installation

```bash
npm install @caplaz/eufy-security-client
```

**Requirements:** Node.js ≥18.0.0, running `eufy-security-ws` server

## Quick Start

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";

const client = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",
});

try {
  // Connect to server
  await client.connect();

  // Get devices
  const devices = await client.getDevices();

  // Start streaming
  await client.startStream("T8210N20123456789");

  // Handle stream data
  client.on("streamData", (data) => {
    console.log(`${data.type}: ${data.buffer.length} bytes`);
  });

  // Stop streaming when done
  await client.stopStream("T8210N20123456789");
} finally {
  // Always cleanup
  await client.disconnect();
}
```

## Core API

### EufySecurityClient

High-level client for device management and streaming.

**Constructor**

```typescript
const client = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",     // Required: WebSocket server URL
  logger?: Logger<ILogObj>           // Optional: Custom tslog logger
});
```

**Methods**

| Method                | Description                                |
| --------------------- | ------------------------------------------ |
| `connect()`           | Connect to WebSocket server and initialize |
| `disconnect()`        | Close connection and cleanup resources     |
| `isConnected()`       | Check if client is ready for operations    |
| `getDevices()`        | Get all devices from Eufy account          |
| `startStream(serial)` | Start livestreaming from device            |
| `stopStream(serial)`  | Stop livestreaming from device             |

**Events**

```typescript
client.on("streamStarted", (event) => {
  // Stream began: { serialNumber, timestamp }
});

client.on("streamStopped", (event) => {
  // Stream ended: { serialNumber, timestamp }
});

client.on("streamData", (data) => {
  // Video/audio data received
  // { type: "video"|"audio", buffer: Buffer, deviceSerial: string, metadata?: {...} }
});
```

**Device Info**

```typescript
interface DeviceInfo {
  name: string; // Human-readable name
  serialNumber: string; // Unique identifier
  type: string; // "Camera", "Doorbell", etc.
  stationSerial?: string; // Associated station
  model?: string; // Device model
  hardwareVersion?: string; // Hardware version
  softwareVersion?: string; // Firmware version
}
```

## Advanced Usage

### Enhanced Command API

Use fluent command builders for type-safe operations:

```typescript
// Device commands
await client.commands.device("T8210N20123456789").getProperties();
await client.commands.device("T8210N20123456789").startLivestream();
await client.commands.device("T8210N20123456789").setProperty("enabled", true);

// Station commands
await client.commands.station("STATION_001").getProperties();
await client.commands.station("STATION_001").reboot();

// Driver commands
await client.commands.driver().connect();
await client.commands.driver().isConnected();

// Server commands
await client.commands.server().startListening();
```

### Authentication Manager

Handle CAPTCHA and 2FA challenges:

```typescript
import {
  AuthenticationManager,
  AUTH_STATE,
} from "@caplaz/eufy-security-client";

const authManager = new AuthenticationManager(
  apiManager,
  logger,
  () => updateUI(), // State change callback
  async (result) => await loadDevices(result) // Device registration callback
);

// Check for authentication challenges
await authManager.checkPendingAuth();

// Handle CAPTCHA
if (authManager.getAuthState() === AUTH_STATE.CAPTCHA_REQUIRED) {
  const captcha = authManager.getCaptchaData();
  console.log("CAPTCHA image:", captcha.captcha);

  authManager.updateCaptchaCode(userInput);
  await authManager.submitCaptcha();
}

// Handle 2FA
if (authManager.getAuthState() === AUTH_STATE.MFA_REQUIRED) {
  const mfa = authManager.getMfaData();
  console.log("2FA methods:", mfa.methods);

  authManager.updateVerifyCode(userCode);
  await authManager.submitVerifyCode();
}

// Get user-friendly status
const status = authManager.getAuthStatusMessage(isDriverConnected);
// Returns: "✅ Authenticated" or "🔐 CAPTCHA required" etc.
```

### Low-Level APIs

For advanced control, use the underlying components:

**ApiManager** - Direct WebSocket API with full command control

```typescript
import { ApiManager } from "@caplaz/eufy-security-client";

const api = new ApiManager("ws://localhost:3000", logger);
await api.connect();
await api.connectDriver();
await api.startListening();

// Type-safe commands
const result = await api.sendCommand(DEVICE_COMMANDS.GET_PROPERTIES, {
  serialNumber: "T8210N20123456789",
});

// Event listeners with filters
api.addEventListener(
  "motion_detected",
  (event) => {
    console.log("Motion:", event);
  },
  { source: "device", serialNumber: "T8210N20123456789" }
);
```

**WebSocketClient** - Raw WebSocket connection

```typescript
import {
  WebSocketClient,
  ClientStateManager,
} from "@caplaz/eufy-security-client";

const stateManager = new ClientStateManager(logger);
const wsClient = new WebSocketClient(
  "ws://localhost:3000",
  stateManager,
  logger
);
await wsClient.connect();
```

## Configuration

### Custom Logger

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";
import { Logger } from "tslog";

// Use tslog
const logger = new Logger({ name: "EufyClient", minLevel: 3 });
const client = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",
  logger,
});

// Or implement custom logger interface
const customLogger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
};
```

### Error Handling

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";

const client = new EufySecurityClient({ wsUrl: "ws://localhost:3000" });

try {
  await client.connect();
} catch (error) {
  if (error.message.includes("timeout")) {
    console.error("Connection timeout - is server running?");
  } else if (error.message.includes("Schema incompatibility")) {
    console.error("Version mismatch - update client or server");
  } else {
    console.error("Connection failed:", error.message);
  }
  process.exit(1);
}

// Handle runtime errors
client.on("error", (error) => {
  console.error("Runtime error:", error);
});

// Always cleanup on exit
process.on("SIGINT", async () => {
  await client.disconnect();
  process.exit(0);
});
```

### Stream Processing

```typescript
import { createWriteStream } from "fs";

const videoFile = createWriteStream("stream.h264");
const audioFile = createWriteStream("stream.aac");

client.on("streamData", (data) => {
  const file = data.type === "video" ? videoFile : audioFile;
  file.write(data.buffer);

  // Log video metadata when available
  if (data.type === "video" && data.metadata) {
    console.log(`Video: ${data.metadata.width}x${data.metadata.height}`);
  }
});

// Cleanup on disconnect
client.on("streamStopped", () => {
  videoFile.end();
  audioFile.end();
});
```

## Troubleshooting

| Problem                       | Solution                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Connection failed**         | • Check `eufy-security-ws` server is running<br>• Verify WebSocket URL (ws://host:port)<br>• Test with: `curl -I http://localhost:3000` |
| **Timeout waiting for ready** | • Check server logs for auth issues<br>• Verify Eufy credentials in server config<br>• Ensure network connectivity to Eufy cloud        |
| **Device not found**          | • List devices: `await client.getDevices()`<br>• Verify device serial number<br>• Check device is online in Eufy app                    |
| **No stream data**            | • Set up listeners before starting stream<br>• Check `streamStarted` event fired<br>• Verify device supports streaming                  |
| **High memory usage**         | • Process data immediately, don't buffer<br>• Always call `stopStream()` when done<br>• Call `disconnect()` to cleanup                  |
| **Schema incompatibility**    | • Update client or server to matching version<br>• Check version compatibility                                                          |

### Debug Logging

Enable detailed logging to diagnose issues:

```typescript
import { Logger } from "tslog";

const logger = new Logger({
  name: "EufyClient",
  minLevel: 0, // 0=silly, 1=trace, 2=debug, 3=info, 4=warn, 5=error
});

const client = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",
  logger,
});
```

## Examples

### List All Devices

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";

async function listDevices() {
  const client = new EufySecurityClient({ wsUrl: "ws://localhost:3000" });

  try {
    await client.connect();
    const devices = await client.getDevices();

    console.log(`Found ${devices.length} devices:`);
    devices.forEach((d, i) => {
      console.log(`${i + 1}. ${d.name} (${d.type})`);
      console.log(`   Serial: ${d.serialNumber}`);
      console.log(`   Model: ${d.model} v${d.softwareVersion}`);
    });
  } finally {
    await client.disconnect();
  }
}

listDevices();
```

### Record Stream to File

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";
import { createWriteStream } from "fs";

async function recordStream(deviceSerial: string, durationMs: number) {
  const client = new EufySecurityClient({ wsUrl: "ws://localhost:3000" });
  const videoFile = createWriteStream(`${deviceSerial}.h264`);
  const audioFile = createWriteStream(`${deviceSerial}.aac`);

  try {
    await client.connect();

    // Write stream data to files
    client.on("streamData", (data) => {
      (data.type === "video" ? videoFile : audioFile).write(data.buffer);
    });

    // Start recording
    await client.startStream(deviceSerial);
    console.log(`Recording for ${durationMs / 1000}s...`);

    // Stop after duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await client.stopStream(deviceSerial);

    console.log("Recording complete");
  } finally {
    videoFile.end();
    audioFile.end();
    await client.disconnect();
  }
}

recordStream("T8210N20123456789", 30000);
```

### Monitor Multiple Devices

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";

async function monitorDevices(serials: string[]) {
  const client = new EufySecurityClient({ wsUrl: "ws://localhost:3000" });

  try {
    await client.connect();

    // Set up event monitoring
    client.on("streamStarted", (e) =>
      console.log(`▶️  Stream started: ${e.serialNumber}`)
    );

    client.on("streamStopped", (e) =>
      console.log(`⏹️  Stream stopped: ${e.serialNumber}`)
    );

    // Start all streams
    await Promise.all(serials.map((s) => client.startStream(s)));

    // Keep running...
    await new Promise(() => {}); // Run indefinitely
  } finally {
    await client.disconnect();
  }
}

monitorDevices(["T8210N20123456789", "T8210N20987654321"]);
```

## Architecture

```
EufySecurityClient (High-level API)
    ↓
ApiManager (Command execution & events)
    ↓
WebSocketClient (Connection & messaging)
    ↓
eufy-security-ws server (Legacy encryption handling)
    ↓
Eufy Cloud API
```

## API Compatibility

| Client Version | Server Schema | Status            |
| -------------- | ------------- | ----------------- |
| 0.1.x          | 13-21         | ✅ Supported      |
| 0.1.x          | <13           | ❌ Not compatible |

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Add tests: `npm test`
4. Ensure coverage ≥80%: `npm run test:coverage`
5. Submit pull request

## License

MIT License - see [LICENSE](LICENSE) file

## Related Packages

- [`@caplaz/eufy-security-cli`](../eufy-security-cli) - Command-line interface
- [`@caplaz/eufy-security-scrypted`](../eufy-security-scrypted) - Scrypted plugin
- [`@caplaz/eufy-stream-server`](../eufy-stream-server) - H.264/AAC streaming server
