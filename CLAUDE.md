# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is an npm workspaces monorepo managed by Lerna with four packages:

```
packages/
  eufy-security-client/   # @caplaz/eufy-security-client — WebSocket client library
  eufy-stream-server/     # @caplaz/eufy-stream-server — TCP H.264 streaming server
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

Modern Node.js (≥18.19.1) cannot talk directly to Eufy devices due to deprecated crypto. The `eufy-security-ws` Docker container bridges the gap.

### Key Dependency Constraint

`eufy-security-client` depends on `eufy-security-ws` npm package for type definitions, but at runtime it connects to a *running* `eufy-security-ws` Docker container via WebSocket.

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

`StreamServer` (from `eufy-stream-server`) listens on a random local TCP port. FFmpeg connects to this port to receive raw H.264 NAL units from the Eufy camera's WebSocket video data.

### eufy-stream-server

Pure TCP server. `StreamServer` → `ConnectionManager` (tracks clients) + `H264Parser` (NAL unit detection/keyframe extraction). Receives video data events from `EufyWebSocketClient` and forwards raw buffers to TCP clients.

## Commands

### Root (all packages)

```bash
npm install          # install all dependencies
npm run build        # build all packages via lerna
npm run test         # run all tests via lerna
npm run lint         # lint all packages
```

### Per-package (cd into package directory first)

```bash
npm run build        # TypeScript compile (tsc --build)
npm run build:watch  # watch mode
npm run typecheck    # type-check without emitting
npm run lint         # eslint with zero warnings
npm run lint:fix     # auto-fix lint issues
npm run test         # jest
npm run test:unit    # jest --testPathPattern=unit
npm run test:integration  # jest --testPathPattern=integration
npm run test:coverage     # jest --coverage
npm run clean        # remove dist/, coverage/, .tsbuildinfo
```

For `eufy-security-scrypted`, build uses `scrypted-webpack` instead of `tsc` directly.

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
- ESLint config is shared at repo root (`.eslintrc.js`); run with `--max-warnings 0`.
- `tslog` is used throughout for structured logging. In Scrypted, logs are routed via `attachTransport` to route to the device's Scrypted console window rather than the plugin console.
- Event types in `eufy-security-client` are defined in `src/types/events.ts` and `src/device/events.ts` etc. When adding new event types, follow the pattern of adding to the union type `EventType` and providing a payload mapping.
- Device and station properties use string-keyed maps defined in `src/device/properties.ts` and `src/station/properties.ts`. The `DeviceProperties` and `StationProperties` types are central to state management.
- Schema compatibility (`src/types/schema.ts`) tracks `eufy-security-ws` server schema versions for backward compatibility.
