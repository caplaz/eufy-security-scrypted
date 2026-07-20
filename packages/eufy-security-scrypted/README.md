# Eufy Security Scrypted Plugin

<p align="center">
  <img src="https://raw.githubusercontent.com/caplaz/eufy-security-scrypted/main/packages/eufy-security-scrypted/public/banner.png" alt="Eufy Security Scrypted Plugin" width="600"/>
</p>

<p align="center">
  <strong>Complete Eufy Security integration for Scrypted</strong>
</p>

<p align="center">
  <a href="https://github.com/caplaz/eufy-security-scrypted/actions/workflows/release.yml">
    <img src="https://github.com/caplaz/eufy-security-scrypted/actions/workflows/release.yml/badge.svg" alt="Release Status"/>
  </a>
  <a href="https://www.npmjs.com/package/@caplaz/eufy-security-scrypted">
    <img src="https://img.shields.io/npm/v/@caplaz/eufy-security-scrypted.svg" alt="npm version"/>
  </a>
  <a href="https://github.com/caplaz/eufy-security-scrypted/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/caplaz/eufy-security-scrypted.svg" alt="License"/>
  </a>
</p>

> **⚠️ EARLY DEVELOPMENT WARNING**
>
> **This plugin is in early development and should be considered experimental.**
>
> - Many Eufy device models have not been tested
> - Bugs and compatibility issues are expected
> - Features may change without notice
> - Use at your own risk in production environments
> - Please report issues to help improve stability

## Overview

The Eufy Security Scrypted Plugin provides comprehensive integration between Eufy Security devices and the Scrypted home automation platform. This plugin enables seamless control and monitoring of Eufy cameras, doorbells, and security systems through Scrypted's unified interface.

### Key Features

- **Complete Device Support**: Cameras, doorbells, sensors, and hubs
- **Real-time Streaming**: H.264 video streaming with audio support
- **Motion Detection**: Live motion alerts and event notifications
- **Device Control**: Pan/tilt, lighting, and security system control
- **HomeKit Secure Video**: Compatible with HomeKit Secure Video
- **User-friendly Setup**: CAPTCHA and 2FA authentication handling

## Installation

### Prerequisites

1. **Scrypted Server**: Ensure Scrypted is installed and running on your system
2. **Eufy Security WebSocket Server**: Set up the companion WebSocket server (see Configuration section below)

### Plugin Installation

1. Open the Scrypted web interface
2. Navigate to **Plugins** in the sidebar
3. Click **Install** or search for plugins
4. Search for **Eufy Security** or **@caplaz/eufy-security-scrypted**
5. Click **Install** and follow the setup prompts
6. Configure the plugin settings (see Configuration section)

## Configuration

### WebSocket Server Setup

The plugin requires a companion WebSocket server (`eufy-security-ws`) to communicate with Eufy cloud services. This server handles the low-level Eufy API interactions.

#### Option 1: Docker (Recommended)

1. Create a `docker-compose.yml` file with the following content:

```yaml
services:
  eufy-security-ws:
    image: bropat/eufy-security-ws:latest
    container_name: eufy-security-ws
    ports:
      - "3000:3000"
    environment:
      - USERNAME=your_eufy_email@example.com
      - PASSWORD=your_eufy_password
      - COUNTRY=US # Change to your country code if needed
    restart: unless-stopped
```

2. Start the container:

```bash
docker-compose up -d
```

#### Option 2: NPM Installation

If you prefer not to use Docker:

```bash
# Install globally
npm install -g eufy-security-ws

# Create a config.json file in your working directory
{
  "username": "your_eufy_email@example.com",
  "password": "your_eufy_password",
  "country": "US"
}

# Run the server (it will automatically find config.json in the current directory)
eufy-security-ws
```

### Plugin Configuration

After installation, configure the plugin with:

