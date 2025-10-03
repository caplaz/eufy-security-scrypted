# @caplaz/eufy-stream-server# Eufy Stream Server



A lightweight TCP streaming server for raw H.264 video streams from Eufy security cameras. Provides simple, efficient video streaming without the complexity of audio processing or MP4 fragmentation.A simplified TCP streaming server for raw H.264 video streams from Eufy security cameras.



## Features## Features



- **Raw H.264 Streaming** - Direct H.264 video streaming over TCP- **Raw H.264 Streaming**: Direct streaming of H.264 video data without audio or MP4 fragmentation

- **NAL Unit Parsing** - H.264 structure parsing with keyframe detection- **TCP Server**: Simple TCP server that accepts multiple concurrent connections

- **Connection Management** - Handle multiple concurrent client connections- **NAL Unit Parsing**: Basic H.264 NAL unit extraction and key frame detection

- **Automatic Camera Control** - Start/stop camera streaming based on client activity- **Connection Management**: Handles multiple client connections with automatic cleanup

- **Snapshot Capture** - Capture single keyframe snapshots on demand- **Statistics**: Basic streaming and connection statistics

- **Event-Driven** - Real-time events for connections and streaming- **Automatic Camera Control**: Automatically starts/stops camera streaming based on client connections

- **Zero Audio Complexity** - Focused purely on video streaming- **Zero Audio Complexity**: Completely removed audio processing from the legacy implementation



## Installation## Installation



```bash```bash

npm install @caplaz/eufy-stream-servernpm install eufy-stream-server

``````



**Requirements:** Node.js ≥18.0.0, `@caplaz/eufy-security-client`## Usage



## Quick Start### Basic Example



```typescript```typescript

import { StreamServer } from "@caplaz/eufy-stream-server";import { StreamServer } from "eufy-stream-server";

import { EufySecurityClient } from "@caplaz/eufy-security-client";

// Create server instance

// Setup Eufy clientconst server = new StreamServer({

const eufyClient = new EufySecurityClient({  port: 8080,

  wsUrl: "ws://localhost:3000",  host: "0.0.0.0",

});  maxConnections: 10,

await eufyClient.connect();  debug: true,

  logger: myLogger, // Optional - external logger instance for consistent logging

// Create stream server  wsClient: eufyWebSocketClient, // Required - WebSocket client for Eufy camera

const server = new StreamServer({  serialNumber: "device123", // Required - Eufy camera serial number

  port: 8080,});

  wsClient: eufyClient,

  serialNumber: "T8210N20123456789",// Start the server

  debug: true,await server.start();

});console.log("Stream server started and listening for video data");



// Start server// The server will automatically start camera streaming when the first client connects

await server.start();// and automatically stop camera streaming when the last client disconnects

console.log("Stream server running on port 8080");// Video data is streamed automatically when WebSocket events are received



// Server automatically starts/stops camera streaming based on client connections// Get server statistics

```const stats = server.getStats();

console.log("Active connections:", stats.connections.active);

## Core APIconsole.log("Frames processed:", stats.streaming.framesProcessed);



### StreamServer// Stop the server

await server.stop();

TCP server that streams raw H.264 video data to connected clients.```



**Constructor**### Snapshot Capture



```typescript```typescript

