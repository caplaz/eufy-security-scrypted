# @caplaz/eufy-security-client

> **TypeScript WebSocket client for Eufy security devices**

Connect to Eufy cameras, doorbells, and security systems through the `eufy-security-ws` server. Provides type-safe commands, real-time events, and video streaming capabilities.

## 🎯 Quick Start

### Prerequisites

1. **Node.js ≥18.0.0** - Modern Node.js runtime
2. **eufy-security-ws Server** - Running instance ([setup guide](https://github.com/bropat/eufy-security-ws))

### Installation

```bash
npm install @caplaz/eufy-security-client
```

### Basic Example

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
  console.log(`Found ${devices.length} devices`);

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

---

## 💡 Why This Package

Modern Node.js versions (≥18.19.1) **cannot directly communicate with Eufy security devices** due to deprecated cryptographic protocols that have been removed for security reasons.

### The Solution

This package solves the problem by connecting to an external `eufy-security-ws` server that handles the legacy encryption, while providing a clean, modern TypeScript API.

```
Your App → @caplaz/eufy-security-client → eufy-security-ws → Eufy Cloud/Devices
```

### Benefits

- ✅ **Type-Safe** - Full TypeScript support with comprehensive types
- ✅ **Event-Driven** - Real-time device events and streaming
- ✅ **Modern API** - Clean async/await interface
- ✅ **Well-Tested** - 80%+ test coverage
- ✅ **Production Ready** - Used in Scrypted plugin

**📖 For detailed technical information**, see **[WHY_THIS_PACKAGE](./WHY_THIS_PACKAGE.md)**

---

## 🔌 Connection Management

### Connecting

```typescript
const client = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",     // Required: WebSocket server URL
  logger?: Logger<ILogObj>           // Optional: Custom tslog logger
});

await client.connect();
```

### Connection Events

```typescript
client.on("connected", () => {
  console.log("Connected to eufy-security-ws");
});

client.on("disconnected", () => {
  console.log("Disconnected from server");
});

client.on("error", (error) => {
  console.error("Connection error:", error);
});
```

### Connection States

| State          | Description                       |
| -------------- | --------------------------------- |
| `disconnected` | Not connected to server           |
| `connecting`   | Establishing WebSocket connection |
| `connected`    | WebSocket connected               |
| `negotiating`  | Negotiating API schema            |
| `ready`        | Fully initialized and ready       |

### Checking Status

```typescript
if (client.isConnected()) {
  console.log("Client is ready for operations");
}

const state = client.getConnectionState();
console.log(`Current state: ${state}`);
```

---

## 📹 Device Management

### Getting Devices

```typescript
// Get all devices
const devices = await client.getDevices();

devices.forEach((device) => {
  console.log(`${device.name} (${device.serial_number})`);
  console.log(`  Type: ${device.type}`);
  console.log(`  Model: ${device.model}`);
  console.log(`  Online: ${device.state === 1 ? "Yes" : "No"}`);
});
```

### Device Information

Each device object includes:

```typescript
interface Device {
  serial_number: string; // Unique device identifier
  name: string; // User-friendly name
  model: string; // Device model
  type: number; // Device type code
  station_serial_number: string; // Parent station serial
  state: number; // Online status (1 = online)
  // ... additional properties
}
```

### Getting Stations

```typescript
// Get all base stations
const stations = await client.getStations();

stations.forEach((station) => {
  console.log(`${station.name} (${station.serial_number})`);
  console.log(`  Model: ${station.model}`);
  console.log(`  Guard Mode: ${station.guard_mode}`);
});
```

---

## 🎥 Video Streaming

### Starting a Stream

```typescript
// Start livestream from a camera
await client.startStream("T8210N20123456789");

client.on("streamStarted", (event) => {
  console.log(`Stream started: ${event.serialNumber}`);
});
```

### Handling Stream Data

```typescript
client.on("streamData", (data) => {
  console.log(`Received ${data.type} data`);
  console.log(`  Device: ${data.deviceSerial}`);
  console.log(`  Size: ${data.buffer.length} bytes`);

  if (data.metadata) {
    console.log(`  Metadata:`, data.metadata);
  }

  // Process the video/audio buffer
  processStreamData(data.buffer, data.type);
});
```

### Stream Data Types

```typescript
interface StreamData {
  type: "video" | "audio"; // Data type
  buffer: Buffer; // Raw stream data
  deviceSerial: string; // Source device
  metadata?: {
    // Optional metadata
    videoWidth?: number;
    videoHeight?: number;
    videoFPS?: number;
    // ... codec info
  };
}
```

### Stopping a Stream

```typescript
await client.stopStream("T8210N20123456789");

client.on("streamStopped", (event) => {
  console.log(`Stream stopped: ${event.serialNumber}`);
});
```

---

## 🎬 Complete Streaming Example

```typescript
import { EufySecurityClient } from "@caplaz/eufy-security-client";
import fs from "fs";

async function streamCamera(serialNumber: string, duration: number) {
  const client = new EufySecurityClient({
    wsUrl: "ws://localhost:3000",
  });

  const videoFile = fs.createWriteStream("output.h264");
  const audioFile = fs.createWriteStream("output.aac");

  try {
    // Connect
    await client.connect();
    console.log("✅ Connected to server");

    // Get device info
    const devices = await client.getDevices();
    const camera = devices.find((d) => d.serial_number === serialNumber);
    console.log(`📹 Found camera: ${camera?.name}`);

    // Handle stream data
    client.on("streamData", (data) => {
      if (data.type === "video") {
        videoFile.write(data.buffer);
      } else if (data.type === "audio") {
        audioFile.write(data.buffer);
      }
    });

    // Start streaming
    await client.startStream(serialNumber);
    console.log("🎥 Streaming started...");

    // Stream for specified duration
    await new Promise((resolve) => setTimeout(resolve, duration));

    // Stop streaming
    await client.stopStream(serialNumber);
    console.log("⏹️  Streaming stopped");
  } finally {
    videoFile.close();
    audioFile.close();
    await client.disconnect();
    console.log("👋 Disconnected");
  }
}

// Stream for 30 seconds
streamCamera("T8210N20123456789", 30000);
```

---

## 🎛️ Device Commands

### Camera Commands

```typescript
// Take snapshot
await client.setCommandWithString("T8210N20123456789", "camera.snapshot");

// Enable/disable motion detection
await client.setCommandWithBool(
  "T8210N20123456789",
  "camera.motionDetection",
  true
);

// Control floodlight
await client.setCommandWithBool("T8210N20123456789", "camera.light", true);
```

### Station Commands

```typescript
// Set guard mode
await client.setCommandWithString("T8210N...", "station.guardMode", "away");

// Reboot station
await client.setCommandWithString("T8210N...", "station.reboot");
```

### PTZ Control

```typescript
// Pan camera
await client.setCommandWithString("T8210N20123456789", "camera.panLeft");
await client.setCommandWithString("T8210N20123456789", "camera.panRight");

// Tilt camera
await client.setCommandWithString("T8210N20123456789", "camera.tiltUp");
await client.setCommandWithString("T8210N20123456789", "camera.tiltDown");
```

---

## 📡 Real-Time Events

### Property Changes

```typescript
client.on("propertyChanged", (event) => {
  console.log(`Property changed: ${event.name}`);
  console.log(`  Device: ${event.serialNumber}`);
  console.log(`  New value: ${event.value}`);
});
```

### Device Events

```typescript
client.on("deviceAdded", (device) => {
  console.log(`New device: ${device.name}`);
});

client.on("deviceRemoved", (serialNumber) => {
  console.log(`Device removed: ${serialNumber}`);
});
```

### Station Events

```typescript
client.on("stationGuardModeChanged", (event) => {
  console.log(`Guard mode: ${event.guardMode}`);
  console.log(`  Station: ${event.serialNumber}`);
});

client.on("stationAlarmEvent", (event) => {
  console.log(`⚠️  ALARM: ${event.type}`);
});
```

---

## 🔍 Troubleshooting

### Connection Issues

**Problem**: Cannot connect to eufy-security-ws

**Solutions**:

1. ✅ Verify server is running: `docker ps` or check process
2. ✅ Check URL is correct: `ws://localhost:3000` (not `http://`)
3. ✅ Test server health: `curl http://localhost:3000/health`
4. ✅ Check firewall settings
5. ✅ Enable debug logging: `logger: new Logger({ minLevel: 2 })`

### Streaming Issues

**Problem**: Stream not starting or no data received

**Solutions**:

1. ✅ Verify device is online: Check `device.state === 1`
2. ✅ Check device supports streaming: Some sensors don't stream
3. ✅ Wait for `streamStarted` event before expecting data
4. ✅ Check eufy-security-ws logs for errors
5. ✅ Try restarting the stream: `stopStream()` then `startStream()`

### Command Failures

**Problem**: Device commands not working

**Solutions**:

1. ✅ Ensure client is connected: `isConnected()` returns `true`
2. ✅ Check command name spelling and format
3. ✅ Verify device supports the command (check device type)
4. ✅ Check eufy-security-ws server version compatibility
5. ✅ Review server logs for detailed error messages

### Memory Leaks

**Problem**: Memory usage growing over time

**Solutions**:

1. ✅ Always call `disconnect()` when done
2. ✅ Remove event listeners when no longer needed
3. ✅ Don't accumulate stream data in memory indefinitely
4. ✅ Process stream chunks immediately or write to disk
5. ✅ Use streaming libraries for large video files

---

## 🏗️ Architecture

### Component Diagram

```
┌─────────────────┐
│   Your App      │
└────────┬────────┘
         │ import
         ▼
┌─────────────────────────┐
│ EufySecurityClient      │
│ - connect()             │
│ - getDevices()          │
│ - startStream()         │
└────────┬────────────────┘
         │ WebSocket
         ▼
┌─────────────────────────┐
│  eufy-security-ws       │
│  - Handles legacy       │
│    encryption           │
│  - Device management    │
└────────┬────────────────┘
         │ HTTP/P2P
         ▼
┌─────────────────────────┐
│  Eufy Cloud/Devices     │
└─────────────────────────┘
```

### Key Components

- **EufySecurityClient** - High-level API for device operations
- **WebSocketClient** - Low-level WebSocket communication
- **ApiManager** - Command execution and response handling
- **Event System** - Real-time event processing

---

## 📊 API Reference

### EufySecurityClient

#### Constructor Options

```typescript
interface ClientOptions {
  wsUrl: string; // WebSocket server URL (required)
  logger?: Logger<ILogObj>; // Optional tslog logger
}
```

#### Connection Methods

| Method                 | Returns           | Description                   |
| ---------------------- | ----------------- | ----------------------------- |
| `connect()`            | `Promise<void>`   | Connect to WebSocket server   |
| `disconnect()`         | `Promise<void>`   | Disconnect and cleanup        |
| `isConnected()`        | `boolean`         | Check if ready for operations |
| `getConnectionState()` | `ConnectionState` | Get current connection state  |

#### Device Methods

| Method               | Returns              | Description                  |
| -------------------- | -------------------- | ---------------------------- |
| `getDevices()`       | `Promise<Device[]>`  | Get all devices              |
| `getStations()`      | `Promise<Station[]>` | Get all base stations        |
| `getDevice(serial)`  | `Device \| null`     | Get device by serial number  |
| `getStation(serial)` | `Station \| null`    | Get station by serial number |

#### Streaming Methods

| Method                | Returns         | Description             |
| --------------------- | --------------- | ----------------------- |
| `startStream(serial)` | `Promise<void>` | Start device livestream |
| `stopStream(serial)`  | `Promise<void>` | Stop device livestream  |

#### Command Methods

| Method                                    | Description             |
| ----------------------------------------- | ----------------------- |
| `setCommandWithString(serial, cmd, val?)` | Execute string command  |
| `setCommandWithNumber(serial, cmd, val)`  | Execute numeric command |
| `setCommandWithBool(serial, cmd, val)`    | Execute boolean command |

#### Events

| Event                     | Payload                | Description                |
| ------------------------- | ---------------------- | -------------------------- |
| `connected`               | `void`                 | WebSocket connected        |
| `disconnected`            | `void`                 | WebSocket disconnected     |
| `ready`                   | `void`                 | Client fully initialized   |
| `error`                   | `Error`                | Connection error occurred  |
| `streamStarted`           | `StreamEvent`          | Stream began               |
| `streamStopped`           | `StreamEvent`          | Stream ended               |
| `streamData`              | `StreamData`           | Video/audio data received  |
| `propertyChanged`         | `PropertyChangedEvent` | Device property updated    |
| `deviceAdded`             | `Device`               | New device discovered      |
| `deviceRemoved`           | `string`               | Device removed             |
| `stationGuardModeChanged` | `GuardModeEvent`       | Station guard mode changed |
| `stationAlarmEvent`       | `AlarmEvent`           | Alarm triggered            |

---

## 🧪 Testing

This package has comprehensive test coverage (80%+):

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- authentication-manager
```

### Test Categories

- **Unit Tests** - Component isolation testing
- **Integration Tests** - Full workflow testing
- **Mock Server** - Simulated eufy-security-ws responses

---

## 📚 Advanced Usage

### Custom Logger

```typescript
import { Logger } from "tslog";

const logger = new Logger({
  name: "EufyClient",
  minLevel: 2, // 0=trace, 1=debug, 2=info
  type: "pretty",
});

const client = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",
  logger,
});
```

### Error Handling

```typescript
try {
  await client.connect();
} catch (error) {
  if (error.message.includes("ECONNREFUSED")) {
    console.error("Server not running");
  } else if (error.message.includes("timeout")) {
    console.error("Connection timeout");
  } else {
    console.error("Unknown error:", error);
  }
}
```

### Stream Processing Pipeline

```typescript
import { Transform } from "stream";

// Create processing pipeline
const videoProcessor = new Transform({
  transform(chunk, encoding, callback) {
    // Process H.264 chunk
    const processed = processH264(chunk);
    callback(null, processed);
  },
});

client.on("streamData", (data) => {
  if (data.type === "video") {
    videoProcessor.write(data.buffer);
  }
});

videoProcessor.pipe(outputStream);
```

---

## 🤝 Related Packages

- **[@caplaz/eufy-security-scrypted](../eufy-security-scrypted)** - Scrypted plugin using this client
- **[@caplaz/eufy-stream-server](../eufy-stream-server)** - TCP streaming server
- **[@caplaz/eufy-security-cli](../eufy-security-cli)** - Command-line interface

---

## 📄 License

MIT License - See [LICENSE](../../LICENSE) file for details

---

## 🙏 Credits

Built on top of:

- [eufy-security-ws](https://github.com/bropat/eufy-security-ws) by @bropat

---

## 🎉 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Ensure tests pass: `npm test`
5. Submit a pull request

---

**Made with ❤️ for the Eufy community**
