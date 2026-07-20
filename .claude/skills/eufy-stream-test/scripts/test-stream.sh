#!/usr/bin/env bash
#
# test-stream.sh — start a Eufy camera stream via the repo CLI, validate that
# the video encoding is actually flowing (codec/resolution/frames via ffprobe),
# then stop it cleanly.
#
# The CLI's `device stream` serves the RAW H.264/H.265 elementary stream and is
# LAZY: the camera livestream only starts once a TCP client connects. This
# script provides that client (ffprobe), which both triggers the stream and
# verifies the encoding. It validates the camera -> eufy-security-ws -> NAL
# pipeline and the negotiated codec; it does NOT exercise the Scrypted plugin's
# muxed fMP4 / transcode path.
#
# Usage:
#   test-stream.sh --ws-host HOST --camera-serial SERIAL [options]
#
# Options:
#   --ws-host, -w HOST          eufy-security-ws host (ws://IP:PORT or IP:PORT)   [required]
#   --camera-serial, -c SERIAL  Camera serial (from `device list`)                [required]
#   --port, -p PORT             Local TCP port for the stream (default: 47989).
#                               Change it if that port is busy. (The CLI maps
#                               --port 0 to 8080, so this script uses an explicit
#                               port instead.)
#   --probe-timeout SECS        Max wait for first video data (default: 45).
#                               Battery/4G cameras cold-start slowly; keep this
#                               generous.
#   --hold SECS                 After a successful probe, keep the stream server
#                               up this long so you can attach ffplay/vlc
#                               manually (default: 0 = stop immediately).
#   --verbose                   Pass --verbose to the CLI and show its log tail.
#   --help, -h                  Show this help.
#
# Exit codes: 0 = encoding verified, 1 = failure (no port / no video / bad codec).

set -u

# ---- resolve paths -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# skill lives at <repo>/.claude/skills/eufy-stream-test/scripts, so repo root is 5 up
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI_ENTRY="$REPO_ROOT/packages/eufy-security-cli/dist/main.js"

WS_HOST=""
CAMERA_SERIAL=""
PORT=47989
PROBE_TIMEOUT=45
HOLD=0
VERBOSE=""

die() { echo "❌ $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ws-host|-w)         WS_HOST="${2:-}"; shift 2 ;;
    --camera-serial|-c)   CAMERA_SERIAL="${2:-}"; shift 2 ;;
    --port|-p)            PORT="${2:-}"; shift 2 ;;
    --probe-timeout)      PROBE_TIMEOUT="${2:-}"; shift 2 ;;
    --hold)               HOLD="${2:-}"; shift 2 ;;
    --verbose)            VERBOSE="--verbose"; shift ;;
    --help|-h)            sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown argument: $1 (use --help)" ;;
  esac
done

[ -n "$WS_HOST" ]       || die "Missing --ws-host (e.g. ws://192.168.7.101:3000)"
[ -n "$CAMERA_SERIAL" ] || die "Missing --camera-serial (run: device list)"
command -v ffprobe >/dev/null 2>&1 || die "ffprobe not found (install ffmpeg)"
command -v node >/dev/null 2>&1    || die "node not found"

# ---- build CLI if needed -----------------------------------------------------
if [ ! -f "$CLI_ENTRY" ]; then
  echo "ℹ️  CLI not built; building @caplaz/eufy-security-cli ..."
  ( cd "$REPO_ROOT" && npm run build --workspace @caplaz/eufy-security-cli ) \
    || die "CLI build failed"
  [ -f "$CLI_ENTRY" ] || die "CLI build did not produce $CLI_ENTRY"
fi

# ---- launch the stream (lazy: starts on client connect) ----------------------
STREAM_LOG="$(mktemp -t eufy-stream.XXXXXX)"
STREAM_PID=""

