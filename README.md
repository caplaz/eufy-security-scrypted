# Eufy Security Plugin for Scrypted

> **Complete Eufy Security integration for Scrypted with streaming support**

A modern monorepo providing comprehensive Eufy Security camera integration through multiple complementary packages. Stream live video, control devices, and manage your security system with Scrypted's powerful automation platform.

## 🤔 Why This Plugin?

### The Challenge

Eufy Security cameras use proprietary protocols and legacy encryption that modern applications can't directly access. While Eufy provides a mobile app and basic web interface, integrating with home automation platforms like Scrypted requires bridging this compatibility gap.

### The Solution

This plugin provides a complete bridge between Eufy Security systems and Scrypted, enabling:

- **Full Device Control** - Manage cameras, doorbells, and sensors through Scrypted's interface
- **Live Streaming** - Real-time video feeds with optimized performance
- **Automation Integration** - Trigger Scrypted automations on motion, doorbell presses, and security events
- **Modern Architecture** - Built with TypeScript, WebSocket communication, and modular design

### How It Works

```
Your Home Network          Eufy Cloud          Scrypted Server
     │                          │                     │
     │     1. Discovery         │                     │
     ├─────────────────────────►│                     │
     │                          │◄────────────────────┤
     │                          │     2. Authentication│
     │                          │                     │
     │◄─────────────────────────┼─────────────────────┼─ Device Control
     │    3. Video Stream       │                     │
     │                          │                     │
     │◄─────────────────────────┼─────────────────────┼─ Motion Events
     │    4. Real-time Events   │                     │
```

1. **Device Discovery** - Plugin automatically finds all your Eufy devices
2. **Secure Authentication** - Handles Eufy account authentication and session management
3. **Video Streaming** - Optimized H.264 streaming with connection management
4. **Event Integration** - Real-time motion detection, doorbell alerts, and sensor events

### Key Benefits

- ✅ **No Vendor Lock-in** - Works with any Scrypted installation
- ✅ **High Performance** - Optimized streaming with minimal latency
- ✅ **Type Safe** - Full TypeScript coverage prevents runtime errors
- ✅ **Well Tested** - 206+ tests ensure reliability
- ✅ **Open Source** - Transparent, auditable, and community-driven

### Documentation Links

