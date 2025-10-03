# @caplaz/eufy-stream-server

> **TCP streaming server for raw H.264 video from Eufy cameras**

A lightweight, focused streaming server that delivers raw H.264 video over TCP. Perfect for integration with FFmpeg, media players, and custom video processing pipelines.

## 🎯 Quick Start

### Prerequisites

1. **Node.js ≥18.0.0** - Modern Node.js runtime
2. **@caplaz/eufy-security-client** - WebSocket client for Eufy devices

### Installation

```bash
npm install @caplaz/eufy-stream-server
```

### Basic Example

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";
import { EufySecurityClient } from "@caplaz/eufy-security-client";

// Setup Eufy client
const eufyClient = new EufySecurityClient({
  wsUrl: "ws://localhost:3000",
});
await eufyClient.connect();

// Create stream server
const server = new StreamServer({
  port: 8080,
  wsClient: eufyClient,
  serialNumber: "T8210N20123456789",
  debug: true,
});

// Start server
await server.start();
console.log("🎥 Stream server running on port 8080");

// Server automatically starts/stops camera streaming based on client connections
```

---

## ✨ Features

- **Raw H.264 Streaming** - Direct H.264 video without audio or MP4 complexity
- **TCP Server** - Simple TCP server for easy client connections
- **NAL Unit Parsing** - Automatic H.264 structure parsing and keyframe detection
- **Connection Management** - Handles multiple concurrent clients with auto-cleanup
- **Automatic Camera Control** - Starts/stops streaming based on client activity
- **Statistics** - Real-time streaming and connection metrics
- **Snapshot Capture** - Grab single keyframes on demand
- **Event-Driven** - Real-time events for connections and streaming

---

## 🔌 Server Management

### Starting the Server

```typescript
const server = new StreamServer({
  port: 8080,              // TCP port (default: 8080)
  host: "0.0.0.0",         // Bind address (default: all interfaces)
  maxConnections: 10,      // Max concurrent clients (default: 10)
  debug: true,             // Enable debug logging
  logger: customLogger,    // Optional tslog logger
  wsClient: eufyClient,    // Required: EufySecurityClient
  serialNumber: "T8210...", // Required: Camera serial
});

await server.start();
```

### Server Events

```typescript
server.on("started", () => {
  console.log("✅ Server started");
});

server.on("stopped", () => {
  console.log("⏹️  Server stopped");
});

server.on("error", (error) => {
  console.error("❌ Server error:", error);
});
```

### Stopping the Server

```typescript
await server.stop();
console.log("Server stopped and cleaned up");
```

---

## 👥 Client Connections

### Connection Events

```typescript
server.on("clientConnected", (connectionId, connectionInfo) => {
  console.log(`📱 Client ${connectionId} connected`);
  console.log(`   From: ${connectionInfo.remoteAddress}`);
  console.log(`   Port: ${connectionInfo.remotePort}`);
});

server.on("clientDisconnected", (connectionId) => {
  console.log(`�� Client ${connectionId} disconnected`);
});
```

### Connection Management

The server automatically:

- ✅ Accepts multiple concurrent TCP clients
- ✅ Starts camera streaming on first client connection
- ✅ Stops camera streaming when last client disconnects
- ✅ Broadcasts video data to all connected clients
- ✅ Cleans up resources when clients disconnect

### Connection Info

```typescript
const stats = server.getStats();
console.log(`Active connections: ${stats.connections.active}`);
console.log(`Total connections: ${stats.connections.total}`);
```

---

## 🎥 Video Streaming

### Stream Events

```typescript
server.on("videoStreamed", (streamData) => {
  console.log(`📹 Streamed ${streamData.data.length} bytes`);
  console.log(`   Keyframe: ${streamData.isKeyFrame ? "Yes" : "No"}`);
  console.log(`   Timestamp: ${streamData.timestamp}`);
});
```

### Video Metadata

```typescript
// Wait for metadata
const metadata = await server.waitForVideoMetadata(5000);
console.log(`Video: ${metadata.videoWidth}x${metadata.videoHeight}`);
console.log(`FPS: ${metadata.videoFPS}`);
console.log(`Codec: ${metadata.videoCodec}`);

