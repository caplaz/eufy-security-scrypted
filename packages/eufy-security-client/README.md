# @scrypted/eufy-security-client

A TypeScript WebSocket client library for communicating with the `eufy-security-ws` server. This package provides type-safe event handling and device management for Eufy security cameras and doorbells.

## Why This Package Exists

Modern Node.js versions don't support the deprecated security encryption used by Eufy cameras. This package connects to an external `eufy-security-ws` server that handles the legacy encryption, providing a clean WebSocket API for modern applications.

## Installation

```bash
npm install @scrypted/eufy-security-client
```

## Requirements

- Node.js 18.0.0 or higher
- A running `eufy-security-ws` server instance

## Quick Start

```typescript
import { EufySecurityClient } from '@scrypted/eufy-security-client';

const client = new EufySecurityClient({
  wsUrl: 'ws://localhost:3000',
});

// Connect to the server
await client.connect();

// Get all devices
const devices = await client.getDevices();
console.log('Available devices:', devices);

// Start streaming from a device
await client.startStream('T8210N20123456789');

// Listen for stream data
client.on('streamData', data => {
  console.log(`Received ${data.type} data: ${data.buffer.length} bytes`);
});

// Stop streaming
await client.stopStream('T8210N20123456789');

// Disconnect
await client.disconnect();
```

## API Reference

### EufySecurityClient

The main high-level client for CLI and application usage.

#### Constructor

```typescript
new EufySecurityClient(config: EufySecurityClientConfig)
```

**Parameters:**

- `config.wsUrl` (string): WebSocket URL for the eufy-security-ws server
- `config.logger` (optional): Custom logger implementation

#### Methods

##### `connect(): Promise<void>`

Establishes WebSocket connection, performs schema negotiation, connects to the driver, and loads available devices.

```typescript
await client.connect();
```

##### `disconnect(): Promise<void>`

Gracefully closes the WebSocket connection and cleans up resources.

```typescript
await client.disconnect();
```

##### `isConnected(): boolean`

Returns true if the client is connected and ready for operations.

```typescript
if (client.isConnected()) {
  // Client is ready
}
```

##### `getDevices(): Promise<DeviceInfo[]>`

Retrieves all available devices from the connected Eufy account.

```typescript
const devices = await client.getDevices();
devices.forEach(device => {
  console.log(`${device.name} (${device.serialNumber}) - ${device.type}`);
});
```

##### `startStream(deviceSerial: string): Promise<void>`

Starts live streaming from the specified device.

```typescript
await client.startStream('T8210N20123456789');
```

##### `stopStream(deviceSerial: string): Promise<void>`

Stops live streaming from the specified device.

```typescript
await client.stopStream('T8210N20123456789');
```

#### Events

The client extends EventEmitter and emits the following events:

##### `streamStarted`

Emitted when streaming starts for a device.

```typescript
client.on('streamStarted', event => {
  console.log('Stream started for device:', event.serialNumber);
});
```

##### `streamStopped`

Emitted when streaming stops for a device.

```typescript
client.on('streamStopped', event => {
  console.log('Stream stopped for device:', event.serialNumber);
});
```

##### `streamData`

Emitted when video or audio data is received.

```typescript
client.on('streamData', data => {
  console.log(`${data.type} data: ${data.buffer.length} bytes`);
  console.log('Device:', data.deviceSerial);

  if (data.type === 'video' && data.metadata) {
    console.log('Video dimensions:', data.metadata.width, 'x', data.metadata.height);
  }
});
```

### Low-Level APIs

For advanced usage, you can use the lower-level APIs:

#### ApiManager

Direct WebSocket API manager with full control over commands and events.

```typescript
import { ApiManager } from '@scrypted/eufy-security-client';

const apiManager = new ApiManager('ws://localhost:3000', logger);
await apiManager.connect();
await apiManager.connectDriver();
await apiManager.startListening();

// Send raw commands
const devices = await apiManager.sendCommand('server.get_devices');

// Listen for specific events
apiManager.addEventListener('motion_detected', event => {
  console.log('Motion detected:', event);
});
```

#### WebSocketClient

Raw WebSocket client with connection management.

```typescript
import { WebSocketClient } from '@scrypted/eufy-security-client';

const wsClient = new WebSocketClient('ws://localhost:3000', stateManager, logger);
await wsClient.connect();
```

### Types and Interfaces

#### DeviceInfo

```typescript
interface DeviceInfo {
  name: string; // Human-readable device name
  serialNumber: string; // Unique device identifier
  type: string; // Device type (Camera, Doorbell, etc.)
  stationSerial?: string; // Associated station serial
  model?: string; // Device model
  hardwareVersion?: string; // Hardware version
  softwareVersion?: string; // Firmware version
}
```

#### EufySecurityClientConfig

```typescript
interface EufySecurityClientConfig {
  wsUrl: string; // WebSocket server URL
  logger?: {
    // Optional custom logger
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
  };
}
```

## Advanced Usage

### Custom Logger

```typescript
import { EufySecurityClient } from '@scrypted/eufy-security-client';

const customLogger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[DEBUG] ${msg}`, ...args),
};

const client = new EufySecurityClient({
  wsUrl: 'ws://localhost:3000',
  logger: customLogger,
});
```

### Error Handling

```typescript
try {
  await client.connect();
} catch (error) {
  console.error('Connection failed:', error.message);

  if (error.message.includes('timeout')) {
    console.log('Server may not be running or accessible');
  }
}

