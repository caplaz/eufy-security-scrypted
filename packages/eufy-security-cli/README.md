# @scrypted/eufy-security-cli

A command-line interface for Eufy Security camera control and streaming. Stream live video directly from your Eufy cameras to media players like ffplay, VLC, and MPV.

## Why This Package Exists

Modern Node.js versions don't support the deprecated security encryption used by Eufy cameras. This CLI connects to an external `eufy-security-ws` server that handles the legacy encryption, providing a clean interface for streaming camera feeds.

## Installation

```bash
npm install -g @scrypted/eufy-security-cli
```

## Requirements

- Node.js 18.0.0 or higher
- A running `eufy-security-ws` server instance
- Media player (ffplay, VLC, MPV, etc.) for viewing streams

## Quick Start

1. **List available devices:**

   ```bash
   eufy-security-cli list-devices --ws-host 192.168.1.100:3000
   ```

2. **Start streaming:**

   ```bash
   eufy-security-cli stream --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789
   ```

3. **Connect with a media player:**
   ```bash
   # The CLI will show the actual port, e.g., "TCP Server: localhost:45123"
   ffplay tcp://localhost:45123
   ```

## Commands

### `list-devices`

List all available camera devices from your Eufy account.

```bash
eufy-security-cli list-devices --ws-host <host>
```

**Options:**

- `--ws-host, -w <host>` - WebSocket server host (required)
- `--verbose, -v` - Enable verbose logging
- `--help, -h` - Show help

**Example:**

```bash
eufy-security-cli list-devices --ws-host 192.168.1.100:3000
```

**Output:**

```
📋 Available Eufy Security Devices
================================================================================

📱 Cameras (2):
----------------------------------------
1. Front Door Camera
   Serial: T8210N20123456789
   Model: T8210
   Station: T8010P20123456789
   Hardware: 1.0.0.1
   Software: 2.1.7.9

2. Backyard Camera
   Serial: T8410P20987654321
   Model: T8410P
   Station: T8010P20123456789
   Hardware: 1.0.0.2
   Software: 2.1.7.9

📊 Total: 2 device(s) found
```

### `device-info`

Show detailed information about a specific device.

```bash
eufy-security-cli device-info --ws-host <host> --camera-serial <serial>
```

**Options:**

- `--ws-host, -w <host>` - WebSocket server host (required)
- `--camera-serial, -c <serial>` - Camera serial number (required)
- `--verbose, -v` - Enable verbose logging
- `--help, -h` - Show help

**Example:**

```bash
eufy-security-cli device-info --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789
```

### `stream`

Start streaming from a camera device to a TCP server that media players can connect to.

```bash
eufy-security-cli stream --ws-host <host> --camera-serial <serial> [options]
```

**Options:**

- `--ws-host, -w <host>` - WebSocket server host (required)
- `--camera-serial, -c <serial>` - Camera serial number (required)
- `--port, -p <port>` - TCP server port (default: random available port)
- `--output-format, -f <format>` - Output format: `raw-h264` or `mp4` (default: raw-h264)
- `--verbose, -v` - Enable verbose logging
- `--help, -h` - Show help

**Examples:**

```bash
# Basic streaming
eufy-security-cli stream --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789

# Stream with specific port
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -p 8080

# Stream with MP4 format (includes audio if available)
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -f mp4

# Stream with verbose logging
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -v
```

### `monitor`

Monitor camera connection status and streaming health.

```bash
eufy-security-cli monitor --ws-host <host> --camera-serial <serial>
```

**Options:**

- `--ws-host, -w <host>` - WebSocket server host (required)
- `--camera-serial, -c <serial>` - Camera serial number (required)
- `--verbose, -v` - Enable verbose logging
- `--help, -h` - Show help

## Output Formats

### Raw H.264 (`raw-h264`)

- **Best for:** Live streaming, low latency, maximum compatibility
- **Contains:** Video only (H.264 stream)
- **Pros:** Minimal processing overhead, works with all media players
- **Cons:** No audio

```bash
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -f raw-h264
```

### MP4 Container (`mp4`)

- **Best for:** Recording, playback with audio
- **Contains:** Video (H.264) + Audio (AAC) if available
- **Pros:** Includes audio when supported by camera
- **Cons:** Slightly higher processing overhead

```bash
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -f mp4
```

## Media Player Integration

### ffplay (Recommended)

**Basic usage:**

```bash
ffplay tcp://localhost:<port>
```

**Optimized for live streaming:**

```bash
ffplay -fflags nobuffer -flags low_delay tcp://localhost:<port>
```

**For MP4 format with audio:**

```bash
ffplay -f mp4 tcp://localhost:<port>
ffplay -probesize 32 -analyzeduration 1000000 tcp://localhost:<port>
```

### VLC Media Player

```bash
vlc tcp://localhost:<port>
```

Or through VLC GUI:

1. Open VLC
2. Media → Open Network Stream
3. Enter: `tcp://localhost:<port>`
4. Click Play

