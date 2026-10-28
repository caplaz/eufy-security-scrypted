# Why this package exists

`@caplaz/eufy-security-client` gives Node.js applications a typed WebSocket interface to a running [eufy-security-ws](https://github.com/bropat/eufy-security-ws) server. It is a different package from bropat's `eufy-security-client`, which implements the underlying Eufy integration.

```text
Application / Scrypted plugin
          ↓ typed commands and events
@caplaz/eufy-security-client
          ↓ WebSocket JSON messages
      eufy-security-ws
          ↓ Eufy cloud and device protocols
    Eufy account / devices
```

## The server boundary

Eufy integration involves account authentication, device-specific commands, encrypted P2P sessions, and media transport. Keeping those concerns in a dedicated server lets the application use this client without implementing Eufy's protocols itself. It also separates the application's Node.js runtime from the server's runtime and cryptographic requirements.

Legacy RSA padding compatibility has been a motivation for this architecture. Compatibility depends on the upstream library, Node.js/OpenSSL build, device, and server configuration. This package does not establish that all direct Eufy communication fails above one Node.js version, nor does it provide a cryptographic workaround inside the application. Use the server release and runtime supported by the upstream project rather than selecting an obsolete Node.js release based on an old compatibility table.

The repository's [Docker Compose file](../../docker/docker-compose.yml) pins `eufy-security-ws:3.1.0`. See the [Docker guide](../../docker/README.md) for credentials, persistent data, and startup instructions. Client package version **0.4.1** has a declared Node.js minimum of **18.0.0**. Its API manager requires server schema 13 or newer and prefers schema 21; review and test compatibility when changing server versions.

## What the client handles

- WebSocket connection state and API schema negotiation.
- Typed commands grouped by device, station, driver, and server.
- Event callbacks filtered by event source and serial number.
- Authentication challenge data and an exported `AuthenticationManager` for application-driven CAPTCHA/2FA flows.
- Video and audio event payloads, including codec metadata.

The server remains responsible for Eufy credentials and device connectivity. The application remains responsible for choosing devices, handling authentication UI, managing streams it starts, decoding/muxing media, and cleaning up listeners and its WebSocket connection. Media arrives as JSON-serialized buffers and must be converted with `Buffer.from(event.buffer.data)` when using the typed client.

For the Scrypted integration, the [stream-server package](../eufy-stream-server) forwards encoded video to local TCP consumers and caches codec parameter sets. The [Scrypted plugin](../eufy-security-scrypted) handles camera services and FFmpeg integration.

## Choosing the API

Use `EufyWebSocketClient` (the public alias of `ApiManager`) for explicit lifecycle control and typed events. Its constructor is `new EufyWebSocketClient(wsUrl, logger)`. Connect the WebSocket, wait for schema readiness, enable server listening, then initiate driver login if needed. Camera commands go through `client.commands.device(serialNumber)`.

The exported `EufySecurityClient` is a separate CLI-oriented wrapper with an options-object constructor and a smaller EventEmitter API. Avoid mixing the two clients' methods. The [README](./README.md) includes a complete typed-client example, authentication sequence, binary handling, and an API comparison.

## Operational tradeoffs

A separate server adds a process, persistent authentication state, and a network hop. It needs to be reachable whenever the application controls a camera or receives events. Run it on a trusted network or provide appropriate protection for remote access; the client does not automatically add endpoint authentication or TLS to a plain `ws://` URL.

Stream startup and resource usage vary by device, network, server configuration, and consumer. This repository does not provide reproducible benchmarks supporting a fixed latency or memory overhead. Measure the deployment that matters to your application, especially for sleeping battery cameras and cameras sharing a HomeBase.
