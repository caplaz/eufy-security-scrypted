# Plugin architecture

This guide describes the code used for the 0.4.1 release. For installation and camera settings, use the [plugin README](README.md); for builds and releases, use the [repository README](../../README.md).

## Device hierarchy and data flow

```text
main.ts (default export: EufySecurityProvider)
  └── EufySecurityProvider: connection, authentication, discovery, shared encoder settings
        └── EufyStation: station devices and security-system state
              └── EufyDevice: camera/sensor interfaces, settings, and lifecycle

Eufy cloud/devices ↔ eufy-security-ws ↔ EufyWebSocketClient
                                         ├── property and state services
                                         └── StreamServer
                                               ├── raw H.264/H.265 TCP
                                               └── fMP4 TCP, with usable AAC audio
                                                     └── optional H.264 compatibility relay
```

The companion server implements direct Eufy communication and decryption. `@caplaz/eufy-security-client` implements its WebSocket API and is distinct from upstream `bropat/eufy-security-client`.

## Main modules

Paths below are relative to this package.

| Module                                                                             | Responsibility                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [src/main.ts](src/main.ts)                                                         | Plugin entry point; default-exports `EufySecurityProvider`                                                                |
| [src/eufy-provider.ts](src/eufy-provider.ts)                                       | WebSocket setup, account challenges, discovery, provider settings, shared compatibility configuration, and dynamic README |
| [src/eufy-station.ts](src/eufy-station.ts)                                         | Station properties, security system controls, and child devices                                                           |
| [src/eufy-device.ts](src/eufy-device.ts)                                           | Wires services to Scrypted interfaces, events, thumbnail persistence/refresh, intercom, and station recovery              |
| [src/utils/device-utils.ts](src/utils/device-utils.ts)                             | Device manifests and type/capability helpers                                                                              |
| [src/utils/scrypted-device-interfaces.ts](src/utils/scrypted-device-interfaces.ts) | Builds interface lists from capabilities and available properties/commands                                                |

Non-camera devices receive only supported interfaces. For example, entry sensors use `BinarySensor`, motion sensors use `MotionSensor`, and locks are not currently advertised as Scrypted `Lock` devices. Keep detection and interface selection consistent when adding device support.

## Services

| Service               | Source and role                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AuthenticationManager | [client authentication-manager.ts](../eufy-security-client/src/authentication-manager.ts): provider CAPTCHA and verification-code flows                        |
| DevicePropertyService | [device-property-service.ts](src/services/device/device-property-service.ts): standalone property helper; not instantiated by the current EufyDevice           |
| DeviceSettingsService | [device-settings-service.ts](src/services/device/device-settings-service.ts): property metadata to settings, custom names/settings, and updates                |
| DeviceStateService    | [device-state-service.ts](src/services/device/device-state-service.ts): property-to-Scrypted-state conversion and change notifications                         |
| RefreshService        | [refresh-service.ts](src/services/device/refresh-service.ts): API refresh operations and callbacks                                                             |
| StreamService         | [stream-service.ts](src/services/device/stream-service.ts): codec verification/bootstrap, selection, local media inputs, relay lifecycle, and consumer handoff |
| SnapshotService       | [snapshot-service.ts](src/services/device/snapshot-service.ts): cached-keyframe JPEG conversion or a placeholder; does not wake cameras on demand              |
| PtzControlService     | [services/control](src/services/control/ptz-control-service.ts): pan/tilt commands                                                                             |
| LightControlService   | [services/control](src/services/control/light-control-service.ts): floodlight on/off and brightness                                                            |
| VideoClipsService     | [services/video](src/services/video/video-clips-service.ts): station-database/P2P and cloud clip retrieval                                                     |

The local [AuthenticationService](src/services/authentication/authentication-service.ts) also exists, but the provider uses the client AuthenticationManager above. [Interface handlers](src/services/interfaces/) and shared [device service types](src/services/device/types.ts) provide additional helpers and service contracts. Consult constructors and tests before using these internal classes directly; they are not a separate public SDK.

## Stream lifecycle

The stream package's [StreamServer](../eufy-stream-server/src/stream-server.ts) subscribes to device-filtered video/audio events. It tracks raw clients, pending and active muxers, snapshots, and metadata bootstrap consumers when deciding whether upstream video is needed.