- **WebSocket URL**: URL of your eufy-security-ws server (default: `ws://localhost:3000`)
- **Debug Logging**: Enable verbose logging for troubleshooting
- **H.265 Compatibility Mode**: Choose `Auto` (the default), `Force`, or
  `Native` for the optional H.265-to-H.264 compatibility stream. See
  [Native and compatibility streams](#native-and-compatibility-streams).

## Device Support

### Cameras

- Live video streaming (H.264)
- Audio recording and playback
- Motion detection alerts
- Pan/tilt control (where supported)
- Night vision settings

### Door Bells

- Video calling with audio
- Motion-triggered recording
- Doorbell press notifications

### Sensors

- Motion sensors
- Contact sensors
- Temperature sensors

### Hubs/Stations

- Security system arming/disarming
- Device management
- Push notification handling

## Authentication

The plugin handles Eufy cloud authentication including:

- **CAPTCHA Challenges**: Automatic handling with user-friendly UI
- **2FA/MFA**: Support for email and SMS verification codes
- **Session Management**: Automatic token refresh and reconnection

## Troubleshooting

### Common Issues

**Connection Problems**

- Verify eufy-security-ws server is running
- Check WebSocket URL configuration
- Ensure network connectivity to Eufy cloud

**Authentication Issues**

- Verify Eufy account credentials
- Check for CAPTCHA or 2FA requirements
- Review server logs for authentication errors

**Performance Issues**

- Adjust memory threshold settings
- Enable debug logging for diagnostics
- Check system resources

### Debug Logging

Enable debug logging in plugin settings to get detailed information for troubleshooting.

## Contributing

Contributions are welcome! Please see the main repository for contribution guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/caplaz/eufy-security-scrypted/issues)
- **Discussions**: [GitHub Discussions](https://github.com/caplaz/eufy-security-scrypted/discussions)
- **Scrypted Community**: [Scrypted Forums](https://forums.scrypted.app)

1. Start the `eufy-security-ws` container with your Eufy credentials
2. In Scrypted, go to the Eufy Security plugin settings
3. Configure the WebSocket URL (default: `ws://localhost:3000`)
4. Click **Connect Account**
5. Complete authentication (CAPTCHA/2FA if required)
6. Your devices will automatically appear!

---

## 📹 Supported Devices

### Cameras

- **Indoor Cameras** - 2K, Pan & Tilt models
- **Outdoor Cameras** - Solo, SoloCam series (battery & wired)
- **Floodlight Cameras** - With integrated lighting control
- **PTZ Cameras** - Pan, tilt, zoom capable models
- **Doorbell Cameras** - Video Doorbell series

### Base Stations

- **HomeBase 1/2/3** - Full security system integration
- **Smart Lock integration** (via HomeBase)

### Other Devices

- Motion sensors, entry sensors (via HomeBase)
- Keypads and security panels

---

## ✨ Supported Features

### 🎥 Video Streaming

| Feature              | Status           | Notes                      |
| -------------------- | ---------------- | -------------------------- |
| **Live Video**       | ✅ Full Support  | 1080p/2K H.264 streaming   |
| **Audio**            | ✅ Two-way Audio | AAC codec support          |
| **Low Latency**      | ✅ Optimized     | TCP-based streaming        |
| **Multiple Streams** | ✅ Concurrent    | Multiple viewers supported |
| **Video Clips**      | ✅ Cloud & Local | Access recorded events     |

### 📸 Camera Controls

| Feature              | Status               | Compatible Devices      |
| -------------------- | -------------------- | ----------------------- |
| **Snapshots**        | ✅ Full Support      | All cameras             |
| **Pan/Tilt**         | ✅ Full Support      | PTZ models only         |
| **Motion Detection** | ✅ Real-time         | All cameras             |
| **Night Vision**     | ✅ Auto/Manual       | All cameras with IR     |
| **Floodlight**       | ✅ On/Off/Brightness | Floodlight cameras only |

### 🔋 Power & Battery

| Feature                | Status          | Notes                    |
| ---------------------- | --------------- | ------------------------ |
| **Battery Level**      | ✅ Real-time    | Battery-powered devices  |
| **Charging Status**    | ✅ Live Updates | Shows when charging      |
| **Low Battery Alerts** | ✅ Automatic    | Via Scrypted automations |

### 🏠 Security System

| Feature            | Status              | Notes                   |
| ------------------ | ------------------- | ----------------------- |
| **Arm/Disarm**     | ✅ Full Support     | Via HomeBase stations   |
| **Guard Modes**    | ✅ Home/Away/Disarm | Full control            |
| **Alarm Status**   | ✅ Real-time        | Triggered alerts        |
| **Alarm Triggers** | ⚠️ Read-only        | Cannot trigger manually |

### 📡 Connectivity

| Feature                | Status         | Notes                       |
| ---------------------- | -------------- | --------------------------- |
| **Wi-Fi Signal**       | ✅ RSSI Sensor | Network strength monitoring |
| **Online Status**      | ✅ Real-time   | Device availability         |
| **Connection Quality** | ✅ Automatic   | Health monitoring           |

---

## 🔐 Authentication

### Initial Setup

The plugin handles Eufy's complex authentication automatically:

1. Click **Connect Account** in plugin settings
2. If prompted, solve the **CAPTCHA challenge** (image displayed in settings)
3. If 2FA is enabled, enter your **verification code**
4. Connection established! ✅

### CAPTCHA Challenge

When Eufy requires CAPTCHA verification:

```
Settings → Eufy Cloud Account
┌─────────────────────────────────┐
│  🔐 CAPTCHA Challenge           │
│  [Image showing CAPTCHA code]   │
│                                 │
│  CAPTCHA Code: [ _____ ]        │
│  [Submit CAPTCHA Code]          │
└─────────────────────────────────┘
```

### Two-Factor Authentication (2FA)

When 2FA is enabled on your account:

```
Settings → Eufy Cloud Account
┌─────────────────────────────────┐
│  🔐 2FA Verification Code       │
│                                 │
│  Check your email/SMS for code  │
│  Verification Code: [ _____ ]   │
│  [Submit Code] [Request New]    │
└─────────────────────────────────┘
```

### Reconnection

Lost connection? Just click:

- **Disconnect Account** (clears session)
- **Connect Account** (re-authenticate)

---

## ⚙️ Settings & Configuration

### WebSocket Server

```
WebSocket URL: ws://localhost:3000
```

Point to your `eufy-security-ws` container. Common configurations:

- **Local**: `ws://localhost:3000`
- **Docker**: `ws://eufy-security-ws:3000`
- **Remote**: `ws://192.168.1.100:3000`

### Memory Management

```
Current Memory Usage: 85MB ✅
Memory Threshold: 120MB
```

- **Automatic cleanup** when threshold exceeded
- **Optimized buffers** for video streaming
- **Prevents crashes** from memory exhaustion

### Debug Logging

```
Debug Logging: [Toggle]
```

Enable for troubleshooting:

- Detailed connection logs
- API call tracing
- Stream session debugging
- Event monitoring

---

## 🎬 Streaming Architecture

### How It Works

```
Eufy Camera → eufy-security-ws → WebSocket → Scrypted Plugin → TCP Server → FFmpeg
                                                                              ↓
                                                                    Scrypted Consumers
                                                                    (Home Assistant,
                                                                     HomeKit, etc.)
```

### Performance Features

✅ **Lazy Session Creation** - Streams only start when needed  
✅ **Session Reuse** - Multiple viewers share one stream  
✅ **Smart Buffering** - Memory-conscious video buffering  
✅ **Keyframe Detection** - Fast stream initialization  
✅ **Auto Cleanup** - Resources freed when not streaming

### Native and Compatibility Streams

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

#### Capacity, prebuffer, and thermal admission

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

### Stream Quality

- **Resolution**: Up to 2K (device dependent)
- **Codec**: Native H.264 or H.265; the optional `p2p-h264` compatibility
  stream is H.264
- **Audio**: AAC stereo
- **Latency**: ~1-3 seconds (typical)
- **Bandwidth**: 2-5 Mbps (variable)

### Verification and CI

The automated tests cover stream selection (`Auto`, `Force`, `Native`, explicit
stream IDs, recorder routing, and unverified codecs), thermal hysteresis and
concurrent admission checks, and the FFmpeg input configuration handed to
Scrypted. A real-FFmpeg HEVC-to-H.264 integration test also verifies that an
H.265 input can be decoded and emitted as decodable H.264. It self-skips on a
developer machine when FFmpeg or the required encoders are unavailable.

The dedicated FFmpeg CI job requires FFmpeg with the x264 and x265 encoders, so
the integration test is exercised in CI instead of being hidden by the local
skip. It validates the conversion pipeline, not a physical camera; still test
`p2p-h264` with a live verified H.265 camera before relying on it in production.

GitHub Actions installs dependencies and the Scrypted SDK, then runs the root
build and test suites on Node.js 18, 20, and 22. Its quality job additionally
type-checks, lints, and formats the client package. Run `npm run build`,
`npm run test`, `npm run lint`, and `npm run format:check` locally before
submitting changes.

---

## 🔧 Device-Specific Features

### Indoor Cameras

- ✅ Live streaming
- ✅ Motion detection
- ✅ Two-way audio
- ✅ Privacy mode
- ✅ Pet detection (model dependent)

### Outdoor Cameras (Battery)

- ✅ Live streaming
- ✅ Motion detection
- ✅ Battery monitoring
- ✅ Solar panel charging status
- ✅ Weather resistance info

### Floodlight Cameras

- ✅ Live streaming
- ✅ Motion detection
- ✅ **Floodlight control** (On/Off)
- ✅ **Brightness adjustment**
- ✅ Motion-activated lighting

### PTZ Cameras

- ✅ Live streaming
- ✅ **Pan control** (left/right)
- ✅ **Tilt control** (up/down)
- ✅ **Zoom control** (in/out)
- ✅ Motion detection
- ✅ Auto-tracking (if supported)

### Video Doorbells

- ✅ Live streaming
- ✅ Motion detection
- ✅ **Doorbell press events**
- ✅ Two-way audio
- ✅ Visitor detection

### Base Stations (HomeBase)

- ✅ **Security system control**
  - Home mode
  - Away mode
  - Disarm mode
- ✅ Alarm status monitoring
- ✅ Child device management
- ✅ System reboot

---

## 🔍 Troubleshooting

### Connection Issues

**Problem**: Plugin shows "Not connected"

**Solutions**:

1. ✅ Verify `eufy-security-ws` container is running
2. ✅ Check WebSocket URL in settings
3. ✅ Test connection: `docker logs eufy-security-ws`
4. ✅ Check firewall/network settings
5. ✅ Try reconnecting in plugin settings

### Authentication Problems

**Problem**: CAPTCHA or 2FA required but not appearing

**Solutions**:

1. ✅ Refresh the plugin settings page
2. ✅ Check plugin logs for authentication events
3. ✅ Disconnect and reconnect account
4. ✅ Verify Eufy credentials in `eufy-security-ws` config

### Streaming Issues

**Problem**: Video not loading or buffering

**Solutions**:

1. ✅ Check memory usage (increase threshold if needed)
2. ✅ Enable debug logging to see stream events
3. ✅ Verify camera is online in Eufy app
4. ✅ Restart the plugin
5. ✅ Check network bandwidth

### Device Not Showing

**Problem**: Camera/device not appearing in Scrypted

**Solutions**:

1. ✅ Ensure device is online in Eufy app
2. ✅ Click "Connect Account" to refresh devices
3. ✅ Check `eufy-security-ws` logs for device list
4. ✅ Verify HomeBase is connected (for linked devices)

---

## 📊 Status Monitoring

### Connection State

```
🟢 Ready          - Fully connected and operational
🟠 Connected      - WebSocket connected, waiting for auth
🟡 Connecting     - Establishing connection
🔄 Negotiating    - API schema setup in progress
🔴 Disconnected   - Not connected
❌ Error          - Connection error
```

### Device Status

Each device shows:

- **Online Status**: Real-time availability
- **Battery Level**: For battery-powered devices
- **Signal Strength**: Wi-Fi RSSI
- **Charging Status**: For devices with charging support

---

## 🚀 Integration Examples

### Home Assistant

```yaml
# Example automation: Motion-activated recording
automation:
  - alias: "Record on motion"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_camera_motion
        to: "on"
    action:
      - service: camera.record
        target:
          entity_id: camera.front_camera
        data:
          duration: 60
```

### HomeKit

Your Eufy cameras appear as native HomeKit cameras with:

- Live video streaming
- Motion notifications
- Rich notifications with snapshots
- HomeKit Secure Video (if enabled)

### Google Home / Alexa

Stream your cameras:

- "Hey Google, show front door camera"
- "Alexa, show backyard camera on TV"

---

## 🔒 Privacy & Security

- ✅ **Local Processing** - Video streams processed locally
- ✅ **No Cloud Required** - Works without Eufy cloud (if configured)
- ✅ **Encrypted Connections** - WebSocket and video streams secured
- ✅ **No Data Collection** - Plugin doesn't collect telemetry
- ✅ **Open Source** - Full transparency

---

## 🐛 Known Limitations

- ⚠️ **Video Clips**: Cloud clips accessible, local SD card clips not yet supported
- ⚠️ **Two-way Audio**: Requires manual configuration in some setups
- ⚠️ **Alarm Triggers**: Cannot manually trigger station alarms (read-only)
- ⚠️ **Some Models**: Newer models may have limited support until tested

---

## 📚 Advanced Configuration

### Custom Memory Threshold

Adjust based on your system:

- **Low Memory Systems** (≤4GB RAM): 80-100MB
- **Normal Systems** (8GB RAM): 120-150MB (default)
- **High Memory Systems** (≥16GB RAM): 200-300MB

### Network Optimization

For best performance:

- Use **wired connection** for Scrypted server
- Ensure **good Wi-Fi** for battery cameras
- Enable **Quality of Service (QoS)** for video traffic
- Use **5GHz Wi-Fi** when possible

---

## 🤝 Support & Community

### Getting Help

1. **Documentation**: Check this README first
2. **Logs**: Enable debug logging for detailed info
3. **Issues**: Report bugs on [GitHub](https://github.com/caplaz/eufy-security-scrypted)
4. **Scrypted Discord**: Join the community

### Reporting Issues

Please include:

- Scrypted version
- Plugin version
- Device model(s)
- Error logs (with debug enabled)
- Steps to reproduce

---

## 📄 License

MIT License - See [LICENSE](../../LICENSE) file for details

---

## 🙏 Credits

Built on top of:

- [eufy-security-ws](https://github.com/bropat/eufy-security-ws) by @bropat
- [Scrypted](https://scrypted.app) by @koush

---

## 🎉 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

See [CONTRIBUTING](../../CONTRIBUTING.md) for guidelines.

---

**Made with ❤️ for the Scrypted and Eufy communities**
