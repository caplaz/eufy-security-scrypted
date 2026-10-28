# Eufy Security for Scrypted

[![Release](https://github.com/caplaz/eufy-security-scrypted/actions/workflows/release.yml/badge.svg)](https://github.com/caplaz/eufy-security-scrypted/actions/workflows/release.yml)

Integrate supported Eufy cameras, doorbells, stations, and sensors with Scrypted through a companion `eufy-security-ws` server. Device support depends on the model, firmware, and upstream server; see the [plugin setup and limitations](packages/eufy-security-scrypted/README.md).

## Getting started

1. Run the companion server using the [Docker setup](docker/README.md). This repository targets `bropat/eufy-security-ws:3.1.0` and API schema 21.
2. In Scrypted, install **@caplaz/eufy-security-scrypted** from the plugin installer.
3. Set **WebSocket URL** to an address reachable from Scrypted, then use **Connect to Eufy Cloud** and complete CAPTCHA or 2FA if prompted. Eufy account credentials belong in the companion server configuration.
4. Open a camera in Scrypted before configuring HomeKit or other consumers. For H.265 sources, read about [native and compatibility streams](packages/eufy-security-scrypted/README.md#native-and-compatibility-streams).

When Scrypted runs in Docker, `localhost` refers to its container. Use the companion container's service name on a shared network or a reachable host address.

## 0.4.1 changes

This patch release covers muxer initialization between keyframes, the 15fps fallback for cameras reporting zero FPS, already-running livestream status mismatches, and recovery after an idle camera loses its HomeBase slot. It also ensures the production plugin ZIP is included in npm packages. See the [changelog and contributor credits](CHANGELOG.md#041---2026-10-28).

## Packages

| Package                                                                     | Purpose                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [@caplaz/eufy-security-scrypted](packages/eufy-security-scrypted/README.md) | Scrypted plugin: discovery, events, controls, video, snapshots, and clips             |
| [@caplaz/eufy-security-client](packages/eufy-security-client/README.md)     | Typed WebSocket commands and events for the companion server                          |
| [@caplaz/eufy-stream-server](packages/eufy-stream-server/README.md)         | Raw H.264/H.265 TCP output, fMP4 muxing with AAC audio, and optional H.264 conversion |
| [@caplaz/eufy-security-cli](packages/eufy-security-cli/README.md)           | Private workspace CLI for local development and diagnostics; not published to npm     |

All four packages share a version through Lerna. The plugin and CLI use both the client and stream server; the stream server also depends on the client.

## Architecture

```text
Eufy cloud / devices
        ↕
eufy-security-ws (companion server)
        ↕ WebSocket commands and events
@caplaz/eufy-security-client
        ├── Scrypted provider → station → camera / sensor
        └── @caplaz/eufy-stream-server
                ├── Raw H.264/H.265 TCP → FFmpeg / CLI consumers
                └── fMP4 TCP with usable AAC audio → Scrypted consumers
                        └── Optional shared H.265 → H.264 relay
```

The companion server owns Eufy cloud authentication and direct device/P2P protocol handling. This repository's client consumes its WebSocket API; it is a separate package from upstream `bropat/eufy-security-client`. See [why the client exists](packages/eufy-security-client/WHY_THIS_PACKAGE.md) and the [plugin architecture](packages/eufy-security-scrypted/ARCHITECTURE.md).

The default `ws://` connection and local TCP outputs are unencrypted. Use a trusted network; this integration does not imply that Eufy cloud access is unnecessary.

## Development

Clone the repository and run commands from its root:

```bash
git clone https://github.com/caplaz/eufy-security-scrypted.git
cd eufy-security-scrypted
npm ci
npm run build
npm run test
npm run lint
npm run format:check
```

CI builds and tests with Node.js 18, 20, and 22. Individual development tools can have stricter engine requirements; check npm's engine warnings for your installed dependencies.

Use npm workspaces to target a package without changing directories:

```bash
npm run build --workspace=@caplaz/eufy-security-client
npm run typecheck --workspace=@caplaz/eufy-security-scrypted
npm test --workspace=@caplaz/eufy-stream-server -- tests/stream-server.test.ts
npm run test:watch --workspace=@caplaz/eufy-security-client
```

| Root command           | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run build`        | Build all packages in dependency order                                          |
| `npm run test`         | Run all package test suites                                                     |
| `npm run lint`         | Lint source across all four packages with zero warnings                         |
| `npm run format`       | Format JS, TS, and JSON files                                                   |
| `npm run format:check` | Check JS, TS, and JSON formatting                                               |
| `npm run clean`        | Run Lerna's dependency cleanup; this removes package `node_modules` directories |

There is no root `type-check` or `test:watch` script. Client, plugin, and CLI expose `typecheck`; their package READMEs describe other available scripts. To remove build output, use a package's `clean` script where available rather than the root cleanup command.

### Release preparation and publishing

1. Update `lerna.json`, all workspace versions, internal dependency ranges, and matching workspace records in `package-lock.json`.
2. Add dated notes and contributor credits to [CHANGELOG.md](CHANGELOG.md). Keep an empty `Unreleased` heading for future changes.
3. Run the build, tests, lint, and formatting checks above. Build the plugin in production mode and inspect package contents:

   ```bash
   NODE_ENV=production npm run build --workspace=@caplaz/eufy-security-scrypted
   npm pack --dry-run --ignore-scripts --workspace=@caplaz/eufy-security-scrypted
   ```

   The package must include `dist/plugin.zip`. Also inspect the client and stream-server packages for their compiled `dist` entry points.

4. Merge the release preparation PR after review and passing CI.
5. When publishing is intended, tag the merged commit with the matching version and push that tag. For this version:

   ```bash
   git tag -a v0.4.1 -m "Release v0.4.1"
   git push origin v0.4.1
   ```

Pushing a `v*` tag runs the [release workflow](.github/workflows/release.yml): install, build, test, publish the three public packages with the `latest` npm tag, and create a GitHub release using the matching changelog section. It requires a configured `NPM_TOKEN`. The private CLI is not published. Preparing or merging a version bump alone does not publish it.

## Contributing and support

Submit changes through a PR with a description and relevant verification. For device problems, include the model, firmware, plugin/Scrypted/server versions, reproduction steps, and matching plugin and companion-server debug logs. Redact credentials and identify serial numbers consistently.

Thanks to [@bropat](https://github.com/bropat) for [eufy-security-ws](https://github.com/bropat/eufy-security-ws), [Scrypted](https://www.scrypted.app/), and the contributors credited in the [changelog](CHANGELOG.md). Version 0.4.1 includes fixes and diagnostics from [@realAbitbol](https://github.com/realAbitbol), [@engim4-git](https://github.com/engim4-git), and [@jeepster5](https://github.com/jeepster5).

[MIT License](LICENSE).
