# Changelog

All notable changes to the Eufy Security Scrypted monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Per-HomeBase stream coordination** (#28): A Eufy HomeBase serves only one camera P2P stream at a time. A new station stream coordinator serializes `startLivestream` across cameras on the same HomeBase — live view preempts with a clean stop-before-start handoff ("newest tap wins"), a warm-up guard absorbs the Home-app grid's burst of simultaneous requests, and background work never interrupts a viewer.
- **Wedge detection and automatic station recovery** (#28): Cold-start (no first frame within 18s) and mid-session (15s data stall) watchdogs detect a wedged upstream P2P session, recycle the station connection (`station.disconnect`/`connect`), and automatically restart the livestream for waiting consumers — no more plugin restarts to recover a dead stream. Suppression guards (no-signal, chronic-failure, busy-sibling) protect healthy cameras on a shared HomeBase from recycle storms.
- **Cache-served snapshots and thumbnails** (#28): Camera tiles are served from the last-seen keyframe (persisted across plugin reloads) instead of waking the camera; a placeholder image is returned on a true cache miss rather than throwing, which previously made Scrypted's Snapshot plugin fall back to starting a livestream. Optional per-camera **Background Thumbnail Refresh** setting (Off / 30 min – 4 h) keeps tiles fresh only when the camera is idle and the HomeBase slot is free.
- **Audio-aware fMP4 muxing** (#28): JMuxer mode (`both` vs `video`) is chosen by whether the camera actually delivers a usable ADTS audio track — mic-off and config-packet-only cameras no longer hang the muxer (which left live view black). A muxer that emits nothing within 4s is rebuilt video-only as a backstop.
- **Codec persistence** (#28): The detected video codec (H.264/H.265) is persisted per device and used as a hint on the next plugin start, so the first `getVideoStream()` after a reload advertises the correct codec before any frame arrives.
- **TCP write backpressure** (#34): A stream client whose socket buffer exceeds 4 MB (a consumer that stopped reading, e.g. a wedged FFmpeg) is disconnected instead of accumulating video frames in memory without bound.

### Changed

- **True source codec reported to Scrypted** (#28): The consumer's requested codec no longer overrides the detected one, so an H.265 stream is not relabeled H.264 and `-vcodec copy`'d as-is (fixes black browser preview / HomeKit "Unable to find sync frame").
- **Streaming lifecycle tuning** (#28): Snapshot default timeout 15s → 60s (battery-camera cold start), post-view idle stop 30s → 12s, post-snapshot 8s livestream linger so a follow-up stream request doesn't pay a second cold start.
- **Streaming hot-path performance** (#34): NAL units are parsed once per video frame instead of twice; the per-frame debug string is only built when debug logging is enabled; each WebSocket message is classified in a single pass instead of up to four full-payload scans; NAL type-name tables are module constants.
- **`maxConnections` stream-server option is now actually applied** (#33) — it was previously accepted but ignored (the connection manager hardcoded 10).

### Fixed

- **H.265 cameras produced no decodable stream through the muxed path** (#23, #28): JMuxer was never told the stream was H.265, so HEVC NAL units were written into an `avc1` (H.264) fMP4 container that no downstream consumer could decode — snapshots, prebuffer, and live view all timed out with "no keyframe". The muxer is now constructed with the detected codec (`hvc1` for H.265).
- **WebSocket rate limiter dropped livestream frames** (#32): A global 100 messages/second cap silently discarded messages beyond it. A single streaming camera produces ~15 video + ~40 audio events per second, so two simultaneous streams exceeded the cap and lost video NAL units (corrupted/black video). Livestream data and command results (dropping one strands its pending promise) are now exempt.
- **Parameter-set cache held stale keyframes** (#32): The SPS/PPS/VPS cache stored the entire video event instead of the individual NAL. Eufy bundles parameter sets with the IDR frame, so new TCP clients received old keyframes ahead of the live stream and snapshots could decode a stale picture. The cache now stores just the parameter-set NAL, re-framed with a start code.
- **Plugin reload left the camera streaming** (#32): `stop()` only stopped the upstream livestream when raw TCP clients existed, but the normal HomeKit path uses only muxed-port consumers — so every plugin restart left the camera streaming (battery drain) until the upstream idled it out. Now gated on livestream intent.
- **Talk button missing on doorbells without microphone/speaker properties** (#25): The `Intercom` interface is now gated on the server-side `hasCommand("deviceStartTalkback")` check (the authoritative upstream `DeviceCommands` table) instead of inferring support from `microphone`/`speaker` property presence — models like the Video Doorbell S220 support talkback but don't expose those properties. Thanks [@retrography](https://github.com/retrography).
- **Custom Motion Sensor extension was ignored** (#26, #31): The plugin unconditionally overwrote `motionDetected` with Eufy-reported motion on every state sync, defeating Scrypted's Custom Motion Sensor mixin (the documented way to drive HKSV from an external sensor). Motion sync is now skipped while such a mixin is active, failing open if the mixin can't be resolved. Thanks [@jonkdugan-debug](https://github.com/jonkdugan-debug) for the root cause and validated fix.

### Removed

- **"Memory Threshold" plugin setting and the inert MemoryManager machinery** (#33): The 432-line memory-manager singleton (cleanup-callback registry, monitoring interval, tiered cleanup levels) was never wired up — no cleanup callback was ever registered — so the setting configured machinery that could not act. The settings page and README still display live process memory usage.
- **Deprecated `debug` option on `StreamServerOptions`** (#33): logger `minLevel` has controlled verbosity for a long time.
- Internal dead module `device-manifest-builder.ts` (#33) — zero imports; manifest building lives in `DeviceUtils`.

*Thanks to [@josha](https://github.com/josha) for the shared-HomeBase reliability work (#28).*

## [0.3.1] - 2026-04-20

### Added

- **Device Support**: sync device types with upstream bropat/eufy-security-client

### Fixed

- **Device Support**: ensure standalone devices route through EufyStation by defaulting providerNativeId to station_<serial>
- **Error Handling**: use Promise.allSettled so one bad device doesn't block all others (#22)
- **State Updates**: guard against state updates before device initialization (#17)

## [0.3.0] - 2026-04-19

### Added

- **Audio Streaming**: Live audio is now included in the video stream. The stream server captures AAC/ADTS audio frames from Eufy cameras and muxes them in-process using JMuxer into fragmented MP4, which is served over a dedicated local TCP port. Downstream consumers (Scrypted Rebroadcast, FFmpeg) receive a complete A/V fMP4 stream without any extra transcoding step.
- **Intercom / Talkback**: Cameras that have both microphone and speaker now implement the `Intercom` Scrypted interface, enabling two-way audio. Incoming audio is transcoded by FFmpeg to AAC-LC/ADTS at 16 kHz mono 16 kbps and forwarded to the device over the Eufy talkback channel. The implementation correctly waits for the `TALKBACK_STARTED` confirmation event before sending audio, automatically bootstraps the livestream when none is running, and cleans up on `stopIntercom`.
- **Zombie Connection Cleanup**: `cleanupStaleConnections` now calls `disconnectClient` to force-close TCP connections older than 5 minutes, fixing a case where a SIGKILL-ed FFmpeg peer would leave the connection open indefinitely and keep the activity monitor running.
- **`TALKBACK_AUDIO_DATA` Command**: New `talkbackAudioData(buffer)` method on `DeviceCommandBuilder` and matching `DeviceTalkbackAudioDataCommand` interface for sending raw audio to the device during a talkback session.
- **`IStreamServer.getMuxedPort()`**: New interface method to expose the fMP4 mux server port to the scrypted plugin.
- **H.265/HEVC Camera Support**: Full H.265 support in `H264Parser` — correct NAL unit type extraction (`(byte0 >> 1) & 0x3F`), IRAP keyframe detection (NAL types 16–23), and parameter set identification (VPS/SPS/PPS, NAL types 32–34)
- **VPS Caching**: `StreamServer` now caches the H.265 Video Parameter Set alongside SPS/PPS and sends VPS → SPS → PPS in order to new TCP clients, enabling FFmpeg to initialize H.265 streams immediately
- **Codec Detection**: `StreamServer` reads `videoCodec` from `VideoMetadata` on the first livestream event and dispatches H.264 or H.265 NAL parsing accordingly
- **FFmpeg Codec Helpers**: `FFmpegUtils.toFFmpegFormat()` maps Eufy codec strings to FFmpeg demuxer names (`"hevc"` for H.265, `"h264"` for H.264); `FFmpegUtils.toScryptedCodec()` maps to Scrypted codec strings (`"h265"` / `"h264"`)
- **`IStreamServer.getVideoMetadata()`**: New method on the stream server interface so `StreamService` and `SnapshotService` can read the detected codec at runtime
- **H.265 Parser Tests**: 23 new tests covering NAL type extraction, IRAP keyframe detection, parameter set caching, and codec dispatch in `H264Parser`
- **H.265 Integration Tests**: 4 new `StreamServer` tests covering H.265 snapshot resolution, P-frame rejection, and VPS/SPS/PPS caching
- **eufy-security-ws 2.1.0 Compatibility**: Full support for the updated server schema (schema version 21), including all new station protocol types and command/event payload shapes
- **Missing Station Protocol Types**: Added `StationSetGuardModeCommand` interface and wired it into `StationCommandResponseMap` for guard mode control
- **Corrected Database Event Payloads**: Fixed `StationDatabaseDeleteEventPayload`, `StationDatabaseCountByDateEventPayload`, and `StationDatabaseQueryLocalEventPayload` shapes to match server schema

### Changed

- **Stream container**: The `P2P Stream` media stream option now reports `container: "mp4"` with `audio: { codec: "aac" }` when the muxed port is available, replacing the previous raw `h264`/`h265` container with no audio.
- **FFmpeg input for muxed path**: When a muxed port is available, `StreamService` passes an fMP4 TCP input to FFmpeg (`-f mp4 -i tcp://127.0.0.1:<port>`) instead of the raw NAL unit input, so codec parameters are embedded in the stream header and downstream re-encoding is not needed.
- **Prettier config**: Added `.prettierrc` (2-space, no tabs) so editors with Prettier auto-format stay consistent with the codebase style.
- **`FFmpegUtils.convertH264ToJPEG`**: Accepts an optional `videoCodec` parameter (default `"H264"`); uses the correct FFmpeg demuxer (`-f hevc` for H.265 cameras)
- **`StreamService`**: Detects codec from `streamServer.getVideoMetadata()` and passes the correct FFmpeg input format and Scrypted codec string to `createFFmpegMediaObject`
- **`SnapshotService`**: Passes the detected codec to `FFmpegUtils.convertH264ToJPEG` so H.265 keyframes are decoded correctly
- **`DeviceUtils.convertH264ToJPEG`**: Delegates to `FFmpegUtils.convertH264ToJPEG` (removed ~80-line duplicate FFmpeg implementation)
- **FFmpeg flags**: Added `-hide_banner` and `-loglevel error` to suppress informational output in both stream and snapshot FFmpeg invocations
- **`registerDevicesFromServerState`**: Batches `onDevicesChanged` calls per station instead of one call per device, reducing redundant Scrypted reconciliation cycles
- **Dependency pinning**: `eufy-security-ws` pinned to `^2.1.0` in client and scrypted packages; phantom direct dependency removed from the repo root

### Fixed

- **Intercom capability gating**: `Intercom` is only added to a device's Scrypted interface list when both `microphone` and `speaker` properties are present, preventing a non-functional Talk button from appearing on cameras and sensors that do not support talkback.
- **H.265 NAL type extraction was completely broken**: The old parser used `byte0 & 0x1F` (H.264 formula) on H.265 data, producing wrong NAL types and never detecting keyframes on H.265 cameras
- **H.265 snapshots always failed**: Snapshot capture timed out on H.265 cameras because no keyframe was ever detected
- **Wrong FFmpeg demuxer for H.265**: Streams always passed `-f h264` to FFmpeg regardless of camera codec; H.265 cameras now correctly use `-f hevc`
- **`providerNativeId=undefined` edge case**: `registerDevicesFromServerState` now handles stations with an undefined `providerNativeId` without throwing

*Thanks to [@DTse](https://github.com/DTse) for contributing audio streaming and intercom support.*

## [0.2.1] - 2025-10-26

### Added

- **Error Resilient Camera Types**: Added `ERROR_RESILIENT_CAMERA_TYPES` set for cameras requiring special FFmpeg handling
- **Device-Specific FFmpeg Configuration**: Conditional application of `-enable_er 1` flag only for cameras that need H.264 error resilience
- **requiresErrorResilience() Function**: Helper function to check if a device type requires error resilience settings
- **Extensible Camera Support**: Framework for easily adding future cameras with similar H.264 data partitioning issues

### Changed

- **StreamService Refactoring**: Updated to use device type detection instead of hardcoded camera checks
- **FFmpeg Configuration**: Made error resilience conditional based on device capabilities rather than global setting

### Fixed

- **Selective Error Resilience**: Prevented FFmpeg error resilience from being applied to cameras that don't need it, avoiding stream corruption on other devices

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
