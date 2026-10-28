# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is an npm workspaces monorepo managed by Lerna with four packages:

```
packages/
  eufy-security-client/   # @caplaz/eufy-security-client — WebSocket client library
  eufy-stream-server/     # @caplaz/eufy-stream-server — TCP H.264/H.265 streaming server
  eufy-security-scrypted/ # @caplaz/eufy-security-scrypted — Scrypted plugin
  eufy-security-cli/      # @caplaz/eufy-security-cli — CLI tool (private)
```

### Data Flow

```
Eufy Cloud/Devices ← eufy-security-ws (Docker) ← eufy-security-client (WebSocket)
                                                         ↓
                                               eufy-stream-server (TCP)
                                                         ↓
                                          eufy-security-scrypted (Scrypted plugin)
```

The companion `eufy-security-ws` server owns Eufy cloud authentication, decryption, and direct device/P2P communication. This repository uses its WebSocket API; do not assume compatibility with every firmware or runtime from that separation alone.

### Key Dependency Constraint

`@caplaz/eufy-security-client` is distinct from upstream `bropat/eufy-security-client`. At runtime it connects to a running `eufy-security-ws` server via WebSocket. The repository targets server 3.1.0 and schema 21; check the current manifest and schema negotiation before changing compatibility.

### eufy-security-client

Main export is `EufyWebSocketClient` (alias for `ApiManager`). The client wraps:

- `WebSocketClient` — raw WebSocket protocol
- `ClientStateManager` — connection lifecycle state machine
- `AuthenticationManager` — captcha/2FA flows
- `EnhancedCommandAPI` — fluent command builder (`client.commands.device(sn).setProperty(...)`)

Events are typed via `EventCallbackForType<T, Source>`. Event sources are `DEVICE`, `STATION`, or `SERVER`. Always register listeners with a `{ serialNumber }` filter when targeting a specific device.

### eufy-security-scrypted

Entry point: `packages/eufy-security-scrypted/src/main.ts` exports `EufySecurityProvider`.

`EufySecurityProvider` (DeviceProvider) → creates `EufyStation` instances per station → each station creates `EufyDevice` instances per camera/sensor.

`EufyDevice` delegates all behavior to focused services:

- `DeviceSettingsService` — Scrypted settings UI
- `DeviceStateService` — converts Eufy properties → Scrypted state
- `RefreshService` — periodic API polling
- `StreamService` — video stream lifecycle
- `SnapshotService` — JPEG snapshot capture
- `PtzControlService` — pan/tilt/zoom commands
- `LightControlService` — floodlight on/off/brightness
- `VideoClipsService` — cloud video clip retrieval

`StreamServer` (from `eufy-stream-server`) listens on a random local TCP port. FFmpeg connects to this port to receive raw H.264 or H.265 NAL units from the Eufy camera's WebSocket video data. The codec is auto-detected from the first `LIVESTREAM_VIDEO_DATA` event and cached as `VideoMetadata` on the `StreamServer` instance.

### eufy-stream-server

TCP stream server with raw-video and local fMP4 endpoints. `StreamServer` → `ConnectionManager` (tracks clients) + `H264Parser` (NAL unit detection/keyframe extraction for both H.264 and H.265/HEVC). Receives filtered video/audio events from `EufyWebSocketClient`, forwards raw video to TCP clients, and uses JMuxer for fMP4 with usable AAC audio. Caches SPS/PPS (H.264) or VPS/SPS/PPS (H.265) parameter sets and prepends them to new TCP connections so downstream consumers can initialize without waiting for repeated parameter sets. New muxers are also primed from that cache. The optional H.264 compatibility relay uses FFmpeg; raw/native muxing does not transcode.

## Commands

### Root (all packages)

```bash
npm install          # install all dependencies
npm run build        # build all packages via lerna
npm run test         # run all tests via lerna
npm run lint         # lint all packages
npm run format       # format JS/TS/JSON files with prettier
npm run format:check # check formatting (also runs in pre-commit hook)
```

### Per-package commands

Use `npm run <script> --workspace=@caplaz/<package>` from the root, or change into the package directory. Scripts differ by package; inspect its `package.json` rather than assuming they are shared.

- All packages expose `build`, `test`, `test:watch`, `lint`, and `lint:fix`.
- Client, plugin, and CLI expose `build:watch`, `typecheck`, `test:coverage`, and `clean`.
- Stream-server uses `dev` for TypeScript watch and `build` for type checking; it has no `typecheck` or `clean` script.
- Only the client exposes `test:unit` and `test:integration`.
- Root `clean` is `lerna clean` and removes package dependency directories; it does not run package build-output cleanup scripts.

The plugin build uses `scrypted-webpack`: development output is `out/`, and `NODE_ENV=production` writes `dist/plugin.zip`. Verify that ZIP is included with `npm pack --dry-run --ignore-scripts --workspace=@caplaz/eufy-security-scrypted` before publishing.

### Run a single test file

```bash
cd packages/eufy-security-client
npx jest tests/unit/websocket-client.test.ts
```

### eufy-security-ws Docker server

```bash
cd docker
EUFY_EMAIL=... EUFY_PASSWORD=... docker compose up
# Default port: 3000
```

## Code Conventions

- All packages use TypeScript strict mode with `ts-jest` for tests.
- ESLint config is shared at repo root (`eslint.config.js`); run with `--max-warnings 0`.
- `tslog` is used throughout for structured logging. In Scrypted, logs are routed via `attachTransport` to route to the device's Scrypted console window rather than the plugin console.
- Event types in `eufy-security-client` are defined in `src/types/events.ts` and `src/device/events.ts`, and source-specific event modules. When adding new event types, follow the pattern of adding to the union type `EventType` and providing a payload mapping.
- Device and station properties use string-keyed maps defined in `src/device/properties.ts` and `src/station/properties.ts`. The `DeviceProperties` and `StationProperties` types are central to state management.
- Schema compatibility (`src/types/schema.ts`) tracks `eufy-security-ws` server schema versions for backward compatibility.

## Documentation and releases

Keep the root README, package READMEs, architecture guide, Docker guide, and provider `getReadmeMarkdown()` consistent with source. Use [the root release guide](README.md#release-preparation-and-publishing) for coordinated versions, lockfile metadata, contributor credits, and package-content checks. Pushing a `v*` tag triggers npm publication; a preparation PR does not.