const server = new StreamServer({// Capture a single snapshot frame

  port?: number,              // Default: 8080// This will start the stream, wait for a keyframe, and stop the stream automatically

  host?: string,              // Default: '0.0.0.0'try {

  maxConnections?: number,    // Default: 10  const h264Keyframe = await server.captureSnapshot(15000); // 15 second timeout

  debug?: boolean,            // Default: false  console.log(`Captured snapshot: ${h264Keyframe.length} bytes`);

  logger?: Logger<ILogObj>,   // Optional: Custom tslog logger

  wsClient: EufySecurityClient,  // Required: Eufy WebSocket client  // Convert to JPEG or PNG using FFmpeg or other tools

  serialNumber: string        // Required: Device serial number  // The returned buffer is a raw H.264 keyframe

});} catch (error) {

```  console.error("Failed to capture snapshot:", error);

}

**Methods**```



| Method                         | Description                                  |### Event Handling

| ------------------------------ | -------------------------------------------- |

| `start()`                      | Start the TCP server                         |```typescript

| `stop()`                       | Stop the server and cleanup resources        |// Listen for client connections

| `streamVideo(data, timestamp)` | Stream H.264 data to connected clients       |server.on("clientConnected", (connectionId, connectionInfo) => {

| `captureSnapshot(timeout?)`    | Capture single keyframe snapshot             |  console.log(

| `getStats()`                   | Get server and streaming statistics          |    `Client ${connectionId} connected from ${connectionInfo.remoteAddress}`

| `getActiveConnectionCount()`   | Get number of active client connections      |  );

| `isRunning()`                  | Check if server is running                   |});

| `getVideoMetadata()`           | Get video metadata from first received frame |

| `waitForVideoMetadata()`       | Wait for video metadata to be received       |// Listen for client disconnections

server.on("clientDisconnected", (connectionId) => {

**Events**  console.log(`Client ${connectionId} disconnected`);

});

```typescript

server.on("started", () => {// Listen for video streaming events

  console.log("Server started");server.on("videoStreamed", (streamData) => {

});  console.log(

    `Streamed ${streamData.data.length} bytes, keyFrame: ${streamData.isKeyFrame}`

server.on("stopped", () => {  );

  console.log("Server stopped");});

});

// Listen for errors

server.on("clientConnected", (connectionId, info) => {server.on("error", (error) => {

  console.log(`Client ${connectionId} connected from ${info.remoteAddress}`);  console.error("Server error:", error);

});});

```

server.on("clientDisconnected", (connectionId) => {

  console.log(`Client ${connectionId} disconnected`);### H.264 Parser Usage

});

```typescript

server.on("videoStreamed", (streamData) => {import { H264Parser } from "eufy-stream-server";

  console.log(`Streamed ${streamData.data.length} bytes, keyframe: ${streamData.isKeyFrame}`);

});const parser = new H264Parser(logger);



server.on("metadataReceived", (metadata) => {// Extract NAL units

  console.log(`Video: ${metadata.videoWidth}x${metadata.videoHeight} @ ${metadata.videoFPS}fps`);const nalUnits = parser.extractNALUnits(h264Buffer);

});console.log(

  "Found NAL units:",

server.on("error", (error) => {  nalUnits.map((nal) => nal.type)

  console.error("Server error:", error););

});

```// Check if data contains key frame

const isKeyFrame = parser.isKeyFrame(h264Buffer);

**Statistics**

// Extract basic video metadata

```typescriptconst metadata = parser.extractVideoMetadata(h264Buffer);

const stats = server.getStats();if (metadata) {

  console.log("Video profile:", metadata.profile);

console.log("Server active:", stats.isActive);  console.log("Video level:", metadata.level);

console.log("Uptime:", stats.uptime, "ms");}

console.log("Active connections:", stats.connections.active);```

console.log("Frames processed:", stats.streaming.framesProcessed);

console.log("Bytes transferred:", stats.streaming.bytesTransferred);## API Reference

```

### StreamServer

### H264Parser

#### Constructor Options

Parse H.264 data structures and extract NAL units.

- `port?: number` - Server port (default: 8080)

**Methods**- `host?: string` - Server host (default: '0.0.0.0')

- `maxConnections?: number` - Maximum concurrent connections (default: 10)

| Method                      | Description                            |- `debug?: boolean` - Enable debug logging (default: false)

| --------------------------- | -------------------------------------- |- `logger?: Logger<ILogObj>` - Optional external logger instance compatible with tslog's Logger interface for consistent logging across packages. Any logger implementing tslog-compatible methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) can be used. If not provided, the server will use its internal tslog logger.

| `extractNALUnits(data)`     | Extract all NAL units from H.264 data  |- `wsClient: EufyWebSocketClient` - WebSocket client for receiving video data events (required for Eufy cameras)

| `isKeyFrame(data)`          | Check if data contains a keyframe      |- `serialNumber: string` - Device serial number to filter events (required for Eufy cameras)

| `validateH264Data(data)`    | Validate H.264 data structure          |

| `getNALTypeName(type)`      | Get human-readable NAL type name       |#### Methods



**Example**- `start(): Promise<void>` - Start the TCP server

- `stop(): Promise<void>` - Stop the TCP server

```typescript- `streamVideo(data: Buffer, timestamp?: number, isKeyFrame?: boolean): Promise<boolean>` - Stream H.264 data

import { H264Parser } from "@caplaz/eufy-stream-server";- `captureSnapshot(timeoutMs?: number): Promise<Buffer>` - Capture a single snapshot frame from the stream (starts stream if needed, captures keyframe, stops stream)

- `getStats(): ServerStats` - Get server statistics

const parser = new H264Parser(logger);- `getActiveConnectionCount(): number` - Get number of active connections

- `isRunning(): boolean` - Check if server is running

// Extract NAL units- `getVideoMetadata(): VideoMetadata | null` - Get video metadata from first received frame

const nalUnits = parser.extractNALUnits(h264Buffer);- `waitForVideoMetadata(timeoutMs?: number): Promise<VideoMetadata>` - Wait for video metadata to be received

console.log("NAL units:", nalUnits.map(nal => nal.type));

#### Events

// Check for keyframe

const isKeyFrame = parser.isKeyFrame(h264Buffer);- `started` - Server started successfully

console.log("Is keyframe:", isKeyFrame);- `stopped` - Server stopped

- `clientConnected(connectionId, connectionInfo)` - New client connected

// Validate structure- `clientDisconnected(connectionId)` - Client disconnected

const isValid = parser.validateH264Data(h264Buffer);- `videoStreamed(streamData)` - Video data streamed

```- `error(error)` - Server error occurred



## Usage Examples### Logger Compatibility



### Basic Streaming ServerStreamServer accepts any logger compatible with tslog's `Logger<ILogObj>` interface. This allows for consistent logging across packages:



```typescript```typescript

import { StreamServer } from "@caplaz/eufy-stream-server";import { Logger } from "tslog";

import { EufySecurityClient } from "@caplaz/eufy-security-client";import { StreamServer } from "eufy-stream-server";



async function startStreamServer() {// Option 1: Use tslog directly

  // Setup Eufy clientconst tslogLogger = new Logger({

  const client = new EufySecurityClient({  name: "StreamServer",

    wsUrl: "ws://localhost:3000",  minLevel: 2, // 2=debug, 3=info

  });});

  await client.connect();