// Or get current metadata
const current = server.getVideoMetadata();
if (current) {
  console.log("Metadata available:", current);
}
```

### Manual Streaming

```typescript
// Manually push H.264 data (advanced use)
const h264Data = Buffer.from(/* your H.264 data */);
const success = await server.streamVideo(h264Data, Date.now(), true);

if (success) {
  console.log("Data streamed to clients");
}
```

---

## �� Snapshot Capture

### Capturing Snapshots

```typescript
try {
  // Capture a keyframe (starts stream if needed)
  const snapshot = await server.captureSnapshot(15000); // 15s timeout
  
  console.log(`✅ Captured ${snapshot.length} bytes`);
  
  // Save to file
  fs.writeFileSync("snapshot.h264", snapshot);
  
  // Convert to image with FFmpeg
  // ffmpeg -i snapshot.h264 -frames:v 1 snapshot.jpg
  
} catch (error) {
  console.error("Failed to capture snapshot:", error);
}
```

### How It Works

1. Starts camera stream if not already streaming
2. Waits for next keyframe (I-frame)
3. Returns the keyframe as a Buffer
4. Stops stream if it was started for snapshot
5. Timeout if no keyframe received within specified time

---

## 🎬 Complete Examples

### Basic Streaming Server

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";
import { EufySecurityClient } from "@caplaz/eufy-security-client";

async function runStreamingServer() {
  // Setup Eufy client
  const eufy = new EufySecurityClient({
    wsUrl: "ws://localhost:3000",
  });
  
  await eufy.connect();
  console.log("✅ Connected to eufy-security-ws");
  
  // Get camera info
  const devices = await eufy.getDevices();
  const camera = devices.find(d => d.type === "camera");
  
  console.log(`📹 Streaming from: ${camera.name}`);
  
  // Create server
  const server = new StreamServer({
    port: 8080,
    wsClient: eufy,
    serialNumber: camera.serial_number,
    debug: true,
  });
  
  // Setup event handlers
  server.on("clientConnected", (id, info) => {
    console.log(`👤 Client connected from ${info.remoteAddress}`);
  });
  
  server.on("videoStreamed", (data) => {
    if (data.isKeyFrame) {
      console.log(`🔑 Keyframe: ${data.data.length} bytes`);
    }
  });
  
  // Start server
  await server.start();
  console.log("🚀 Server running on port 8080");
  console.log("   Connect with: ffplay tcp://localhost:8080");
  
  // Cleanup on exit
  process.on("SIGINT", async () => {
    console.log("\n⏹️  Stopping server...");
    await server.stop();
    await eufy.disconnect();
    process.exit(0);
  });
}

runStreamingServer();
```

### Multi-Camera Server

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";
import { EufySecurityClient } from "@caplaz/eufy-security-client";

async function runMultiCameraServer() {
  const eufy = new EufySecurityClient({
    wsUrl: "ws://localhost:3000",
  });
  
  await eufy.connect();
  
  const cameras = (await eufy.getDevices()).filter(d => d.type === "camera");
  const servers: StreamServer[] = [];
  
  // Create server for each camera
  for (let i = 0; i < cameras.length; i++) {
    const camera = cameras[i];
    const port = 8080 + i;
    
    const server = new StreamServer({
      port,
      wsClient: eufy,
      serialNumber: camera.serial_number,
    });
    
    await server.start();
    console.log(`📹 ${camera.name}: tcp://localhost:${port}`);
    
    servers.push(server);
  }
  
  // Cleanup
  process.on("SIGINT", async () => {
    for (const server of servers) {
      await server.stop();
    }
    await eufy.disconnect();
    process.exit(0);
  });
}

