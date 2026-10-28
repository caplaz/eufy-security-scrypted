# Eufy Security WS Docker environment

This Compose setup runs [`bropat/eufy-security-ws`](https://github.com/bropat/eufy-security-ws) as the WebSocket bridge used by this repository. The image is pinned to **3.1.0**, the server release used for API schema 21 compatibility. Review compatibility before changing that pin.

## Start the server

From the repository root:

```bash
cd docker
cp .env.example .env
```

Edit `.env` with your Eufy account credentials, then start the service:

```bash
docker compose up -d
docker compose ps
docker compose logs -f eufy-security-ws
```

By default the endpoint is `ws://localhost:3000`. If Scrypted runs on another host, use the Docker host's address. If it runs in another container, `localhost` refers to that container; use an address reachable from it.

## Configuration

These are the variables actually forwarded by [docker-compose.yml](docker-compose.yml):

| `.env` variable       | Container variable    | Default                              |
| --------------------- | --------------------- | ------------------------------------ |
| `EUFY_EMAIL`          | `USERNAME`            | Required: your Eufy account email    |
| `EUFY_PASSWORD`       | `PASSWORD`            | Required: your Eufy account password |
| `PORT`                | `PORT`                | `3000`                               |
| `LOG_LEVEL`           | `LOG_LEVEL`           | `info`                               |
| `TRUSTED_DEVICE_NAME` | `TRUSTED_DEVICE_NAME` | `eufy-security-ws`                   |

`PORT` changes both the container's listening port and its published host port. For example, `PORT=3001` makes the endpoint `ws://localhost:3001`.

The container stores persistent state in `docker/data` through the `./data:/data` bind mount. Preserve this directory across restarts. The service uses `restart: unless-stopped`.

The MQTT examples in `.env.example` are **not forwarded by this Compose file**. Adding them to `.env` alone does not enable MQTT integration. The WebSocket connection is sufficient for this repository's client and Scrypted plugin.

## Manage the service

Run these commands from the `docker` directory:

```bash
docker compose logs -f eufy-security-ws
docker compose restart eufy-security-ws
docker compose down
docker compose up -d
```

The configured health check tests whether the TCP port accepts a connection. It does not verify Eufy authentication or that cameras can stream. This setup does not define an HTTP `/health` endpoint; inspect Compose status and server logs, then check driver status through the CLI.

## Check with the workspace CLI

The CLI is a private workspace package. Build it from the repository rather than downloading an npm package. From the repository root:

```bash
npm install
npm run build
node packages/eufy-security-cli/dist/main.js driver status --ws-host localhost:3000
node packages/eufy-security-cli/dist/main.js driver connect --ws-host localhost:3000
node packages/eufy-security-cli/dist/main.js device list --ws-host localhost:3000
```

See the [CLI README](../packages/eufy-security-cli/README.md) for streaming, options, and CAPTCHA/verification-code commands.

## Troubleshooting

- **Authentication fails:** check `EUFY_EMAIL` and `EUFY_PASSWORD`, then inspect server logs and complete any authentication challenge with the CLI.
- **Port is occupied:** set a different `PORT` in `.env`, then run `docker compose up -d` to recreate the service with the new mapping. Update client addresses to match.
- **Connection is refused:** inspect `docker compose ps` and `docker compose logs eufy-security-ws`; verify the published port and connectivity from the client host/container.
- **Camera livestream fails:** confirm driver authentication and device availability first, then inspect the server's P2P/device logs. The checked-in Compose configuration uses published ports and does not enable host networking.

Upstream resources: [GitHub](https://github.com/bropat/eufy-security-ws) and [Docker Hub](https://hub.docker.com/r/bropat/eufy-security-ws).