const server = new StreamServer({

  // Create and start server  port: 8080,

  const server = new StreamServer({  logger: tslogLogger,

    port: 8080,  wsClient: eufyWebSocketClient,

    wsClient: client,  serialNumber: "device123",

    serialNumber: "T8210N20123456789",});

  });

// Option 2: Use any tslog-compatible logger

  await server.start();// Example: DebugLogger from eufy-security-scrypted package

  console.log("✅ Stream server started on port 8080");// implements tslog-compatible methods (trace, debug, info, warn, error, fatal)

import { createDebugLogger } from "@caplaz/eufy-security-scrypted";

  // Handle events

  server.on("clientConnected", (id, info) => {const debugLogger = createDebugLogger("StreamServer");

    console.log(`📱 Client ${id} connected from ${info.remoteAddress}`);const server2 = new StreamServer({

  });  port: 8080,

  logger: debugLogger as any, // Cast to Logger<ILogObj> if needed

  server.on("clientDisconnected", (id) => {  wsClient: eufyWebSocketClient,

    console.log(`👋 Client ${id} disconnected`);  serialNumber: "device123",

  });});

```

  // Graceful shutdown

  process.on("SIGINT", async () => {### H264Parser

    await server.stop();

    await client.disconnect();#### Methods

    process.exit(0);

  });- `extractNALUnits(data: Buffer): NALUnit[]` - Extract NAL units from H.264 data

}- `isKeyFrame(data: Buffer): boolean` - Check if data contains key frame

- `extractVideoMetadata(data: Buffer): VideoMetadata | null` - Extract basic metadata

startStreamServer();- `validateH264Data(data: Buffer): boolean` - Validate H.264 data structure

```

## Differences from Legacy Implementation

### Snapshot Capture

This simplified version removes the following complexity from the legacy eufy-stream-server:

```typescript

import { StreamServer } from "@caplaz/eufy-stream-server";- ❌ **Audio Processing**: No audio codec detection, AAC handling, or audio/video synchronization

- ❌ **MP4 Fragmentation**: No MP4 container creation or fragmentation

async function captureSnapshot(server: StreamServer) {- ❌ **Complex Error Recovery**: No audio error recovery or extensive diagnostics

  try {- ❌ **MPEG-TS Support**: No MPEG-TS muxing capabilities

    // Capture a snapshot (automatically starts/stops stream if needed)- ❌ **Advanced Diagnostics**: No corruption detection or extensive monitoring

    const keyframe = await server.captureSnapshot(15000); // 15s timeout

    Instead, it focuses on:

    console.log(`✅ Captured snapshot: ${keyframe.length} bytes`);

    - ✅ **Raw H.264 Only**: Direct streaming of raw H.264 video data

    // Save to file- ✅ **Simple TCP Server**: Basic TCP connection management

    await fs.writeFile("snapshot.h264", keyframe);- ✅ **NAL Unit Parsing**: Essential H.264 structure parsing

    - ✅ **Key Frame Detection**: Basic I-frame detection

    // Or convert with FFmpeg- ✅ **Connection Statistics**: Simple streaming metrics

    // ffmpeg -i snapshot.h264 -frames:v 1 snapshot.jpg

  } catch (error) {## License

    console.error("❌ Snapshot capture failed:", error.message);

  }MIT

}
```

### Multi-Camera Streaming

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";
import { EufySecurityClient } from "@caplaz/eufy-security-client";

async function startMultiCameraServer() {
  const client = new EufySecurityClient({
    wsUrl: "ws://localhost:3000",
  });
  await client.connect();

  const devices = await client.getDevices();
  const servers: StreamServer[] = [];

  // Create server for each camera
  for (const [index, device] of devices.entries()) {
    const server = new StreamServer({
      port: 8080 + index,
      wsClient: client,
      serialNumber: device.serialNumber,
    });

    await server.start();
    servers.push(server);

    console.log(`📹 ${device.name} streaming on port ${8080 + index}`);
  }

  // Cleanup on exit
  process.on("SIGINT", async () => {
    for (const server of servers) {
      await server.stop();
    }
    await client.disconnect();
    process.exit(0);
  });
}
```

### Monitor Streaming Activity

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";

async function monitorStream(server: StreamServer) {
  // Log streaming statistics every 10 seconds
  setInterval(() => {
    const stats = server.getStats();
    
    if (stats.isActive && stats.connections.active > 0) {
      console.log(`
📊 Stream Statistics:
  - Active clients: ${stats.connections.active}
  - Uptime: ${Math.round(stats.uptime / 1000)}s
  - Frames processed: ${stats.streaming.framesProcessed}
  - Data transferred: ${(stats.streaming.bytesTransferred / 1024 / 1024).toFixed(2)} MB
  - Last frame: ${stats.streaming.lastFrameTime?.toLocaleTimeString() || 'N/A'}
      `);
    }
  }, 10000);

  // Log video metadata when received
  server.once("metadataReceived", (metadata) => {
    console.log(`
📐 Video Metadata:
  - Resolution: ${metadata.videoWidth}x${metadata.videoHeight}
  - Frame rate: ${metadata.videoFPS} fps
  - Codec: ${metadata.videoCodec}
    `);
  });
}
```

### Custom Logger Integration

```typescript
import { StreamServer } from "@caplaz/eufy-stream-server";
import { Logger } from "tslog";

// Use tslog
const logger = new Logger({
  name: "StreamServer",
  minLevel: 2, // 2=debug, 3=info
});

const server = new StreamServer({
  port: 8080,
  logger: logger,
  wsClient: client,
  serialNumber: "T8210N20123456789",
});

// Or use custom logger (must implement tslog interface)
const customLogger = {
  trace: (...args) => console.log("[TRACE]", ...args),
  debug: (...args) => console.log("[DEBUG]", ...args),
  info: (...args) => console.log("[INFO]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  fatal: (...args) => console.error("[FATAL]", ...args),
};
```

## Configuration

### Server Options

```typescript
const server = new StreamServer({
  // Network Configuration
  port: 8080,           // TCP port to listen on
  host: "0.0.0.0",      // Bind to all interfaces (or "localhost" for local only)
  
  // Connection Limits
  maxConnections: 10,   // Maximum concurrent client connections
  
  // Debugging
  debug: true,          // Enable detailed logging
  logger: customLogger, // Optional custom logger
  
  // Eufy Integration (Required)
  wsClient: eufyClient,         // EufySecurityClient instance
  serialNumber: "T8210...",     // Device serial number to stream from
});
```

### Performance Tuning

For optimal performance based on your use case:

**Low Latency (Live Monitoring)**
- Use wired network connection for camera and server
- Enable `debug: false` to reduce logging overhead
- Keep `maxConnections` low (1-2 clients)

