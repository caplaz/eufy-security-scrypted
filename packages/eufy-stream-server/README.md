# Eufy Stream Server

A simplified TCP streaming server for raw H.264 video streams from Eufy security cameras.

## Features

- **Raw H.264 Streaming**: Direct streaming of H.264 video data without audio or MP4 fragmentation
- **TCP Server**: Simple TCP server that accepts multiple concurrent connections
- **NAL Unit Parsing**: Basic H.264 NAL unit extraction and key frame detection
- **Connection Management**: Handles multiple client connections with automatic cleanup
- **Statistics**: Basic streaming and connection statistics
- **Automatic Camera Control**: Automatically starts/stops camera streaming based on client connections
- **Zero Audio Complexity**: Completely removed audio processing from the legacy implementation

## Installation

```bash
npm install eufy-stream-server
```

## Usage

### Basic Example

```typescript
import { StreamServer } from "eufy-stream-server";

// Create server instance
const server = new StreamServer({
  port: 8080,
  host: "0.0.0.0",
  maxConnections: 10,
  debug: true,
  logger: myLogger, // Optional - external logger instance for consistent logging
  wsClient: eufyWebSocketClient, // Required - WebSocket client for Eufy camera
  serialNumber: "device123", // Required - Eufy camera serial number
});

// Start the server
await server.start();
console.log("Stream server started and listening for video data");

// The server will automatically start camera streaming when the first client connects
// and automatically stop camera streaming when the last client disconnects
// Video data is streamed automatically when WebSocket events are received

// Get server statistics
const stats = server.getStats();
console.log("Active connections:", stats.connections.active);
console.log("Frames processed:", stats.streaming.framesProcessed);

// Stop the server
await server.stop();
```

### Snapshot Capture

```typescript
// Capture a single snapshot frame
// This will start the stream, wait for a keyframe, and stop the stream automatically
try {
  const h264Keyframe = await server.captureSnapshot(15000); // 15 second timeout
  console.log(`Captured snapshot: ${h264Keyframe.length} bytes`);

  // Convert to JPEG or PNG using FFmpeg or other tools
  // The returned buffer is a raw H.264 keyframe
} catch (error) {
  console.error("Failed to capture snapshot:", error);
}
```

### Event Handling

```typescript
// Listen for client connections
server.on("clientConnected", (connectionId, connectionInfo) => {
  console.log(
    `Client ${connectionId} connected from ${connectionInfo.remoteAddress}`
  );
});

// Listen for client disconnections
server.on("clientDisconnected", (connectionId) => {
  console.log(`Client ${connectionId} disconnected`);
});

// Listen for video streaming events
server.on("videoStreamed", (streamData) => {
  console.log(
    `Streamed ${streamData.data.length} bytes, keyFrame: ${streamData.isKeyFrame}`
  );
});

// Listen for errors
server.on("error", (error) => {
  console.error("Server error:", error);
});
```

### H.264 Parser Usage

```typescript
import { H264Parser } from "eufy-stream-server";

const parser = new H264Parser(logger);

// Extract NAL units
const nalUnits = parser.extractNALUnits(h264Buffer);
console.log(
  "Found NAL units:",
  nalUnits.map((nal) => nal.type)
);

// Check if data contains key frame
const isKeyFrame = parser.isKeyFrame(h264Buffer);

// Extract basic video metadata
const metadata = parser.extractVideoMetadata(h264Buffer);
if (metadata) {
  console.log("Video profile:", metadata.profile);
  console.log("Video level:", metadata.level);
}
```

## API Reference

### StreamServer

#### Constructor Options

