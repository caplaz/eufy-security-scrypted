# @caplaz/eufy-security-cli

> **Command-line interface for Eufy Security cameras**

Stream live video from your Eufy cameras directly to media players. Control devices, check status, and manage your Eufy security system from the terminal.

## 🎯 Quick Start

### Prerequisites

1. **Node.js ≥18.0.0** - Modern Node.js runtime
2. **eufy-security-ws Server** - Running instance ([setup guide](https://github.com/bropat/eufy-security-ws))
3. **Media Player** - ffplay, VLC, or MPV for viewing streams

### Installation

```bash
npm install -g @caplaz/eufy-security-cli
```

### Quick Example

```bash
# Check server status
eufy-security-cli driver status --ws-host 192.168.1.100:3000

# List your cameras
eufy-security-cli device list --ws-host 192.168.1.100:3000

# Start streaming
eufy-security-cli device stream --ws-host 192.168.1.100:3000 --camera-serial T8210N20123456789

# In another terminal, connect with ffplay
ffplay tcp://localhost:45123
```

---

## 💡 Why This CLI

Modern Node.js versions don't support the deprecated encryption used by Eufy cameras. This CLI connects to an external `eufy-security-ws` server that handles the legacy protocol, giving you a simple command-line interface for your cameras.

### Benefits

- ✅ **Easy to Use** - Simple commands for common tasks
- ✅ **Direct Streaming** - Stream to any media player via TCP
- ✅ **Cross-Platform** - Works on Linux, macOS, and Windows
- ✅ **Scriptable** - Perfect for automation and scripts
- ✅ **No GUI Required** - Great for headless servers

---

## 📋 Commands

### `driver` Commands

Manage the connection to eufy-security-ws server.

#### `driver status`

Check server connection and authentication status.

```bash
eufy-security-cli driver status --ws-host <host>
```

**Options:**
- `--ws-host, -w <host>` - WebSocket server (e.g., `localhost:3000` or `192.168.1.100:3000`)
- `--verbose, -v` - Enable detailed logging
- `--help, -h` - Show help

**Example:**
```bash
eufy-security-cli driver status --ws-host 192.168.1.100:3000
```

**Output:**
```
✅ Connected to eufy-security-ws
📡 Server: ws://192.168.1.100:3000
🔐 Authenticated: Yes
📊 API Version: 1.7.1
```

#### `driver connect`

Test connection and verify authentication.

```bash
eufy-security-cli driver connect --ws-host <host>
```

**Options:**
- `--ws-host, -w <host>` - WebSocket server
- `--verbose, -v` - Enable detailed logging
- `--help, -h` - Show help

**Example:**
```bash
eufy-security-cli driver connect --ws-host 192.168.1.100:3000
```

---

### `device` Commands

Interact with your Eufy devices.

#### `device list`

List all devices in your Eufy account.

```bash
eufy-security-cli device list --ws-host <host>
```

**Options:**
- `--ws-host, -w <host>` - WebSocket server (required)
- `--verbose, -v` - Enable detailed logging
- `--help, -h` - Show help

**Example:**
```bash
eufy-security-cli device list --ws-host 192.168.1.100:3000
```

**Output:**
```
📹 Found 3 cameras:

┌──────────────────┬──────────────────┬───────────────┬────────┐
│ Name             │ Serial           │ Model         │ Online │
├──────────────────┼──────────────────┼───────────────┼────────┤
│ Front Door       │ T8210N2012345678 │ T8210         │ ✅ Yes │
│ Backyard         │ T8210N2087654321 │ T8210         │ ✅ Yes │
│ Garage           │ T8410P2011111111 │ T8410P20      │ ❌ No  │
└──────────────────┴──────────────────┴───────────────┴────────┘
```

#### `device stream`

Start streaming from a camera.

```bash
eufy-security-cli device stream --ws-host <host> --camera-serial <serial>
```

**Options:**
- `--ws-host, -w <host>` - WebSocket server (required)
- `--camera-serial, -c <serial>` - Camera serial number (required)
- `--tcp-port, -p <port>` - TCP server port (default: random)
- `--verbose, -v` - Enable detailed logging
- `--help, -h` - Show help

**Example:**
```bash
eufy-security-cli device stream \
  --ws-host 192.168.1.100:3000 \
  --camera-serial T8210N2012345678 \
  --tcp-port 8080
```

**Output:**
```
🎥 Starting stream from: Front Door (T8210N2012345678)
📡 TCP Server: localhost:8080

✅ Stream started!
   Connect with: ffplay tcp://localhost:8080
              or: vlc tcp://localhost:8080
              or: mpv tcp://localhost:8080

📊 Stats:
   Frames: 1234
   Data: 15.3 MB
   Clients: 1

Press Ctrl+C to stop...
```

---

## 🎬 Streaming Workflows

### Basic Streaming

```bash
# Terminal 1: Start the stream
eufy-security-cli device stream \
  --ws-host 192.168.1.100:3000 \
  --camera-serial T8210N2012345678

# Terminal 2: View with ffplay
ffplay tcp://localhost:45123
```

### Record to File

```bash
# Terminal 1: Start the stream
eufy-security-cli device stream \
  --ws-host 192.168.1.100:3000 \
  --camera-serial T8210N2012345678 \
  --tcp-port 8080

# Terminal 2: Record with ffmpeg
ffmpeg -i tcp://localhost:8080 \
  -c copy \
  -t 60 \
  recording.mp4
```

### View with VLC

```bash
# Terminal 1: Start the stream
eufy-security-cli device stream \
  --ws-host 192.168.1.100:3000 \
  --camera-serial T8210N2012345678 \
  --tcp-port 8080

# Terminal 2: Open in VLC
vlc tcp://localhost:8080
```

### View with MPV

```bash
# Terminal 1: Start the stream
eufy-security-cli device stream \
  --ws-host 192.168.1.100:3000 \
  --camera-serial T8210N2012345678 \
  --tcp-port 8080

# Terminal 2: Open in MPV
mpv tcp://localhost:8080 --profile=low-latency
```

---

## 🔍 Troubleshooting

### Connection Issues

**Problem**: Cannot connect to eufy-security-ws

**Solutions**:

1. ✅ Verify server is running: `docker ps` or `systemctl status eufy-security-ws`
2. ✅ Check hostname/IP is correct
3. ✅ Test with curl: `curl http://192.168.1.100:3000/health`
4. ✅ Check firewall rules
5. ✅ Try with `--verbose` flag for detailed logs

### No Devices Found

**Problem**: `device list` shows no devices

**Solutions**:

1. ✅ Verify eufy-security-ws has valid credentials
2. ✅ Check server logs: `docker logs eufy-security-ws`
3. ✅ Ensure devices are online in Eufy app
4. ✅ Wait 30 seconds after server start for initialization
5. ✅ Try reconnecting: `driver connect`

### Stream Not Starting

**Problem**: Stream command fails or hangs

**Solutions**:

1. ✅ Verify camera serial number is correct (use `device list`)
2. ✅ Check camera is online
3. ✅ Ensure camera supports streaming (not all sensors do)
4. ✅ Check eufy-security-ws logs for errors
5. ✅ Try a different TCP port with `--tcp-port`

### Media Player Issues

**Problem**: ffplay/VLC won't connect

**Solutions**:

1. ✅ Wait for "Stream started!" message before connecting
2. ✅ Use the exact URL shown in CLI output
3. ✅ Try different player: ffplay, VLC, or MPV
4. ✅ Check TCP port isn't blocked by firewall
5. ✅ Use explicit port with `--tcp-port 8080`

---

## 🎛️ Advanced Usage

### Custom Configuration

Create a config file to avoid repeating options:

```bash
# ~/.eufy-cli-config
export EUFY_WS_HOST="192.168.1.100:3000"
export EUFY_TCP_PORT="8080"
```

```bash
# Load config
source ~/.eufy-cli-config

# Use without flags
eufy-security-cli device list --ws-host $EUFY_WS_HOST
```

### Scripting

```bash
#!/bin/bash
# monitor-front-door.sh

WS_HOST="192.168.1.100:3000"
CAMERA="T8210N2012345678"
OUTPUT_DIR="/recordings"

# Start streaming in background
eufy-security-cli device stream \
  --ws-host "$WS_HOST" \
  --camera-serial "$CAMERA" \
  --tcp-port 8080 &

STREAM_PID=$!

# Wait for stream to start
sleep 5

# Record for 1 hour
ffmpeg -i tcp://localhost:8080 \
  -c copy \
  -t 3600 \
  "$OUTPUT_DIR/front-door-$(date +%Y%m%d-%H%M%S).mp4"

# Stop stream
kill $STREAM_PID
```

### Multiple Cameras

```bash
#!/bin/bash
# stream-all-cameras.sh

# Get all camera serials
CAMERAS=$(eufy-security-cli device list --ws-host 192.168.1.100:3000 | grep T8210 | awk '{print $2}')

PORT=8080
for SERIAL in $CAMERAS; do
  echo "Starting stream for $SERIAL on port $PORT"
  
  eufy-security-cli device stream \
    --ws-host 192.168.1.100:3000 \
    --camera-serial "$SERIAL" \
    --tcp-port $PORT &
  
  ((PORT++))
  sleep 2
done

wait
```

---

## 📊 Command Reference

### Global Options

Available for all commands:

| Option             | Short | Description                  |
| ------------------ | ----- | ---------------------------- |
| `--verbose`        | `-v`  | Enable verbose logging       |
| `--help`           | `-h`  | Show command help            |

### Driver Commands

| Command          | Description                     |
| ---------------- | ------------------------------- |
| `driver status`  | Check server status             |
| `driver connect` | Test connection                 |

### Device Commands

| Command         | Description                      |
| --------------- | -------------------------------- |
| `device list`   | List all devices                 |
| `device stream` | Start streaming from camera      |

---

## 🤝 Related Packages

- **[@caplaz/eufy-security-client](../eufy-security-client)** - TypeScript client library
- **[@caplaz/eufy-stream-server](../eufy-stream-server)** - TCP streaming server
- **[@caplaz/eufy-security-scrypted](../eufy-security-scrypted)** - Scrypted plugin

---

## 📄 License

MIT License - See [LICENSE](../../LICENSE) file for details

---

## 🙏 Credits

Built on top of:

- [eufy-security-ws](https://github.com/bropat/eufy-security-ws) by @bropat
- [@caplaz/eufy-security-client](../eufy-security-client) - WebSocket client library

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
