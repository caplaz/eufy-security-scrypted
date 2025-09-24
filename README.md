# Eufy Security Scrypted

A monorepo containing Scrypted plugins and libraries for Eufy Security integration.

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

## 🚀 Development

### Prerequisites

- Node.js 18+ and npm
- Scrypted server (for the plugin package)

### Setup

```bash
# Install all dependencies
npm install

# Install package-specific dependencies
npm run bootstrap
```

### Building

```bash
# Build all packages
npm run build

# Build individual packages
cd packages/eufy-security-client && npm run build
cd packages/eufy-security-scrypted && npm run build
```

### Testing

```bash
# Run all tests
npm run test

# Run tests for specific package
cd packages/eufy-security-client && npm run test
```

### Development Workflow

```bash
# Start development mode (client package)
cd packages/eufy-security-client && npm run dev

# Debug the Scrypted plugin
cd packages/eufy-security-scrypted
# Open in VS Code and use the Launch button (green arrow)
```

## 🔧 Scrypted Plugin Setup

For the Scrypted plugin package:

1. Open `packages/eufy-security-scrypted` in VS Code
2. Edit `.vscode/settings.json` to point to your Scrypted server IP (default: `127.0.0.1`)
3. Press Launch (green arrow button in Run and Debug sidebar)
4. If prompted, authenticate with `npx scrypted login`

## 🤖 CI/CD

This repository uses GitHub Actions for automated testing and releases:

### Workflows

- **CI**: Runs tests and builds on every push/PR (Node.js 18, 20, 22)
- **Code Quality**: Linting, type checking, and format validation
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
- `npm run bootstrap` - Install all dependencies
- `npm run publish` - Publish packages (requires NPM_TOKEN)

## 🏗️ Architecture

```
eufy-security-scrypted/
├── packages/
│   ├── eufy-security-client/     # WebSocket client library
│   └── eufy-security-scrypted/   # Scrypted plugin
├── .github/workflows/            # CI/CD pipelines
├── lerna.json                    # Monorepo configuration
└── tsconfig.json                 # Shared TypeScript config
```

## 📄 License

MIT