cleanup() {
  if [ -n "$STREAM_PID" ] && kill -0 "$STREAM_PID" 2>/dev/null; then
    kill -INT "$STREAM_PID" 2>/dev/null   # graceful: triggers CLI cleanup()
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$STREAM_PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$STREAM_PID" 2>/dev/null || true
  fi
  rm -f "$STREAM_LOG" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "🎥 Starting stream: camera=$CAMERA_SERIAL via $WS_HOST (tcp port $PORT)"
node "$CLI_ENTRY" device stream \
  --ws-host "$WS_HOST" \
  --camera-serial "$CAMERA_SERIAL" \
  --port "$PORT" $VERBOSE >"$STREAM_LOG" 2>&1 &
STREAM_PID=$!

# ---- wait for the TCP server to be ready (bound on our port) -----------------
READY=""
for _ in $(seq 1 40); do   # up to ~20s to open the TCP server
  if ! kill -0 "$STREAM_PID" 2>/dev/null; then
    echo "❌ CLI exited before the stream was ready (port $PORT in use? bad serial?). Log:" >&2
    tail -n 30 "$STREAM_LOG" >&2
    exit 1
  fi
  # Either the connection banner or the "TCP server started on port N" log line
  # confirms the socket is bound and accepting.
  if grep -qE "localhost:$PORT|TCP server started on port $PORT" "$STREAM_LOG" 2>/dev/null; then
    READY=1; break
  fi
  sleep 0.5
done
[ -n "$READY" ] || { echo "❌ Timed out waiting for the TCP server. Log:" >&2; tail -n 30 "$STREAM_LOG" >&2; exit 1; }
echo "🌐 Stream server on tcp://127.0.0.1:$PORT — connecting ffprobe (triggers camera)…"

# ---- probe the raw stream ----------------------------------------------------
# Connecting is what starts the camera livestream; a cold battery/4G camera may
# take tens of seconds to deliver the first keyframe, hence -rw_timeout.
RW_TIMEOUT_US=$(( PROBE_TIMEOUT * 1000000 ))

probe() { # echoes "codec|width|height|fps"
  # Auto-detect ONLY. Forcing "-f h264"/"-f hevc" makes ffprobe report that
  # codec even on the wrong data (a false positive, betrayed by 0x0 size), so
  # we never force — ffmpeg's raw-ES probe reliably tells H.264 from HEVC.
  ffprobe -v error \
    -rw_timeout "$RW_TIMEOUT_US" \
    -analyzeduration 20M -probesize 20M \
    -i "tcp://127.0.0.1:$PORT" \
    -select_streams v:0 \
    -show_entries stream=codec_name,width,height,avg_frame_rate \
    -read_intervals "%+#60" \
    -of default=noprint_wrappers=1:nokey=1 2>/dev/null \
    | paste -sd'|' -
}

# A PASS requires a known codec AND real dimensions (proof of a decoded SPS,
# not just a demuxer guess). Retry once: ffprobe can connect before the stream
# server has sent cached parameter sets; the second attempt hits a warm stream.
CODEC=""; WIDTH=""; HEIGHT=""; FPS=""
for attempt in 1 2; do
  RESULT="$(probe)"
  CODEC="$(echo "$RESULT"  | cut -d'|' -f1)"
  WIDTH="$(echo "$RESULT"  | cut -d'|' -f2 | grep -oE '^[0-9]+' || true)"
  HEIGHT="$(echo "$RESULT" | cut -d'|' -f3 | grep -oE '^[0-9]+' || true)"
  FPS="$(echo "$RESULT"    | cut -d'|' -f4)"
  if { [ "$CODEC" = "h264" ] || [ "$CODEC" = "hevc" ]; } \
     && [ "${WIDTH:-0}" -gt 0 ] 2>/dev/null && [ "${HEIGHT:-0}" -gt 0 ] 2>/dev/null; then
    break
  fi
  CODEC=""  # not a valid detection; retry
  sleep 2
done

if [ -z "$CODEC" ]; then
  echo "❌ No decodable video with valid dimensions within ${PROBE_TIMEOUT}s." >&2
  echo "   (camera offline/asleep, wrong serial, or a non-camera device?)" >&2
  echo "   CLI log tail:" >&2
  tail -n 30 "$STREAM_LOG" >&2
  exit 1
fi

echo ""
echo "============================================================"
echo "✅ ENCODING VERIFIED"
echo "   Camera : $CAMERA_SERIAL"
echo "   Codec  : $CODEC"
echo "   Size   : ${WIDTH}x${HEIGHT}"
echo "   FPS    : ${FPS:-unknown}"
echo "   Port   : tcp://127.0.0.1:$PORT"
echo "============================================================"

# ---- optional hold for manual viewing ---------------------------------------
if [ "${HOLD:-0}" -gt 0 ] 2>/dev/null; then
  echo ""
  echo "⏸️  Holding stream ${HOLD}s — attach a player now:"
  echo "     ffplay tcp://127.0.0.1:$PORT"
  echo "     vlc    tcp://127.0.0.1:$PORT"
  sleep "$HOLD"
fi

echo "🛑 Stopping stream…"
exit 0
