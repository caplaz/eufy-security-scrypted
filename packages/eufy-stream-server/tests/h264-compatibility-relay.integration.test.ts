import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { H264CompatibilityRelay } from "../src/h264-compatibility-relay";

const TEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

function hasRequiredFfmpeg(): boolean {
  try {
    const encoders = execFileSync("ffmpeg", ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return encoders.includes("libx264") && encoders.includes("libx265");
  } catch {
    return false;
  }
}

const canRun = hasRequiredFfmpeg();

async function runFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(output));
      } else {
        reject(
          new Error(
            `ffmpeg exited ${code}: ${Buffer.concat(errors).toString("utf8")}`,
          ),
        );
      }
    });
  });
}

async function createHevcFmp4Fixture(): Promise<Buffer> {
  return runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=5",
    "-t",
    "2",
    "-an",
    "-threads",
    "1",
    "-c:v",
    "libx265",
    "-preset",
    "ultrafast",
    "-x265-params",
    "keyint=5:min-keyint=5:scenecut=0:pools=1:frame-threads=1:log-level=error",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1",
  ]);
}

async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}

async function connect(port: number): Promise<net.Socket> {
  const socket = net.createConnection({ port, host: "127.0.0.1" });
  await once(socket, "connect");
  return socket;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor<T>(
  description: string,
  condition: () => T | undefined,
): Promise<T> {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = condition();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function hasFmp4InitAndFragment(data: Buffer): boolean {
  return (
    data.includes(Buffer.from("moov")) &&
    data.includes(Buffer.from("moof")) &&
    data.includes(Buffer.from("mdat"))
  );
}

function probeH264Fmp4(file: string): boolean {
  try {
    const result = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name:stream=codec_name",
        "-of",
        "default=noprint_wrappers=1",
        file,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return (
      result.includes("format_name=mov,mp4,m4a,3gp,3g2,mj2") &&
      result.includes("codec_name=h264")
    );
  } catch {
    return false;
  }
}

async function waitForDecodableH264Fmp4(
  file: string,
  received: Buffer[],
): Promise<Buffer> {
  return waitFor("decodable H.264 fMP4 output", () => {
    const output = Buffer.concat(received);
    if (!hasFmp4InitAndFragment(output)) return undefined;
    writeFileSync(file, output);
    return probeH264Fmp4(file) ? output : undefined;
  });
}

async function assertFfmpegDecodes(file: string): Promise<void> {
  await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    file,
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ]);
}

// This test is deliberately self-skipping for developer machines that have
// no FFmpeg or were built without either GPL encoder. CI installs and checks
// these requirements before invoking this test.
(canRun ? describe : describe.skip)(
  "H264CompatibilityRelay FFmpeg integration",
  () => {
    jest.setTimeout(TEST_TIMEOUT_MS + 5_000);

    it("transcodes HEVC fMP4 to decodable H.264 fMP4 and replays a keyframe to a late consumer", async () => {
      const fixture = await createHevcFmp4Fixture();
      expect(hasFmp4InitAndFragment(fixture)).toBe(true);

      let sourceSocket: net.Socket | undefined;
      let resolveSourceConnection: ((socket: net.Socket) => void) | undefined;
      const sourceConnection = new Promise<net.Socket>((resolve) => {
        resolveSourceConnection = resolve;
      });
      const sourceServer = net.createServer((socket) => {
        sourceSocket = socket;
        socket.on("error", () => undefined);
        resolveSourceConnection?.(socket);
      });
      const sourcePort = await listen(sourceServer);
      const outputDirectory = await mkdtemp(join(tmpdir(), "eufy-h264-relay-"));
      const firstOutputFile = join(outputDirectory, "first.mp4");
      const lateOutputFile = join(outputDirectory, "late.mp4");
      const relay = new H264CompatibilityRelay({
        serialNumber: "ffmpeg-integration-camera",
        getMuxedPort: () => sourcePort,
        ffmpegPath: "ffmpeg",
        lingerMs: TEST_TIMEOUT_MS,
      });
      const sockets: net.Socket[] = [];

      try {
        await relay.start();
        const upstream = await sourceConnection;
        const relayPort = relay.getPort();
        expect(relayPort).toBeDefined();

        const first = await connect(relayPort!);
        sockets.push(first);
        const firstReceived: Buffer[] = [];
        first.on("data", (chunk: Buffer) => firstReceived.push(chunk));

        upstream.write(fixture);
        const firstOutput = await waitForDecodableH264Fmp4(
          firstOutputFile,
          firstReceived,
        );
        await assertFfmpegDecodes(firstOutputFile);
        expect(firstOutput.length).toBeGreaterThan(0);

        const late = await connect(relayPort!);
        sockets.push(late);
        const lateReceived: Buffer[] = [];
        late.on("data", (chunk: Buffer) => lateReceived.push(chunk));

        const lateOutput = await waitForDecodableH264Fmp4(
          lateOutputFile,
          lateReceived,
        );
        await assertFfmpegDecodes(lateOutputFile);
        expect(lateOutput.length).toBeGreaterThan(0);
      } finally {
        for (const socket of sockets) socket.destroy();
        sourceSocket?.destroy();
        await relay.stop();
        await closeServer(sourceServer);
        await rm(outputDirectory, { recursive: true, force: true });
      }
    });
  },
);