- A first consumer can start the camera. Short no-consumer gaps are tolerated so Rebroadcast reconnections do not repeatedly cold-start a battery camera.
- Raw clients receive cached parameter sets. New muxers are also primed with cached H.264 SPS/PPS or H.265 VPS/SPS/PPS; cameras reporting zero FPS use the intended 15fps fallback.
- The muxed path uses JMuxer and includes usable ADTS AAC audio. Video-only fallback prevents an unusable audio track from blocking all output.
- A start rejected as `device_livestream_already_running` is accepted after a stale status check. Actual video events and no-data monitoring still govern stream health.
- Cold-start and stale-data watchdogs can signal an upstream wedge. Device-level recovery coordinates station recycling and uses suppression rules to avoid disrupting healthy siblings or repeatedly waking failing devices.

### Shared HomeBase slots

[station-stream-coordinator.ts](src/utils/station-stream-coordinator.ts) grants one camera stream slot per station, distinguishes live and background requests, and provides a bounded stop-before-start handoff. A live request may preempt after the warm-up guard; background work cannot preempt a holder.

When a slot is revoked, existing consumers stay yielded until they drain. If there were no consumers, the latch must not block future viewers. Revocation teardown is serialized with incoming consumers: stop the old upstream stream, release the old lease, then allow a new acquisition. Idle cleanup also clears a stale revocation latch. These are the recovery fixes in 0.4.1.

### Native versus compatibility output

[stream-selector.ts](src/services/device/stream-selector.ts) owns the routing decision for `Auto`, `Force`, and `Native`, explicit stream IDs, and consumer destinations. An explicit `p2p` request remains native. `p2p-h264` is a strict verified-H.265-to-H.264 contract; unavailable verification or encoder admission produces an error.

The [compatibility relay](../eufy-stream-server/src/h264-compatibility-relay.ts) shares a software FFmpeg encoder across viewers of a camera. Shared capacity and temperature admission are managed by the stream package's encoder pool and thermal governor. Defaults are one encoder and 85 °C / 75 °C admission thresholds. Existing encoders are not stopped by the admission gate.

## Snapshots and background work

`EufyDevice` persists last-seen keyframes and manages background thumbnail scheduling. `SnapshotService.takePicture()` converts the last cached keyframe to JPEG or returns a placeholder when no frame is cached. A cached tile can be stale even when a fresh live-view attempt fails.

[thumbnail-refresh.ts](src/utils/thumbnail-refresh.ts) defines the idle refresh policy and choices; the default is two hours. Background work only runs when the camera is idle and the station slot is available, with backoff after failed attempts. The stream package's `captureSnapshot()` is a separate lower-level API that can start upstream video and wait for a fresh keyframe.

## Utilities and logging

- [ffmpeg-utils.ts](src/utils/ffmpeg-utils.ts): codec-aware demuxer/codec names and JPEG conversion.
- [property-mapper.ts](src/utils/property-mapper.ts): metadata-based settings and value conversion.
- [recycle-guard.ts](src/utils/recycle-guard.ts): suppression of repeated/no-signal/busy-station recovery attempts.
- [memory-manager.ts](src/utils/memory-manager.ts): current RSS/heap reporting only. There is no memory-threshold cleanup manager.
- [scrypted-device-detection.ts](src/utils/scrypted-device-detection.ts): Scrypted device identity helpers.

Logging uses `tslog`. Device/station log transports route messages to their Scrypted consoles. Register targeted WebSocket listeners with serial-number filters and remove listeners/timers during disposal.

## Verification

Run from the repository root:

```bash
npm run build
npm run test
npm run lint
npm run format:check
npm test --workspace=@caplaz/eufy-security-scrypted -- tests/unit/services/stream-service.test.ts
```

Tests cover routing, bootstrap handoffs, property/state conversion, snapshots, authentication, controls, station coordination, and recovery policies. Stream-package tests cover TCP/muxer behavior, real JMuxer priming, relay lifecycle, and FFmpeg conversion. Physical-device coverage still depends on the tested hardware; avoid inferring universal compatibility from unit tests.

[MIT License](LICENSE).