- `port?: number` - Server port (default: 8080)
- `host?: string` - Server host (default: '0.0.0.0')
- `maxConnections?: number` - Maximum concurrent connections (default: 10)
- `debug?: boolean` - Enable debug logging (default: false)
- `logger?: Logger<ILogObj>` - Optional external logger instance compatible with tslog's Logger interface for consistent logging across packages. Any logger implementing tslog-compatible methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) can be used. If not provided, the server will use its internal tslog logger.
- `wsClient: EufyWebSocketClient` - WebSocket client for receiving video data events (required for Eufy cameras)
- `serialNumber: string` - Device serial number to filter events (required for Eufy cameras)

#### Methods

- `start(): Promise<void>` - Start the TCP server
- `stop(): Promise<void>` - Stop the TCP server
- `streamVideo(data: Buffer, timestamp?: number, isKeyFrame?: boolean): Promise<boolean>` - Stream H.264 data
- `captureSnapshot(timeoutMs?: number): Promise<Buffer>` - Capture a single snapshot frame from the stream (starts stream if needed, captures keyframe, stops stream)
- `getStats(): ServerStats` - Get server statistics
- `getActiveConnectionCount(): number` - Get number of active connections
- `isRunning(): boolean` - Check if server is running
- `getVideoMetadata(): VideoMetadata | null` - Get video metadata from first received frame
- `waitForVideoMetadata(timeoutMs?: number): Promise<VideoMetadata>` - Wait for video metadata to be received

#### Events

- `started` - Server started successfully
- `stopped` - Server stopped
- `clientConnected(connectionId, connectionInfo)` - New client connected
- `clientDisconnected(connectionId)` - Client disconnected
- `videoStreamed(streamData)` - Video data streamed
- `error(error)` - Server error occurred

### Logger Compatibility

StreamServer accepts any logger compatible with tslog's `Logger<ILogObj>` interface. This allows for consistent logging across packages:

```typescript
import { Logger } from "tslog";
import { StreamServer } from "eufy-stream-server";

// Option 1: Use tslog directly
const tslogLogger = new Logger({
  name: "StreamServer",
  minLevel: 2, // 2=debug, 3=info
});

const server = new StreamServer({
  port: 8080,
  logger: tslogLogger,
  wsClient: eufyWebSocketClient,
  serialNumber: "device123",
});

// Option 2: Use any tslog-compatible logger
// Example: DebugLogger from eufy-security-scrypted package
// implements tslog-compatible methods (trace, debug, info, warn, error, fatal)
import { createDebugLogger } from "@caplaz/eufy-security-scrypted";

const debugLogger = createDebugLogger("StreamServer");
const server2 = new StreamServer({
  port: 8080,
  logger: debugLogger as any, // Cast to Logger<ILogObj> if needed
  wsClient: eufyWebSocketClient,
  serialNumber: "device123",
});
```

### H264Parser

#### Methods

- `extractNALUnits(data: Buffer): NALUnit[]` - Extract NAL units from H.264 data
- `isKeyFrame(data: Buffer): boolean` - Check if data contains key frame
- `extractVideoMetadata(data: Buffer): VideoMetadata | null` - Extract basic metadata
- `validateH264Data(data: Buffer): boolean` - Validate H.264 data structure

## Differences from Legacy Implementation

This simplified version removes the following complexity from the legacy eufy-stream-server:

- ❌ **Audio Processing**: No audio codec detection, AAC handling, or audio/video synchronization
- ❌ **MP4 Fragmentation**: No MP4 container creation or fragmentation
- ❌ **Complex Error Recovery**: No audio error recovery or extensive diagnostics
- ❌ **MPEG-TS Support**: No MPEG-TS muxing capabilities
- ❌ **Advanced Diagnostics**: No corruption detection or extensive monitoring

Instead, it focuses on:

- ✅ **Raw H.264 Only**: Direct streaming of raw H.264 video data
- ✅ **Simple TCP Server**: Basic TCP connection management
- ✅ **NAL Unit Parsing**: Essential H.264 structure parsing
- ✅ **Key Frame Detection**: Basic I-frame detection
- ✅ **Connection Statistics**: Simple streaming metrics

## License

MIT