// Handle stream errors
client.on('error', error => {
  console.error('Client error:', error);
});
```

### Stream Data Processing

```typescript
import { writeFileSync } from 'fs';

let videoChunks: Buffer[] = [];
let audioChunks: Buffer[] = [];

client.on('streamData', data => {
  if (data.type === 'video') {
    videoChunks.push(data.buffer);

    // Save video data periodically
    if (videoChunks.length > 100) {
      const videoData = Buffer.concat(videoChunks);
      writeFileSync('stream_video.h264', videoData);
      videoChunks = [];
    }
  } else if (data.type === 'audio') {
    audioChunks.push(data.buffer);

    // Save audio data periodically
    if (audioChunks.length > 50) {
      const audioData = Buffer.concat(audioChunks);
      writeFileSync('stream_audio.aac', audioData);
      audioChunks = [];
    }
  }
});
```

## Troubleshooting

### Connection Issues

**Problem**: `Error: Connection failed`

**Solutions**:

1. Verify the `eufy-security-ws` server is running:

   ```bash
   docker ps | grep eufy-security-ws
   ```

2. Check the WebSocket URL is correct:

   ```typescript
   // Correct format
   const client = new EufySecurityClient({
     wsUrl: 'ws://localhost:3000', // or your server's IP/port
   });
   ```

3. Ensure the server is accessible:
   ```bash
   curl -I http://localhost:3000
   ```

**Problem**: `Timeout waiting for client to be ready`

**Solutions**:

1. Check server logs for authentication issues
2. Verify Eufy account credentials in the server configuration
3. Increase timeout if network is slow:
   ```typescript
   // The timeout is currently hardcoded to 10 seconds
   // You may need to modify the source if needed
   ```

### Authentication Issues

**Problem**: `Failed to connect to driver`

**Solutions**:

1. Verify Eufy account credentials in the `eufy-security-ws` server
2. Check if 2FA is enabled on your Eufy account (may require special handling)
3. Ensure the server has proper network access to Eufy's servers

### Streaming Issues

**Problem**: `Device not found` when starting stream

**Solutions**:

1. Verify the device serial number is correct:

   ```typescript
   const devices = await client.getDevices();
   console.log(
     'Available devices:',
     devices.map(d => d.serialNumber)
   );
   ```

2. Ensure the device is online and accessible
3. Check if the device supports streaming

**Problem**: No stream data received

**Solutions**:

1. Verify the device is actually streaming:

   ```typescript
   client.on('streamStarted', () => {
     console.log('Stream confirmed started');
   });
   ```

2. Check for stream errors:

   ```typescript
   client.on('error', error => {
     console.error('Stream error:', error);
   });
   ```

3. Ensure proper event listeners are set up before starting the stream

### Performance Issues

**Problem**: High memory usage

**Solutions**:

1. Process stream data in chunks rather than accumulating:

   ```typescript
   client.on('streamData', data => {
     // Process immediately instead of storing
     processStreamData(data.buffer);
   });
   ```

2. Stop streams when not needed:

   ```typescript
   // Always stop streams when done
   await client.stopStream(deviceSerial);
   ```

3. Disconnect when finished:
   ```typescript
   await client.disconnect();
   ```

## Examples

### Basic Device Listing

```typescript
import { EufySecurityClient } from '@scrypted/eufy-security-client';

async function listDevices() {
  const client = new EufySecurityClient({
    wsUrl: 'ws://localhost:3000',
  });

  try {
    await client.connect();
    const devices = await client.getDevices();

    console.log(`Found ${devices.length} devices:`);
    devices.forEach((device, index) => {
      console.log(`${index + 1}. ${device.name}`);
      console.log(`   Serial: ${device.serialNumber}`);
      console.log(`   Type: ${device.type}`);
      console.log(`   Model: ${device.model}`);
      console.log('');
    });
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.disconnect();
  }
}

listDevices();
```

### Stream Recording

```typescript
import { EufySecurityClient } from '@scrypted/eufy-security-client';
import { createWriteStream } from 'fs';

async function recordStream(deviceSerial: string, durationMs: number) {
  const client = new EufySecurityClient({
    wsUrl: 'ws://localhost:3000',
  });

  const videoStream = createWriteStream(`${deviceSerial}_video.h264`);
  const audioStream = createWriteStream(`${deviceSerial}_audio.aac`);

  try {
    await client.connect();

    client.on('streamData', data => {
      if (data.type === 'video') {
        videoStream.write(data.buffer);
      } else if (data.type === 'audio') {
        audioStream.write(data.buffer);
      }
    });

    await client.startStream(deviceSerial);
    console.log(`Recording for ${durationMs / 1000} seconds...`);

    // Record for specified duration
    setTimeout(async () => {
      await client.stopStream(deviceSerial);
      videoStream.end();
      audioStream.end();
      await client.disconnect();
      console.log('Recording complete');
    }, durationMs);
  } catch (error) {
    console.error('Recording error:', error.message);
    videoStream.end();
    audioStream.end();
    await client.disconnect();
  }
}

// Record for 30 seconds
recordStream('T8210N20123456789', 30000);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite: `npm test`
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Related Packages

- `@scrypted/eufy-camera-cli` - Command-line interface using this client
- `@scrypted/eufy-security-scrypted` - Scrypted plugin integration
- `@scrypted/eufy-stream-server` - TCP streaming server for H.264/AAC data
- `@scrypted/eufy-stream-testing-validation` - Testing and validation utilities
