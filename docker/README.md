# Eufy Security WS Docker Environment

This directory contains a simple Docker Compose setup for running the official [`bropat/eufy-security-ws`](https://hub.docker.com/r/bropat/eufy-security-ws) Docker image locally for development and testing.

## 🚀 Quick Start

1. **Configure your Eufy credentials:**

   ```bash
   cp .env.example .env
   nano .env  # Edit with your Eufy account details
   ```

2. **Start the service:**

   ```bash
   docker-compose up -d
   ```

3. **Check status:**
   ```bash
   docker-compose logs -f eufy-security-ws
   ```

The server will be available at `ws://localhost:3000`

## ⚙️ Configuration

### Environment Variables (.env)

The following environment variables are supported by the official `bropat/eufy-security-ws` Docker image:

```bash
# REQUIRED: Eufy Account Credentials (mapped to supported variables)
EUFY_EMAIL=your-email@example.com      # Maps to USERNAME
EUFY_PASSWORD=your-password           # Maps to PASSWORD

# OPTIONAL: Server Configuration
PORT=3000                             # Server port (default: 3000)
LOG_LEVEL=info                        # Logging level: error, warn, info, debug
TRUSTED_DEVICE_NAME=eufy-security-ws  # Device name for Eufy server identification

# OPTIONAL: MQTT Integration (for Home Assistant, etc.)
MQTT_BROKER_URL=mqtt://192.168.1.50:1883  # MQTT broker connection URL
MQTT_USERNAME=your-mqtt-username           # MQTT authentication username
MQTT_PASSWORD=your-mqtt-password           # MQTT authentication password
MQTT_CLIENT_ID=eufy-security-ws            # MQTT client identifier
MQTT_PREFIX=eufy_security                  # Topic prefix for published messages
```

**Note:** The Docker image internally uses `USERNAME` and `PASSWORD` environment variables. This setup automatically maps your `EUFY_EMAIL` and `EUFY_PASSWORD` to these required variables.

**MQTT Note:** MQTT integration is completely optional. The WebSocket connection already provides real-time events for Scrypted. Only configure MQTT if you need to publish events to an MQTT broker (e.g., for Home Assistant integration alongside Scrypted).

### Available Services

- **eufy-security-ws**: Official WebSocket server (port 3000)

## 🛠️ Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Check service status
docker-compose ps
```

## 🧪 Testing with CLI

Once the server is running, test it with the eufy-security-cli:

```bash
# Check driver status
npx eufy-security-cli driver status --ws-host localhost:3000

# List devices
npx eufy-security-cli device list --ws-host localhost:3000

# Start streaming
npx eufy-security-cli device stream --ws-host localhost:3000 --camera-serial YOUR_CAMERA_SERIAL
```

## 🔍 Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify `EUFY_EMAIL` and `EUFY_PASSWORD` in `.env`
   - Check account credentials are correct
   - For 2FA-enabled accounts, check logs for verification code requests

2. **Port Already in Use**
   - Change `PORT` in `.env` file to use a different port
   - Check if another service is using the desired port

3. **Connection Refused**
   - Ensure `docker-compose up -d` succeeded
   - Check logs: `docker-compose logs eufy-security-ws`
   - Verify the service is running: `docker-compose ps`

4. **UDP Discovery Issues**
   - Ensure `network_mode: host` is set in docker-compose.yml for local device discovery
   - Check that your firewall allows UDP traffic for device discovery

### Health Check

```bash
# Check if service is healthy
curl http://localhost:3000/health
```

## 📚 Additional Resources

- [eufy-security-ws Docker Hub](https://hub.docker.com/r/bropat/eufy-security-ws)
- [eufy-security-ws GitHub](https://github.com/bropat/eufy-security-ws)
- [Eufy Security Client Documentation](https://github.com/bropat/eufy-security-client)