### MPV

```bash
mpv tcp://localhost:<port>
```

### Custom Applications

The CLI provides a standard TCP server that any application can connect to:

```python
# Python example
import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(('localhost', port))

while True:
    data = sock.recv(4096)
    if not data:
        break
    # Process H.264/MP4 data
    process_video_data(data)
```

## Stream Lifecycle

1. **Startup:** CLI connects to WebSocket server and discovers the camera
2. **TCP Server:** Starts and waits for media player connections
3. **Auto-Start:** When a player connects, camera streaming begins automatically
4. **Multi-Client:** Multiple players can connect to the same stream
5. **Auto-Stop:** Stream stops 30 seconds after the last player disconnects
6. **Cleanup:** Resources are cleaned up when CLI is terminated

## Advanced Usage

### Environment Variables

Set default values using environment variables:

```bash
export EUFY_WS_HOST=192.168.1.100:3000
export EUFY_CAMERA_SERIAL=T8210N20123456789

# Now you can use shorter commands
eufy-security-cli stream
```

### Scripting and Automation

**Automated recording script:**

```bash
#!/bin/bash
CAMERA_SERIAL="T8210N20123456789"
WS_HOST="192.168.1.100:3000"
DURATION=300  # 5 minutes

# Start streaming in background
eufy-security-cli stream -w $WS_HOST -c $CAMERA_SERIAL -p 8080 &
CLI_PID=$!

# Wait for server to start
sleep 3

# Record for specified duration
timeout $DURATION ffmpeg -i tcp://localhost:8080 -c copy recording_$(date +%Y%m%d_%H%M%S).h264

# Stop the CLI
kill $CLI_PID
```

**Health monitoring script:**

```bash
#!/bin/bash
while true; do
    eufy-security-cli monitor -w 192.168.1.100:3000 -c T8210N20123456789
    if [ $? -ne 0 ]; then
        echo "Camera connection failed, retrying in 30 seconds..."
        sleep 30
    else
        break
    fi
done
```

### Multiple Camera Streaming

Stream from multiple cameras simultaneously:

```bash
# Terminal 1
eufy-security-cli stream -w 192.168.1.100:3000 -c CAMERA1_SERIAL -p 8081

# Terminal 2
eufy-security-cli stream -w 192.168.1.100:3000 -c CAMERA2_SERIAL -p 8082

# Terminal 3
eufy-security-cli stream -w 192.168.1.100:3000 -c CAMERA3_SERIAL -p 8083
```

Then connect media players to each port:

```bash
ffplay tcp://localhost:8081  # Camera 1
ffplay tcp://localhost:8082  # Camera 2
ffplay tcp://localhost:8083  # Camera 3
```

## Troubleshooting

### Connection Issues

**Problem:** `❌ Failed to connect to WebSocket server`

**Solutions:**

1. Verify the server is running:

   ```bash
   curl -I http://192.168.1.100:3000
   ```

2. Check the WebSocket URL format:

   ```bash
   # Correct formats:
   eufy-security-cli list-devices -w 192.168.1.100:3000
   eufy-security-cli list-devices -w ws://192.168.1.100:3000
   ```

3. Test network connectivity:
   ```bash
   ping 192.168.1.100
   telnet 192.168.1.100 3000
   ```

**Problem:** `❌ Timeout waiting for client to be ready`

**Solutions:**

1. Check server logs for authentication issues
2. Verify Eufy account credentials in server configuration
3. Ensure server has internet access to reach Eufy's servers

### Device Issues

**Problem:** `❌ Camera device not found`

**Solutions:**

1. List available devices to verify serial number:

   ```bash
   eufy-security-cli list-devices -w 192.168.1.100:3000
   ```

2. Check serial number format (should be 10-20 alphanumeric characters)
3. Ensure device is online in the Eufy app

**Problem:** `❌ No devices found on the server`

**Solutions:**

1. Check server configuration and Eufy account credentials
2. Verify devices are properly set up in the Eufy Security app
3. Check server logs for connection issues with Eufy services

### Streaming Issues

**Problem:** `❌ Port already in use`

**Solutions:**

1. Use a different port:

   ```bash
   eufy-security-cli stream -w 192.168.1.100:3000 -c SERIAL -p 8081
   ```

2. Use automatic port assignment:

   ```bash
   eufy-security-cli stream -w 192.168.1.100:3000 -c SERIAL -p 0
   ```

3. Find and stop the process using the port:
   ```bash
   lsof -ti:8080 | xargs kill
   ```

**Problem:** Media player can't connect or shows no video

**Solutions:**

1. Verify the TCP server is running (check CLI output for port number)
2. Try different media player commands:

   ```bash
   # Basic
   ffplay tcp://localhost:<port>

   # With buffering disabled
   ffplay -fflags nobuffer -flags low_delay tcp://localhost:<port>

   # For MP4 format
   ffplay -f mp4 tcp://localhost:<port>
   ```

3. Check firewall settings (ensure localhost connections are allowed)

