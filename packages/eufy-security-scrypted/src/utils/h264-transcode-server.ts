/**
 * H.264 transcode relay server
 *
 * A Eufy HomeBase delivers H.265/HEVC from many cameras. HomeKit live view and
 * the Scrypted browser (WebRTC) only speak H.264, and Scrypted's consumers do
 * `-c:v copy` unless the user manually flips a per-camera "Transcoding Debug
 * Mode". To make H.264 work out of the box, the plugin emits real H.264 bytes
 * itself: this relay sits in front of the stream server's muxed fMP4 (H.265)
 * port and re-encodes to H.264 on demand.
 *
 * It listens on a local TCP port and, for EACH client that connects (Scrypted's
 * per-consumer ffmpeg / the Rebroadcast prebuffer), spawns a dedicated ffmpeg
 * that reads the muxed fMP4 source, re-encodes video to H.264 (libx264) while
 * copying audio, and pipes fragmented MP4 to that client socket.
 *
 * One ffmpeg per connection keeps the lifecycle trivial and gives every client
 * its own clean `moov` init segment — the muxed server already fans out raw
 * fMP4 to multiple readers, so a fresh per-client encode just attaches as
 * another reader. A client connecting here is also what wakes the livestream
 * (the spawned ffmpeg becomes a muxed-port reader), and its disconnect is what
 * lets the stream idle-stop — so the existing cold-start / coordinator
 * lifecycle is preserved unchanged.
 *
 * @module utils/h264-transcode-server
 */

import * as net from "net";
import { spawn as defaultSpawn } from "child_process";
import { Logger, ILogObj } from "tslog";

/** Minimal shape of a spawned child we rely on (injectable for tests). */
export interface SpawnedChild {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export type SpawnFn = (command: string, args: string[]) => SpawnedChild;

export interface H264TranscodeServerOptions {
  serialNumber: string;
  logger: Logger<ILogObj>;
  /**
   * Returns the muxed fMP4 (H.265) source port to read from, or undefined if
   * the stream server is not currently listening. Read fresh per connection so
   * a restarted stream server (new port) is picked up automatically.
   */
  getSourcePort: () => number | undefined;
  /** Path to the ffmpeg binary. Defaults to "ffmpeg" on PATH. */
  ffmpegPath?: string;
  /** Injectable spawn (tests). Defaults to child_process.spawn. */
  spawnFn?: SpawnFn;
}

/**
 * Build the ffmpeg argument list that re-encodes the muxed fMP4 (H.265) source
 * on `sourcePort` to fragmented-MP4 H.264 on stdout. Exported for testing.
 *
 * - libx264 ultrafast/zerolatency: portable software encode, low added latency.
 * - High@4.1, yuv420p: broadly compatible with HomeKit clients and browsers.
 * - audio copied through (AAC); the audio map is optional so mic-off cameras
 *   (video-only muxer) don't fail the encode.
 * - fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) so the
 *   downstream consumer can start mid-stream, same contract as the muxed port.
 */
export function buildTranscodeArgs(sourcePort: number): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts+nobuffer",
    "-analyzeduration",
    "2000000",
    "-probesize",
    "1000000",
    "-f",
    "mp4",
    "-i",
    `tcp://127.0.0.1:${sourcePort}`,
    // Video: re-encode H.265 -> H.264. Audio: pass AAC through if present.
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-g",
    "30",
    "-keyint_min",
    "15",
    "-sc_threshold",
    "0",
    "-b:v",
    "2000k",
    "-maxrate",
    "2500k",
    "-bufsize",
    "4000k",
    "-c:a",
    "copy",
    "-f",
    "mp4",
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ];
}

export class H264TranscodeServer {
  private server?: net.Server;
  private readonly children = new Set<SpawnedChild>();
  private readonly sockets = new Set<net.Socket>();
  private readonly ffmpegPath: string;
  private readonly spawnFn: SpawnFn;

  constructor(private readonly options: H264TranscodeServerOptions) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.spawnFn = options.spawnFn ?? (defaultSpawn as unknown as SpawnFn);
  }

  /** Start listening on a free localhost port. Idempotent. */
  async start(): Promise<void> {
    if (this.server) return;
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleClient(socket));
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        this.options.logger.info(
          `🎞️  H.264 transcode relay listening on port ${this.getPort()}`,
        );
        resolve();
      });
    });
  }

  /** The TCP port the relay is listening on, or undefined if not started. */
  getPort(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : undefined;
  }

  isRunning(): boolean {
    return !!this.server;
  }

  private handleClient(socket: net.Socket): void {
    const sourcePort = this.options.getSourcePort();
    if (!sourcePort) {
      // Nothing to transcode from yet — close so the consumer retries.
      this.options.logger.warn(
        "H.264 transcode: no muxed source port available, closing client",
      );
      socket.destroy();
      return;
    }

    this.sockets.add(socket);

    const args = buildTranscodeArgs(sourcePort);
    this.options.logger.info(
      `🎞️  H.264 transcode: encoding muxed port ${sourcePort} for a new client`,
    );

    let child: SpawnedChild;
    try {
      child = this.spawnFn(this.ffmpegPath, args);
    } catch (e) {
      this.options.logger.error(`H.264 transcode: failed to spawn ffmpeg: ${e}`);
      socket.destroy();
      return;
    }
    this.children.add(child);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.children.delete(child);
      this.sockets.delete(socket);
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      if (!socket.destroyed) socket.destroy();
    };

    // ffmpeg stdout -> client. Pipe (don't end-on-error) so cleanup controls teardown.
    child.stdout?.on("data", (chunk: Buffer) => {
      const ok = socket.write(chunk);
      if (!ok) {
        // Backpressure: nothing fancy — ffmpeg's stdout buffers briefly.
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) this.options.logger.debug(`H.264 transcode ffmpeg: ${msg}`);
    });

    child.on("exit", (code) => {
      this.options.logger.debug(`H.264 transcode ffmpeg exited (code ${code})`);
      cleanup();
    });
    child.on("error", (err) => {
      this.options.logger.error(`H.264 transcode ffmpeg error: ${err}`);
      cleanup();
    });

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  /** Stop the relay: close the listener and kill every active encode. */
  async stop(): Promise<void> {
    for (const child of this.children) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    this.children.clear();

    // Destroy live client sockets so server.close() can resolve immediately
    // (close() waits for existing connections to end on its own otherwise).
    for (const socket of this.sockets) {
      if (!socket.destroyed) socket.destroy();
    }
    this.sockets.clear();

    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
