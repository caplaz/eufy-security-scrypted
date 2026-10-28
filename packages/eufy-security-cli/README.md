# @caplaz/eufy-security-cli

A private workspace CLI for inspecting Eufy devices, authenticating the driver, and serving camera video over TCP. It connects to a running `eufy-security-ws` server; it does not connect directly to Eufy devices.

## Build and run

From the repository root, install dependencies and build the workspaces:

```bash
npm install
npm run build
node packages/eufy-security-cli/dist/main.js --help
```

The CLI package declares Node.js >=18.0.0. It is marked `private` and is not published to npm, so run the built entry point from this checkout. For a local WebSocket server, see the [Docker setup](../../docker/README.md).

All examples below run from the repository root. Replace the server address and camera serial with your own values.

```bash
node packages/eufy-security-cli/dist/main.js driver status --ws-host localhost:3000
node packages/eufy-security-cli/dist/main.js driver connect --ws-host localhost:3000
node packages/eufy-security-cli/dist/main.js device list --ws-host localhost:3000
node packages/eufy-security-cli/dist/main.js device info --ws-host localhost:3000 --camera-serial T8210N2012345678
```

## Commands and options

| Command                              | Purpose                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| `driver status`                      | Inspect WebSocket connection and driver authentication status         |
| `driver connect`                     | Connect the driver if it is not already authenticated                 |
| `driver set_captcha <id> <code>`     | Submit the CAPTCHA ID and answer requested by the server              |
| `driver set_verify_code <id> <code>` | Submit the challenge ID and verification code requested by the server |
| `device list`                        | List devices returned by the server                                   |
| `device info`                        | Show a device and its properties                                      |
| `device stream`                      | Serve a camera's raw video over TCP                                   |
| `device monitor`                     | Keep a monitoring session open for a selected device                  |

| Option                     | Short form | Use                                                                                               |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `--ws-host <host>`         | `-w`       | Required except for help; accepts `hostname:port`, `ws://hostname:port`, or `wss://hostname:port` |
| `--camera-serial <serial>` | `-c`       | Required for `device info`, `device stream`, and `device monitor`; 10–20 uppercase letters/digits |
| `--port <port>`            | `-p`       | TCP listening port for `device stream`                                                            |
| `--verbose`                | `-v`       | Detailed logging                                                                                  |
| `--help`                   | `-h`       | Print usage without connecting                                                                    |

The current implementation uses TCP port **8080** when `--port` is omitted or is `0`. The help text's claim that the default is a random port is outdated. Specify a nonzero port to choose another listening port.

For authentication challenges, use the ID shown by the server/CLI:

```bash
node packages/eufy-security-cli/dist/main.js driver set_captcha CHALLENGE_ID ANSWER --ws-host localhost:3000
node packages/eufy-security-cli/dist/main.js driver set_verify_code CHALLENGE_ID 123456 --ws-host localhost:3000
```

## View or record video

Start the TCP server in one terminal:

```bash
node packages/eufy-security-cli/dist/main.js device stream \
  --ws-host localhost:3000 \
  --camera-serial T8210N2012345678 \
  --port 8080
```

Connect a player in another terminal. The camera starts streaming when a TCP consumer connects; a battery camera may need time to wake.

```bash
ffplay tcp://localhost:8080
# Or record 60 seconds:
ffmpeg -i tcp://localhost:8080 -c:v copy -an -t 60 recording.mp4
```

The raw TCP endpoint carries the camera's native H.264 or H.265 video, without audio. It does not transcode to H.264, even though the CLI's status text currently labels the output that way. Use a player/FFmpeg build that supports the camera's codec. Press Ctrl+C in the CLI terminal to stop the server and disconnect.

## Troubleshooting

- If the WebSocket connection fails, verify the address, container status, published port, and firewall. Add `--verbose` and inspect `docker compose logs -f eufy-security-ws` from the repository's `docker` directory.
- If devices are missing, check the server's Eufy authentication state with `driver status`, then use `driver connect` and complete any requested challenge.
- If port 8080 is occupied, select another nonzero `--port` and use that same port in the player URL.
- If the player connects without video, verify the serial with `device list`, check that the device supports livestreaming, and inspect server logs. Avoid starting competing streams for cameras on the same HomeBase.

## Related packages

- [WebSocket client](../eufy-security-client/README.md)
- [TCP stream server](../eufy-stream-server/README.md)
- [Scrypted plugin](../eufy-security-scrypted/README.md)

[MIT license](../../LICENSE)
