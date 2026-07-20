---
name: eufy-stream-test
description: >-
  Test Eufy camera streams on the local network using this repo's
  eufy-security-cli against the eufy-security-ws container. Use when asked to
  list cameras, start/stop a camera stream, or verify that a camera's video
  encoding (codec, resolution, frames) is actually working end-to-end. Default
  WS host: ws://192.168.7.101:3000.
---

# Eufy Stream Test

Verify Eufy cameras stream correctly over the LAN using the repo's CLI
(`packages/eufy-security-cli`) talking to the running `eufy-security-ws`
container.

**Default WS host:** `ws://192.168.7.101:3000` (override with `--ws-host` when
the user gives a different one).

## What this validates

The CLI's `device stream` serves the **raw H.264/H.265 elementary stream** and
is **lazy** — the camera livestream only starts when a TCP client connects. So
"encoding works" is proven by connecting a client (ffprobe) that both triggers
the stream and reads back a real codec, resolution, and frames.

This exercises the **camera → eufy-security-ws → NAL** pipeline and the
negotiated codec. It does **not** exercise the Scrypted plugin's muxed fMP4 /
transcode path.

## Prerequisites

- `node` and `ffprobe`/`ffmpeg` on PATH (ffmpeg is at `/opt/homebrew/bin` here).
- CLI built. If `packages/eufy-security-cli/dist/main.js` is missing, the helper
  script builds it automatically, or run:
  `npm run build --workspace @caplaz/eufy-security-cli`
- The `eufy-security-ws` container reachable at the WS host.

All CLI commands take `--ws-host <ws://IP:PORT | IP:PORT>` (the `ws://` scheme is
optional). Run the CLI as `node packages/eufy-security-cli/dist/main.js …`.

## Workflow

Run from the repo root: `/Users/ace/Projects/HA/eufy-security-scrypted`.

### 1. Confirm the server is up

```bash
node packages/eufy-security-cli/dist/main.js driver status --ws-host ws://192.168.7.101:3000
```

Expect a connected/authenticated status. If it fails, the container is down or
the host/credentials are wrong — stop and report that; streaming can't work.

### 2. List cameras (get serials)

```bash
node packages/eufy-security-cli/dist/main.js device list --ws-host ws://192.168.7.101:3000
```

Output is grouped by device type with a `Serial: <serial>` line per device.
Extract candidate camera serials with:

```bash
node packages/eufy-security-cli/dist/main.js device list --ws-host ws://192.168.7.101:3000 \
  | grep 'Serial:' | awk '{print $2}'
```

`device list` connects, prints, and exits on its own — no cleanup needed.

### 3. Test a camera's stream + encoding (start → verify → stop)

Use the bundled helper — it starts the stream (default port 47989), connects
ffprobe to trigger and validate the encoding, and always stops the stream and
cleans up (even on Ctrl-C/error):

```bash
.claude/skills/eufy-stream-test/scripts/test-stream.sh \
  --ws-host ws://192.168.7.101:3000 \
  --camera-serial <SERIAL>
```

On success it prints the codec (`h264`/`hevc`), resolution, FPS, and the port,
and exits 0. On failure it prints the CLI log tail and exits 1.

Useful flags:
- `--port PORT` (default 47989) — local TCP port for the stream; change it if
  that port is busy.
- `--probe-timeout SECS` (default 45) — raise for slow battery/4G cameras that
  cold-start slowly.
- `--hold SECS` — after verifying, keep the stream up this long so a player can
  attach (see step 4).
- `--verbose` — pass `--verbose` to the CLI and show its log tail.

**Test all cameras:**

```bash
node packages/eufy-security-cli/dist/main.js device list --ws-host ws://192.168.7.101:3000 \
  | grep 'Serial:' | awk '{print $2}' | while read -r SERIAL; do
    echo "=== $SERIAL ==="
    .claude/skills/eufy-stream-test/scripts/test-stream.sh \
      --ws-host ws://192.168.7.101:3000 --camera-serial "$SERIAL" \
      || echo "FAILED: $SERIAL"
  done
```

### 4. Watch a stream manually (optional)

To eyeball a feed, hold the stream open and attach a player:

```bash
.claude/skills/eufy-stream-test/scripts/test-stream.sh \
  --ws-host ws://192.168.7.101:3000 --camera-serial <SERIAL> --hold 60
# then, in another terminal, while it holds:
ffplay tcp://127.0.0.1:<PORT>   # PORT is printed by the helper
```

Or run the CLI directly (serves until Ctrl-C) and connect a player yourself:

```bash
node packages/eufy-security-cli/dist/main.js device stream \
  --ws-host ws://192.168.7.101:3000 --camera-serial <SERIAL> --port 8090
# another terminal:
ffplay tcp://127.0.0.1:8090
```

Suggest the user type `! <command>` in the prompt for interactive players like
`ffplay`, so their output lands in this session.

## Manual one-shot validation (no helper script)

If you need to do it by hand — remember the stream is lazy, so a client must
connect. Start the stream in the background on a fixed port, then probe it:

```bash
node packages/eufy-security-cli/dist/main.js device stream \
  --ws-host ws://192.168.7.101:3000 --camera-serial <SERIAL> --port 8090 &
CLI_PID=$!
sleep 3   # let the TCP server open
ffprobe -v error -rw_timeout 45000000 -analyzeduration 20M -probesize 20M \
  -i tcp://127.0.0.1:8090 -select_streams v:0 \
  -show_entries stream=codec_name,width,height,avg_frame_rate \
  -read_intervals "%+#60" -of default=noprint_wrappers=1
kill -INT $CLI_PID   # graceful stop (runs the CLI's cleanup)
```

A raw HEVC stream that auto-detection misses needs `-f hevc` before `-i`.

## Interpreting results

- **`codec_name=h264` or `hevc` with a real `width`x`height`** → encoding works;
  the camera, ws server, and NAL parsing are all healthy.
- **"No decodable video within Ns"** → the client connected but no keyframe
  arrived. Causes: camera offline/asleep (raise `--probe-timeout`), wrong serial,
  a non-camera device (sensors don't stream), or an H.265 camera whose stream
  the ws server can't deliver. Re-run with `--verbose` and read the CLI log tail.
- **CLI exits before "stream ready"** → bad `--ws-host`, container down, or
  auth/2FA needed. Check `driver status` first.

## Notes

- `device list`, `device info`, and `driver status` self-terminate. `device
  stream` and `device monitor` run until SIGINT — the helper always sends it;
  if you run the CLI directly, stop it with Ctrl-C (or `kill -INT <pid>`).
- The stream flag is `--port` / `-p` (not `--tcp-port`; the CLI README is stale).
- The CLI maps `--port 0` to **8080** (not a random port), so always pass an
  explicit port. The bound port is echoed as `🌐 TCP Server: localhost:<port>`.

## Verified working

Tested against `ws://192.168.7.101:3000` — both cameras stream H.264:
`Front Door` (T8124) 1280x720@25 and `Backyard` (T8423) 2304x1296@25. The helper
starts, verifies, and tears down cleanly with no orphaned processes.
