# Changelog

All notable changes to the Eufy Stream Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-09-27

### Changed

- **Versioning**: Changed from independent to fixed versioning to align with monorepo versioning scheme
- **Package Version**: Updated from 1.0.0 to 0.1.0 to reflect initial development phase

## [1.0.0] - 2024-12-19

### Added

- Initial release of Eufy Stream Server
- Simplified TCP streaming server for raw H.264 video streams
- Raw H.264 video streaming without audio complexity
- TCP server supporting multiple concurrent client connections
- H.264 NAL unit parsing and key frame detection
- Connection management and streaming statistics
- Comprehensive test suite (22 tests)
- Event-driven architecture with TypeScript support
- CI/CD ready with GitHub Actions integration

### Features

- Raw H.264 video streaming
- Multiple concurrent client connections
- NAL unit parsing and key frame detection
- Connection statistics and monitoring
- Graceful connection handling
- TypeScript implementation
- Comprehensive error handling
- Debug logging and troubleshooting

### Technical

- Built with TypeScript for type safety
- Comprehensive test suite with Jest (22 tests, 100% pass rate)
- TCP server implementation
- H.264 video parsing
- Event-driven architecture
- Proper package configuration for npm publishing
- Follows semantic versioning and changelog best practices
- MIT licensed for open source use