**Problem:** Video plays but no audio (MP4 format)

**Solutions:**

1. Check if camera supports audio:

   ```bash
   eufy-security-cli stream -w HOST -c SERIAL -f mp4 -v
   # Look for "Audio packet" messages in logs
   ```

2. Try audio-specific ffplay options:

   ```bash
   ffplay -probesize 32 -analyzeduration 1000000 tcp://localhost:<port>
   ```

3. Some cameras don't support audio - use raw-h264 format for video-only:
   ```bash
   eufy-security-cli stream -w HOST -c SERIAL -f raw-h264
   ```

### Performance Issues

**Problem:** High CPU usage or memory consumption

**Solutions:**

1. Use raw-h264 format instead of MP4:

   ```bash
   eufy-security-cli stream -w HOST -c SERIAL -f raw-h264
   ```

2. Limit concurrent connections by using specific ports
3. Monitor with verbose logging to identify bottlenecks:
   ```bash
   eufy-security-cli stream -w HOST -c SERIAL -v
   ```

**Problem:** Stream lag or buffering

**Solutions:**

1. Use optimized ffplay settings:

   ```bash
   ffplay -fflags nobuffer -flags low_delay -framedrop tcp://localhost:<port>
   ```

2. Check network connectivity between CLI and server
3. Ensure sufficient bandwidth for video streaming

### Debug Mode

Enable verbose logging for detailed troubleshooting:

```bash
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -v
```

This will show:

- WebSocket connection details
- Device discovery process
- TCP server startup
- Video codec detection
- Stream data flow
- Error details and stack traces

## Examples

### Basic Device Discovery

```bash
# List all devices
eufy-security-cli list-devices --ws-host 192.168.1.100:3000

# Get detailed info about a specific device
eufy-security-cli device-info --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789
```

### Simple Streaming

```bash
# Start streaming (system assigns port)
eufy-security-cli stream --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789

# Connect with ffplay (use the port shown in CLI output)
ffplay tcp://localhost:45123
```

### Advanced Streaming

```bash
# Stream with specific port and MP4 format
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -p 8080 -f mp4

# Connect with optimized ffplay settings
ffplay -f mp4 -probesize 32 -analyzeduration 1000000 tcp://localhost:8080
```

### Recording to File

```bash
# Start streaming
eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -p 8080 &

# Record for 5 minutes
timeout 300 ffmpeg -i tcp://localhost:8080 -c copy recording.h264

# Stop streaming
pkill -f eufy-security
```

### Multiple Camera Setup

```bash
# Create a script to start multiple streams
cat > start_cameras.sh << 'EOF'
#!/bin/bash
eufy-security-cli stream -w 192.168.1.100:3000 -c FRONT_DOOR_SERIAL -p 8081 &
eufy-security-cli stream -w 192.168.1.100:3000 -c BACKYARD_SERIAL -p 8082 &
eufy-security-cli stream -w 192.168.1.100:3000 -c GARAGE_SERIAL -p 8083 &
wait
EOF

chmod +x start_cameras.sh
./start_cameras.sh
```

## Integration with Other Tools

### Home Assistant

Use the CLI in Home Assistant automations:

```yaml
# configuration.yaml
shell_command:
  start_front_door_stream: "eufy-security-cli stream -w 192.168.1.100:3000 -c T8210N20123456789 -p 8080 &"
  stop_front_door_stream: "pkill -f 'eufy-security.*T8210N20123456789'"

camera:
  - platform: ffmpeg
    name: "Front Door Camera"
    input: "tcp://localhost:8080"
```

### Docker

Run the CLI in a Docker container:

```dockerfile
FROM node:18-alpine
RUN npm install -g @scrypted/eufy-security-cli
EXPOSE 8080
CMD ["eufy-security", "stream", "--ws-host", "host.docker.internal:3000", "--camera-serial", "T8210N20123456789", "--port", "8080"]
```

### Systemd Service

Create a systemd service for automatic startup:

```ini
# /etc/systemd/system/eufy-security.service
[Unit]
Description=Eufy Camera Stream
After=network.target

[Service]
Type=simple
User=eufy
ExecStart=/usr/bin/eufy-security-cli stream --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789 --port 8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable eufy-security.service
sudo systemctl start eufy-security.service
```

## API Reference

The CLI is built on top of the `@scrypted/eufy-security-client` library. For programmatic access, you can use the client library directly:

```typescript
import { EufySecurityClient } from "@scrypted/eufy-security-client";

const client = new EufySecurityClient({
  wsUrl: "ws://192.168.1.100:3000",
});

await client.connect();
const devices = await client.getDevices();
await client.startStream("T8210N20123456789");
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

- `@scrypted/eufy-security-client` - WebSocket client library (used internally)
- `@scrypted/eufy-security-scrypted` - Scrypted plugin integration
- `@scrypted/eufy-stream-server` - TCP streaming server (used internally)
- `@scrypted/eufy-stream-testing-validation` - Testing and validation utilities
