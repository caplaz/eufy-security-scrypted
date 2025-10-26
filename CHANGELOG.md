# Changelog

All notable changes to the Eufy Security Scrypted monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-10-26

### Fixed

- **SoloCam S340 Video Streaming**: Fixed video streaming failures for Eufy SoloCam S340 cameras caused by H.264 data partitioning not being supported by FFmpeg
- **FFmpeg Error Resilience**: Added `-enable_er` flag to FFmpeg commands for better handling of damaged or fragmented video frames
- **H.264 NAL Type Support**: Added support for NAL type 14 (Data Partitioning) in the H.264 parser

### Changed

- **Package Metadata**: Updated author information and repository URLs in all package.json files for proper attribution and issue tracking

## [0.1.6] - 2025-10-12

### Added

- **Enhanced Dynamic README**: Added banner image and comprehensive eufy-security-ws server setup instructions
- **Quick Setup Guide**: Step-by-step instructions for both Docker and NPM installation of eufy-security-ws
- **Visual Branding**: Banner image display in the dynamic plugin documentation

### Fixed

- **Release Workflow**: Fixed GitHub Actions workflow to properly extract changelog from CHANGELOG.md format with square brackets
- **Banner Image Path**: Corrected banner image URL to use GitHub raw content for proper display

### Enhanced

- **User Onboarding**: Improved setup experience with clear server configuration steps
- **Documentation**: Better integration of setup instructions in the dynamic README interface

## [0.1.5] - 2025-10-12

### Added

- **Custom README Interface**: Implemented dynamic README generation with real-time plugin status
- **WebSocket Connection Monitoring**: Live connection status display with troubleshooting guidance
- **Cloud Authentication Dashboard**: Current authentication state with setup instructions
- **Memory Management Status**: Real-time memory usage monitoring and performance recommendations
- **System Status Overview**: Push/MQTT connection status and debug settings display

### Enhanced

- **Plugin Documentation**: Replaced static README with dynamic, context-aware documentation
- **User Experience**: Improved setup and troubleshooting with live status information

## [0.1.4] - 2025-10-12

### Added

- **BinarySensor Interface**: Added support for doorbell ring events as binary sensors in Scrypted
- **Event Listener**: Added `DEVICE_EVENTS.RINGS` event handling for doorbell devices
- **Device State Management**: Enhanced `DeviceStateService` with `binaryState` support for doorbell rings

### Fixed

- **Banner Image Display**: Moved banner image to `public/` folder for proper serving in Scrypted plugin README
- **Sensor Logging**: Improved debug logging for sensor state changes with JSON serialization

### Changed

- **Event Handling**: Consolidated motion detection events into unified handling system
- **State Synchronization**: Updated state change logging to show detailed object values

## [0.1.0] - 2025-10-03

### 🎉 Initial Release

**Eufy Security Scrypted Plugin** - Complete home automation integration for Eufy Security cameras and devices.

#### ✨ Major Features

- **Live Video Streaming**: Real-time H.264 video streaming with FFmpeg compatibility
- **Device Discovery**: Automatic detection and registration of Eufy cameras, doorbells, and stations
- **Snapshot Capture**: High-quality JPEG snapshots from live video streams
- **Motion Detection**: Real-time motion event notifications and alerts
- **Device Control**: Remote control of camera settings, PTZ movement, and device configuration
- **Two-Tier Architecture**: Modern Node.js plugin with legacy protocol server for compatibility

#### 🔧 Technical Improvements

- **SPS/PPS Header Caching**: Automatic FFmpeg stream initialization for new clients
- **Race Condition Fixes**: Eliminated duplicate livestream start attempts during snapshot capture
- **Enhanced State Management**: Improved livestream state synchronization with device status queries
- **Connection Management**: Robust TCP connection handling with automatic cleanup
- **Event-Driven Architecture**: Comprehensive WebSocket event handling and device state updates

#### 📦 Package Ecosystem

- **@caplaz/eufy-security-scrypted**: Main Scrypted plugin with full device integration
- **@caplaz/eufy-security-client**: Type-safe WebSocket client library (318 tests, 100% pass rate)
- **@caplaz/eufy-stream-server**: High-performance TCP streaming server for H.264 video
- **@caplaz/eufy-security-cli**: Command-line interface for testing and automation

#### 🧪 Quality Assurance

- **Comprehensive Testing**: 318 total tests across all packages
- **Type Safety**: Full TypeScript coverage with strict type checking
- **Code Quality**: ESLint configuration with zero warnings
- **Documentation**: Complete API documentation and usage examples

#### 🏗️ Architecture

- **Monorepo Structure**: Unified development with shared tooling and CI/CD
- **Modern Tooling**: TypeScript, Jest, ESLint, Prettier, and GitHub Actions
- **Legacy Compatibility**: Works with all Eufy device generations through eufy-security-ws
- **Home Automation Ready**: Full Scrypted integration with device interfaces

### Changed

- **Versioning**: Changed from independent to fixed versioning across all packages to align with monorepo versioning scheme
- **Package Versions**: Updated all packages from 1.0.0 to 0.1.0 to reflect initial development phase

### Added

- **Monorepo Structure**: Consolidated four packages into a unified monorepo with shared tooling and CI/CD
- **Comprehensive Testing**: Added extensive test coverage across all packages (318 total tests)
- **Documentation**: Standardized README files with consistent formatting and comprehensive examples
- **CI/CD Pipeline**: GitHub Actions workflows for automated testing, building, and publishing

## [0.0.1] - 2024-12-19

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