- 📖 **[Scrypted Documentation](https://docs.scrypted.app/)** - Learn about Scrypted's automation platform
- 🔧 **[Eufy Security WS](https://github.com/bropat/eufy-security-ws)** - The foundation this plugin builds upon
- 🏠 **[Home Assistant Integration](https://www.home-assistant.io/integrations/scrypted/)** - Use with Home Assistant
- 📚 **[API Reference](packages/eufy-security-client/)** - Technical API documentation

---

## 🎯 Quick Start

### Prerequisites

- **Node.js ≥18.0.0** - Modern JavaScript runtime
- **Scrypted Server** - Home automation platform ([get started](https://docs.scrypted.app/))
- **Eufy Account** - Active Eufy Security subscription

### Installation

```bash
# Clone the monorepo
git clone https://github.com/caplaz/eufy-security-scrypted.git
cd eufy-security-scrypted

# Install all dependencies
npm install

# Build all packages
npm run build
```

### Deploy to Scrypted

```bash
# Open the Scrypted package in VS Code
code packages/eufy-security-scrypted

# Configure your Scrypted server IP in .vscode/settings.json
# Press the Launch button (green arrow) in Run and Debug
```

---

## 📦 Packages Overview

This monorepo contains four specialized packages that work together to provide complete Eufy Security integration:

### [@scrypted/eufy-security-scrypted](packages/eufy-security-scrypted/)

> **Scrypted Plugin** - The main integration point

Core Scrypted plugin that discovers and controls your Eufy devices. Handles authentication, device management, and integrates with Scrypted's automation ecosystem.

**Key Features:**

- 🔍 Automatic device discovery
- 🎥 Live video streaming
- 🔔 Motion and doorbell events
- ⚙️ Device control and configuration
- 🤖 Scrypted automation integration

### [@scrypted/eufy-security-client](packages/eufy-security-client/)

> **WebSocket Client Library** - Communication foundation

Type-safe TypeScript library for communicating with Eufy Security systems via WebSocket. Provides the low-level API interactions that other packages build upon.

**Key Features:**

- 🔌 WebSocket-based communication
- 📝 Type-safe API calls
- 🎯 Event-driven architecture
- 🧪 Comprehensive test coverage (184 tests)
- 🔄 Schema negotiation and compatibility

### [@scrypted/eufy-security-cli](packages/eufy-security-cli/)

> **Command-Line Interface** - Development and testing tool

Terminal-based tool for interacting with your Eufy devices. Perfect for testing, debugging, and automation scripts.

**Key Features:**

- 📺 Direct video streaming to media players
- 📋 Device status and control
- 🔧 Configuration management
- 📊 Streaming statistics
- 🤖 Scriptable automation

### [@scrypted/eufy-stream-server](packages/eufy-stream-server/)

> **TCP Streaming Server** - High-performance video delivery

Simplified TCP server optimized for raw H.264 video streaming. Handles the complexities of Eufy's video protocols while providing a clean streaming interface.

**Key Features:**

- 🎬 Raw H.264 video streaming
- 🌐 TCP server with concurrent connections
- 📦 NAL unit parsing and keyframe detection
- 📈 Connection statistics and monitoring
- ⚡ Event-driven TypeScript implementation

---

## 🔄 How It All Works Together

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Scrypted UI   │◄──►│  Scrypted Plugin │◄──►│  Eufy Devices   │
│                 │    │ (eufy-security-  │    │                 │
│ User Interface  │    │    scrypted)     │    │ Cameras,        │
└─────────────────┘    └──────────────────┘    │ Doorbells, etc. │
                              │                └─────────────────┘
                              ▼
                       ┌──────────────────┐
                       │ WebSocket Client │
                       │ (eufy-security-  │
                       │     client)      │
                       └──────────────────┘
                              │
                              ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Stream Server  │◄──►│  Media Players  │
                       │ (eufy-stream-    │    │                 │
                       │    server)       │    │ VLC, ffplay,    │
                       └──────────────────┘    │ etc.            │
                              ▲                └─────────────────┘
                              │
                       ┌──────────────────┐
                       │   CLI Tool       │
                       │ (eufy-security-  │
                       │     cli)         │
                       └──────────────────┘
```

### Data Flow

1. **Scrypted Plugin** discovers devices and handles user interactions
2. **WebSocket Client** manages all communication with Eufy servers
3. **Stream Server** provides optimized video delivery to media players
4. **CLI Tool** offers direct terminal access for testing and automation

### Package Dependencies

- `eufy-security-scrypted` → depends on `eufy-security-client`
- `eufy-security-cli` → depends on `eufy-security-client` and `eufy-stream-server`
- `eufy-stream-server` → standalone streaming component
- `eufy-security-client` → foundation library with no dependencies

---

## 🚀 Installation & Setup

### For Users (Scrypted Plugin)

```bash
# Install via Scrypted's plugin system
# Search for "Eufy Security" in Scrypted plugins
```

### For Developers

```bash
# Clone and setup
git clone https://github.com/caplaz/eufy-security-scrypted.git
cd eufy-security-scrypted
npm install
npm run build

# Run tests
npm run test
```

### Docker Development

```bash
# Use the included Docker environment
cd docker
cp .env.example .env
# Edit .env with your credentials
docker-compose up -d
```

---

## 🛠️ Development

### Building

```bash
# Build all packages
npm run build

# Build individual packages
cd packages/eufy-security-client && npm run build
cd packages/eufy-security-scrypted && npm run build
cd packages/eufy-stream-server && npm run build
cd packages/eufy-security-cli && npm run build
```

### Testing

```bash
# Run complete test suite (206 tests)
npm run test

# Test individual packages
cd packages/eufy-security-client && npm run test
cd packages/eufy-stream-server && npm run test
cd packages/eufy-security-cli && npm run test
```

### Code Quality

```bash
# Lint and format
npm run lint
npm run format

# Type checking
npm run type-check
```

### Publishing

```bash
# All packages share versioning
git tag v0.1.1
git push origin v0.1.1
# GitHub Actions automatically publishes to npm
```

---

## 🤝 Contributing

We welcome contributions! This monorepo uses modern development practices:

- **Lerna** for monorepo management
- **TypeScript** for type safety
- **Jest** for comprehensive testing
- **ESLint + Prettier** for code quality
- **GitHub Actions** for CI/CD

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Testing Your Changes

```bash
# Run full test suite
npm run test

# Run tests in watch mode during development
npm run test:watch
```

---

## 📋 Available Scripts

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `npm run build`      | Build all packages           |
| `npm run test`       | Run all tests                |
| `npm run clean`      | Clean build artifacts        |
| `npm run lint`       | Lint all code                |
| `npm run format`     | Format code with Prettier    |
| `npm run type-check` | Run TypeScript type checking |

---

## 🏗️ Architecture Deep Dive

### Monorepo Structure

```
eufy-security-scrypted/
├── packages/
│   ├── eufy-security-client/     # 🔌 WebSocket communication
│   ├── eufy-security-cli/        # 💻 Command-line interface
│   ├── eufy-security-scrypted/   # 🤖 Scrypted plugin
│   └── eufy-stream-server/       # 🎬 Video streaming server
├── docker/                       # 🐳 Development environment
├── .github/workflows/            # ⚙️ CI/CD pipelines
├── lerna.json                    # 📦 Monorepo configuration
└── tsconfig.json                 # 🔧 Shared TypeScript config
```

### Design Principles

- **Modular Architecture** - Each package has a single responsibility
- **Type Safety** - Full TypeScript coverage for reliability
- **Test-Driven** - Comprehensive test suites ensure quality
- **Developer Experience** - Modern tooling and clear documentation
- **Performance** - Optimized for real-time video streaming

---

## 📄 License

**MIT License** - See [LICENSE](LICENSE) for details

---

## 🙏 Acknowledgments

- Built on the excellent [eufy-security-ws](https://github.com/bropat/eufy-security-ws) foundation
- Powered by [Scrypted](https://www.scrypted.app/) for home automation
- Community contributions and feedback
