# Eufy Security Scrypted

A comprehensive Scrypted plugin for Eufy Security cameras with streaming support via eufy-security-ws server.

## 📈 Recent Progress

### September 2025 Updates

- ✅ **Added eufy-stream-server package**: New simplified TCP streaming server for raw H.264 video streams
- ✅ **Comprehensive testing**: All packages now have extensive test coverage (206 total tests)
- ✅ **Clean repository**: Removed test artifacts and updated .gitignore for better development experience
- ✅ **Lerna monorepo integration**: All packages properly integrated with shared build and test workflows

## 🚀 Developmentining Scrypted plugins and libraries for Eufy Security integration.

## 📦 Packages

This monorepo contains the following packages:

### [@scrypted/eufy-security-scrypted](packages/eufy-security-scrypted/)

Scrypted plugin for Eufy Security devices. Provides integration with Eufy cameras, doorbells, and security systems.

### [@scrypted/eufy-security-client](packages/eufy-security-client/)

Type-safe WebSocket client library for communicating with Eufy Security systems. Features:

- Complete API coverage for devices, stations, and drivers
- Type-safe event handling and command execution
- Comprehensive test suite (184 tests)
- Schema negotiation and version compatibility

### [@scrypted/eufy-stream-server](packages/eufy-stream-server/)

Simplified TCP streaming server for raw H.264 video streams from Eufy cameras. Features:

- Raw H.264 video streaming without audio complexity
- TCP server supporting multiple concurrent client connections
- H.264 NAL unit parsing and key frame detection
- Connection management and streaming statistics
- Comprehensive test suite (22 tests)
- Event-driven architecture with TypeScript support

## � Recent Progress

### September 2025 Updates

- ✅ **Added eufy-stream-server package**: New simplified TCP streaming server for raw H.264 video streams
- ✅ **Comprehensive testing**: All packages now have extensive test coverage (206 total tests)
- ✅ **Clean repository**: Removed test artifacts and updated .gitignore for better development experience
- ✅ **Lerna monorepo integration**: All packages properly integrated with shared build and test workflows

## �🚀 Development

### Prerequisites

- Node.js 18+ and npm
- Scrypted server (for the plugin package)

### Setup

```bash
# Install all dependencies
npm install
```

### Building

```bash
# Build all packages
npm run build

# Build individual packages
cd packages/eufy-security-client && npm run build
cd packages/eufy-security-scrypted && npm run build
cd packages/eufy-stream-server && npm run build
```

### Testing

```bash
# Run all tests
npm run test

# Run tests for specific package
cd packages/eufy-security-client && npm run test
cd packages/eufy-stream-server && npm run test
```

### Docker Development Environment

For local development with the `eufy-security-ws` server, use the Docker environment:

```bash
# Configure your Eufy credentials
cp docker/.env.example docker/.env
nano docker/.env

# Start the eufy-security-ws server
cd docker && docker-compose up -d

# Test with the CLI
cd ../packages/eufy-security-cli
npm run start -- device list --ws-host localhost:3000
```

See [docker/README.md](docker/README.md) for detailed setup instructions.

## 🔧 Scrypted Plugin Setup

For the Scrypted plugin package:

1. Open `packages/eufy-security-scrypted` in VS Code
2. Edit `.vscode/settings.json` to point to your Scrypted server IP (default: `127.0.0.1`)
3. Press Launch (green arrow button in Run and Debug sidebar)
4. If prompted, authenticate with `npx scrypted login`

## 🤖 CI/CD

This repository uses GitHub Actions for automated testing and releases:

### Workflows

### Workflows

- **CI**: Runs tests and builds on every push/PR across Node.js versions (18, 20, 22)
- **Code Quality**: Linting, type checking, and formatting validation (runs after tests pass)
- **Release**: Automatic publishing to npm on version tags

### Publishing

To release new versions:

```bash
# Create and push a version tag
git tag v1.0.0
git push origin v1.0.0
```

The release workflow will automatically publish all packages to npm.

## 📋 Scripts

- `npm run build` - Build all packages
- `npm run test` - Run all tests
- `npm run clean` - Clean all packages
- `npm run publish` - Publish packages (requires NPM_TOKEN)

## 🏗️ Architecture

```
eufy-security-scrypted/
├── packages/
│   ├── eufy-security-client/     # WebSocket client library
│   ├── eufy-security-scrypted/   # Scrypted plugin
│   └── eufy-stream-server/       # TCP streaming server
├── .github/workflows/            # CI/CD pipelines
├── lerna.json                    # Monorepo configuration
└── tsconfig.json                 # Shared TypeScript config
```

## 📄 License

MIT