runMultiCameraServer();
```

### Snapshot Service

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";
import { EufySecurityClient } from "@caplaz/eufy-security-client";
import fs from "fs";

async function captureAndSaveSnapshot(serialNumber: string) {
  const eufy = new EufySecurityClient({
    wsUrl: "ws://localhost:3000",
  });
  
  await eufy.connect();
  
  const server = new StreamServer({
    port: 8080,
    wsClient: eufy,
    serialNumber,
  });
  
  try {
    console.log("📸 Capturing snapshot...");
    
    const snapshot = await server.captureSnapshot(15000);
    
    const filename = `snapshot-${Date.now()}.h264`;
    fs.writeFileSync(filename, snapshot);
    
    console.log(`✅ Saved to ${filename} (${snapshot.length} bytes)`);
    
  } catch (error) {
    console.error("❌ Failed:", error.message);
  } finally {
    await eufy.disconnect();
  }
}

captureAndSaveSnapshot("T8210N20123456789");
```

---

## 🔧 H.264 Parser

### Using the Parser

```typescript
import { H264Parser } from "@caplaz/eufy-stream-server";

const parser = new H264Parser(logger);

// Extract NAL units
const nalUnits = parser.extractNALUnits(h264Buffer);
console.log(`Found ${nalUnits.length} NAL units`);

nalUnits.forEach(nal => {
  console.log(`NAL Type: ${nal.type} (${nal.typeName})`);
  console.log(`Size: ${nal.data.length} bytes`);
});

// Check for keyframe
const isKeyFrame = parser.isKeyFrame(h264Buffer);
console.log(`Is keyframe: ${isKeyFrame ? "Yes" : "No"}`);

// Extract metadata
const metadata = parser.extractVideoMetadata(h264Buffer);
if (metadata) {
  console.log(`Profile: ${metadata.profile}`);
  console.log(`Level: ${metadata.level}`);
  console.log(`Resolution: ${metadata.videoWidth}x${metadata.videoHeight}`);
}

// Validate data
const isValid = parser.validateH264Data(h264Buffer);
console.log(`Valid H.264: ${isValid ? "Yes" : "No"}`);
```

### NAL Unit Types

| Type | Name          | Description           |
| ---- | ------------- | --------------------- |
| 1    | Slice         | Video slice           |
| 5    | IDR Slice     | Keyframe (I-frame)    |
| 6    | SEI           | Supplemental info     |
| 7    | SPS           | Sequence parameters   |
| 8    | PPS           | Picture parameters    |
| 9    | AUD           | Access unit delimiter |

---

## 📊 Statistics & Monitoring

### Getting Statistics