**Multiple Viewers**
- Increase `maxConnections` based on network capacity
- Monitor bandwidth: ~2-5 Mbps per stream
- Use local network to reduce latency

**Snapshot Mode**
- Use `captureSnapshot()` instead of continuous streaming
- Automatically starts/stops camera to save battery
- Perfect for battery-powered cameras

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  StreamServer (TCP Server)                          │
│  ┌────────────────────────────────────────────────┐ │
│  │  ConnectionManager                             │ │
│  │  • Handle TCP client connections               │ │
│  │  • Broadcast data to clients                   │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │  H264Parser                                    │ │
│  │  • Parse NAL units                             │ │
│  │  • Detect keyframes                            │ │
│  └────────────────────────────────────────────────┘ │
└────────────────┬────────────────────────────────────┘
                 │ Listen for video events
                 ▼
┌─────────────────────────────────────────────────────┐
│  EufySecurityClient (WebSocket)                     │
│  • Connect to eufy-security-ws server               │
│  • Receive video data events                        │
│  • Control camera streaming                         │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  Eufy Camera (via eufy-security-ws)                 │
│  • H.264 video encoding                             │
│  • P2P or cloud streaming                           │
└─────────────────────────────────────────────────────┘
```

## Comparison with Legacy Implementation

This simplified version focuses on core streaming functionality:

### Removed Complexity

- ❌ **Audio Processing** - No audio codec detection, AAC handling, or A/V sync
- ❌ **MP4 Fragmentation** - No MP4 container creation
- ❌ **MPEG-TS Support** - No MPEG-TS muxing
- ❌ **Complex Diagnostics** - Simplified error handling

### Core Focus

- ✅ **Raw H.264 Streaming** - Direct video data over TCP
- ✅ **Simple Connection Management** - Basic TCP client handling
- ✅ **Essential NAL Parsing** - Keyframe detection and validation
- ✅ **Automatic Camera Control** - Start/stop based on client activity
- ✅ **Clean API** - Easy to integrate and use

## Troubleshooting

| Problem                    | Solution                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| **Server won't start**     | • Check port is not in use<br>• Verify permissions for port binding                   |
| **No video data**          | • Verify Eufy client is connected<br>• Check device serial number<br>• Enable debug logging |
| **Clients can't connect**  | • Check firewall settings<br>• Verify host/port configuration<br>• Test with `telnet` |
| **Stream stuttering**      | • Check network bandwidth<br>• Monitor active connections<br>• Reduce maxConnections  |
| **High memory usage**      | • Monitor connection count<br>• Check for connection leaks<br>• Review client cleanup |
| **Snapshot timeout**       | • Increase timeout value<br>• Check camera is online<br>• Verify livestream starts   |

### Debug Logging

Enable detailed logging to diagnose issues:

```typescript
const server = new StreamServer({
  port: 8080,
  debug: true,  // Enable debug logs
  wsClient: client,
  serialNumber: "T8210N20123456789",
});

// Or use custom logger with debug level
import { Logger } from "tslog";

const logger = new Logger({
  name: "StreamServer",
  minLevel: 2, // 0=silly, 1=trace, 2=debug, 3=info
});
```

## Testing Stream Server

Test your stream server with common tools:

### Using FFmpeg

```bash
# Stream to FFmpeg
ffmpeg -i tcp://localhost:8080 -c copy output.mp4

# Play stream directly
ffplay tcp://localhost:8080

# Extract snapshot
ffmpeg -i tcp://localhost:8080 -frames:v 1 snapshot.jpg
```

### Using VLC

```
Media → Open Network Stream → tcp://localhost:8080
```

### Using netcat

```bash
# Test raw connection
nc localhost 8080 > stream.h264
```

## API Compatibility

| Package Version | Client Version | Status       |
| --------------- | -------------- | ------------ |
| 0.1.x           | 0.1.x          | ✅ Supported |

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Add tests: `npm test`
4. Ensure coverage ≥75%: `npm run test:coverage`
5. Submit pull request

## License

MIT License - see [LICENSE](LICENSE) file

## Related Packages

- [`@caplaz/eufy-security-client`](../eufy-security-client) - WebSocket client for Eufy devices
- [`@caplaz/eufy-security-cli`](../eufy-security-cli) - Command-line interface
- [`@caplaz/eufy-security-scrypted`](../eufy-security-scrypted) - Scrypted plugin integration
