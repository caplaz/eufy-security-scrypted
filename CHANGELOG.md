# Changelog

All notable changes to the Eufy Security Scrypted monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-09-27

### Changed

- **Versioning**: Changed from independent to fixed versioning across all packages to align with monorepo versioning scheme
- **Package Versions**: Updated all packages from 1.0.0 to 0.1.0 to reflect initial development phase

### Added

- **Monorepo Structure**: Consolidated four packages into a unified monorepo with shared tooling and CI/CD
- **Comprehensive Testing**: Added extensive test coverage across all packages (206 total tests)
- **Documentation**: Standardized README files with consistent formatting and comprehensive examples
- **CI/CD Pipeline**: GitHub Actions workflows for automated testing, building, and publishing

## [1.0.0] - 2024-12-19

### Added

#### Eufy Security Client (`@caplaz/eufy-security-client`)

- Initial release of WebSocket client library for Eufy Security systems
- Complete API coverage for devices, stations, and drivers
- Type-safe event handling and command execution
- Comprehensive test suite (184 tests, 100% pass rate)
- Schema negotiation and version compatibility
- WebSocket client implementation with automatic reconnection
- TypeScript type definitions and event-driven architecture

#### Eufy Security CLI (`@caplaz/eufy-security-cli`)

- Initial release of command-line interface for Eufy Security cameras
- **Stream Command**: Real-time video streaming from Eufy Security cameras
- **List Devices Command**: Discovery and listing of available camera devices
- **Device Info Command**: Detailed information about specific camera devices
- **Monitor Command**: Real-time monitoring of camera connection status and events
- Media player integration (TCP streaming compatible with VLC, FFmpeg)
- WebSocket server integration support
- Comprehensive testing (83 tests covering unit and integration scenarios)
- Cross-platform support (Windows, macOS, Linux)

#### Eufy Security Scrypted (`@scrypted/eufy-security-scrypted`)

- Initial release of Scrypted plugin for Eufy Security devices
- Full integration with Scrypted home automation platform
- Support for Eufy Security cameras, doorbells, and sensors
- Real-time video streaming capabilities
- Device discovery and management through Scrypted interface
- Event handling and notifications (motion detection, doorbell alerts)
- WebSocket server integration for legacy protocol support
- TypeScript implementation with comprehensive test suite

#### Eufy Stream Server (`@caplaz/eufy-stream-server`)

- Initial release of simplified TCP streaming server for raw H.264 video streams
- Raw H.264 video streaming without audio complexity
- TCP server supporting multiple concurrent client connections
- H.264 NAL unit parsing and key frame detection
- Connection management and streaming statistics
- Comprehensive test suite (22 tests, 100% pass rate)
- Event-driven architecture with TypeScript support

### Features

- **Unified Architecture**: All packages work together to provide complete Eufy Security integration
- **Type Safety**: Full TypeScript coverage across all packages for reliability
- **Comprehensive Testing**: 206 total tests ensuring quality and stability
- **Modern Development**: ESLint, Prettier, and GitHub Actions integration
- **Open Source**: MIT licensed for community use and contributions

### Technical

- **Monorepo Management**: Lerna for coordinated package management and publishing
- **Shared Tooling**: Consistent TypeScript configuration and build processes
- **CI/CD Ready**: Automated testing, building, and publishing pipelines
- **Documentation**: Comprehensive README files with usage examples and troubleshooting
- **Security**: Modern Node.js with isolated legacy protocol handling

---

**Note**: This project follows [Semantic Versioning](https://semver.org/). Given a version number MAJOR.MINOR.PATCH:

- **MAJOR** version increases for incompatible API changes
- **MINOR** version increases for backwards-compatible functionality additions
- **PATCH** version increases for backwards-compatible bug fixes

All packages in this monorepo are versioned together and released simultaneously.