```typescript
const stats = server.getStats();

console.log("📊 Server Statistics:");
console.log(`  Running: ${stats.isRunning}`);
console.log(`  Active: ${stats.isActive}`);
console.log(`  Uptime: ${stats.uptime}s`);

console.log("👥 Connections:");
console.log(`  Active: ${stats.connections.active}`);
console.log(`  Total: ${stats.connections.total}`);

console.log("�� Streaming:");
console.log(`  Frames: ${stats.streaming.framesProcessed}`);
console.log(`  Keyframes: ${stats.streaming.keyFrames}`);
console.log(`  Data: ${(stats.streaming.bytesProcessed / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Duration: ${stats.streaming.duration}s`);
```

### Real-Time Monitoring

```typescript
// Monitor every 10 seconds
setInterval(() => {
  const stats = server.getStats();
  
  if (stats.isActive) {
    console.log(`📹 Active - ${stats.connections.active} clients`);
    console.log(`   ${stats.streaming.framesProcessed} frames, ${stats.streaming.keyFrames} keyframes`);
  } else {
    console.log("💤 Idle - waiting for connections");
  }
}, 10000);
```

---

## 🔍 Troubleshooting

### Server Won't Start

**Problem**: Server fails to start

**Solutions**:

1. ✅ Check port is not in use: `lsof -i :8080` or `netstat -an | grep 8080`
2. ✅ Try different port: `{ port: 8081 }`
3. ✅ Check permissions (ports < 1024 need sudo on Linux)
4. ✅ Verify eufy client is connected: `wsClient.isConnected()`
5. ✅ Enable debug logging: `{ debug: true }`

### No Video Data

**Problem**: Clients connect but receive no data

**Solutions**:

1. ✅ Verify camera is online in Eufy app
2. ✅ Check camera serial number is correct
3. ✅ Ensure camera supports streaming (not a sensor)
4. ✅ Check eufy-security-ws logs for errors
5. ✅ Try restarting eufy-security-ws server
6. ✅ Wait 5-10 seconds for stream to initialize

### Snapshot Timeout

**Problem**: `captureSnapshot()` times out

**Solutions**:

1. ✅ Increase timeout: `captureSnapshot(30000)` (30 seconds)
2. ✅ Check camera is streaming: Try viewing in Eufy app first
3. ✅ Verify network connectivity to camera
4. ✅ Check if camera is busy (already streaming elsewhere)
5. ✅ Try manual stream: `startStream()` first

### High Memory Usage

**Problem**: Memory usage growing over time

**Solutions**:

1. ✅ Ensure proper cleanup: Call `stop()` when done
2. ✅ Remove event listeners when not needed
3. ✅ Don't accumulate video data in handlers
4. ✅ Limit concurrent connections: `{ maxConnections: 5 }`
5. ✅ Monitor with: `process.memoryUsage()`

---

## 📊 API Reference

### StreamServer Constructor

```typescript
interface StreamServerOptions {
  port?: number;                    // TCP port (default: 8080)
  host?: string;                    // Bind address (default: '0.0.0.0')
  maxConnections?: number;          // Max clients (default: 10)
  debug?: boolean;                  // Debug logging (default: false)
  logger?: Logger<ILogObj>;         // Custom tslog logger
  wsClient: EufySecurityClient;     // Required: Eufy client
  serialNumber: string;             // Required: Camera serial
}
```

### Methods

| Method                            | Returns                  | Description                      |
| --------------------------------- | ------------------------ | -------------------------------- |
| `start()`                         | `Promise<void>`          | Start TCP server                 |
| `stop()`                          | `Promise<void>`          | Stop server and cleanup          |
| `streamVideo(data, timestamp, isKeyFrame)` | `Promise<boolean>` | Stream H.264 data    |
| `captureSnapshot(timeout?)`       | `Promise<Buffer>`        | Capture single keyframe          |
| `getStats()`                      | `ServerStats`            | Get server statistics            |
| `getActiveConnectionCount()`      | `number`                 | Get active client count          |
| `isRunning()`                     | `boolean`                | Check if server is running       |
| `getVideoMetadata()`              | `VideoMetadata \| null`  | Get video metadata               |
| `waitForVideoMetadata(timeout?)`  | `Promise<VideoMetadata>` | Wait for metadata                |

### Events

| Event                | Payload                                    | Description              |
| -------------------- | ------------------------------------------ | ------------------------ |
| `started`            | `void`                                     | Server started           |
| `stopped`            | `void`                                     | Server stopped           |
| `clientConnected`    | `(connectionId, connectionInfo)`           | Client connected         |
| `clientDisconnected` | `(connectionId)`                           | Client disconnected      |
| `videoStreamed`      | `(streamData)`                             | Video data streamed      |
| `metadataReceived`   | `(metadata)`                               | Video metadata received  |
| `error`              | `(error)`                                  | Error occurred           |

---

## 🤝 Related Packages

- **[@caplaz/eufy-security-client](../eufy-security-client)** - Required WebSocket client
- **[@caplaz/eufy-security-cli](../eufy-security-cli)** - Command-line interface
- **[@caplaz/eufy-security-scrypted](../eufy-security-scrypted)** - Scrypted plugin

---

## 📄 License

MIT License - See [LICENSE](../../LICENSE) file for details

---

## 🙏 Credits

Built for the Eufy community

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
