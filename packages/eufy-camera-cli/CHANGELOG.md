# Changelog

All notable changes to the Eufy Camera CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-19

### Added

- Initial release of Eufy Camera CLI
- **Stream Command** - Real-time video streaming from Eufy Security cameras
- **List Devices Command** - Discovery and listing of available camera devices
- **Device Info Command** - Detailed information about specific camera devices
- **Monitor Command** - Real-time monitoring of camera connection status and events
- **Media Player Integration** - TCP streaming compatible with VLC, FFmpeg, and other players
- **WebSocket Integration** - Support for Scrypted and other WebSocket servers
- **Flexible Configuration** - Environment variables and extensive CLI options
- **TypeScript Support** - Full TypeScript implementation with type definitions
- **Comprehensive Testing** - 83 tests covering unit and integration scenarios
- **Cross-platform Support** - Windows, macOS, and Linux compatibility

### Features

- Real-time TCP video streaming with minimal latency
- Support for multiple WebSocket URL formats (ws://, wss://, IP, hostname)
- Verbose logging for debugging and troubleshooting
- Graceful shutdown handling with cleanup
- Executable CLI with proper shebang for direct execution
- Professional error handling and validation
- Format options for structured output (table, JSON, CSV)
- Connection monitoring with customizable intervals

### Technical

- Built with TypeScript for type safety and better development experience
- Comprehensive test suite with Jest (83 tests, 100% pass rate)
- Proper package configuration for npm publishing
- CI/CD ready with GitHub Actions integration
- Follows semantic versioning and changelog best practices
- MIT licensed for open source use

### Documentation

- Comprehensive README with usage examples
- Troubleshooting guide with common issues and solutions
- API documentation for programmatic usage
- Development setup and contribution guidelines
- Security reporting procedures

## [Unreleased]

### Planned

- Configuration file support (.eufyrc, eufy.config.js)
- Plugin system for custom media player integrations
- Recording capabilities with automatic file rotation
- Multi-camera streaming support
- Web dashboard for monitoring multiple cameras
- Docker container support
- Prometheus metrics export
- Home Assistant integration
- Motion detection event handling
- Camera PTZ (Pan-Tilt-Zoom) control commands

---

**Note**: This project follows [Semantic Versioning](https://semver.org/). Given a version number MAJOR.MINOR.PATCH:

- **MAJOR** version increases for incompatible API changes
- **MINOR** version increases for backwards-compatible functionality additions
- **PATCH** version increases for backwards-compatible bug fixes
