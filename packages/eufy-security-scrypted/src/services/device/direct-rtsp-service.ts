import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createServer, Server, Socket } from "net";
import { ILogObj, Logger } from "tslog";

interface RtspApi {
  isRtspLivestreaming(): Promise<{ livestreaming: boolean }>;
  startRtspLivestream(): Promise<unknown>;
  stopRtspLivestream(): Promise<unknown>;
}

interface DirectRtspServiceOptions {
  api: () => RtspApi;
  requiresActivation: () => boolean;
  ffmpegPath: () => Promise<string>;
  logger: Logger<ILogObj>;
}

const CONSUMER_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 15_000;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

/**
 * Owns explicit NAS activation, shared by live consumers and snapshot captures.
 * A direct RTSP URL has no consumer-release callback in Scrypted. Activated
 * streams therefore use a single-client TCP endpoint with FFmpeg copying the
 * camera's video/audio into MPEG-TS. Socket closure releases the activation;
 * an unused descriptor expires instead of leaving the camera awake forever.
 */
export class DirectRtspService {
  private consumers = new Set<() => void>();
  private lifecycle: Promise<void> = Promise.resolve();
  private active = false;
  private owned = false;
  private disposed = false;

  constructor(private options: DirectRtspServiceOptions) {}

  /** Serialize status/start/stop, including a new request during a pending stop. */
  private synchronize(): Promise<void> {
    const operation = this.lifecycle.then(async () => {
      if (this.consumers.size && !this.disposed) {
        if (this.active || !this.options.requiresActivation()) return;
        const api = this.options.api();
        const { livestreaming } = await api.isRtspLivestreaming();
        if (!this.consumers.size || this.disposed) return;
        if (livestreaming) {
          this.active = true;
          return;
        }
        await api.startRtspLivestream();
        this.active = true;
        this.owned = true;
      } else if (this.active || this.owned) {
        // If stop fails its result is unknown. Retain ownership for cleanup,
        // but force the next consumer to check whether activation is needed.
        this.active = false;
        if (this.owned) await this.options.api().stopRtspLivestream();
        this.owned = false;
      }
    });
    // A failed command must not poison subsequent requests or cleanup.
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }

  private acquire(onDispose: () => void) {
    if (this.disposed) throw new Error("Direct RTSP service is disposed");
    this.consumers.add(onDispose);
    return {
      ready: this.synchronize(),
      release: () => {
        if (!this.consumers.delete(onDispose)) return;
        void this.synchronize().catch(() => {
          this.options.logger.warn("Failed to stop owned RTSP livestream");
        });
      },
    };
  }

  private inputArguments(url: string): string[] {
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-rtsp_transport",
      "tcp",
      "-timeout",
      String(CAPTURE_TIMEOUT_MS * 1000),
      "-i",
      url,
    ];
  }

  async createVideoStream(rtspUrl: string): Promise<{
    url: string;
    inputArguments: string[];
    close: () => void;
  }> {
    let server: Server | undefined;
    let socket: Socket | undefined;
    let ffmpeg: ChildProcessWithoutNullStreams | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    let closed = false;
    let rejectClosed!: (error: Error) => void;
    const whenClosed = new Promise<never>((_, reject) => {
      rejectClosed = reject;
    });
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      server?.close(() => undefined);
      socket?.destroy();
      ffmpeg?.kill("SIGKILL");
      lease.release();
      rejectClosed(new Error("RTSP consumer closed before stream was ready"));
    };
    const lease = this.acquire(close);
    const resetTimeout = () => {
      if (closed) return;
      clearTimeout(timeout);
      timeout = setTimeout(close, CONSUMER_TIMEOUT_MS);
      timeout.unref?.();
    };
    resetTimeout();

    const prepare = async () => {
      await lease.ready;
      if (closed) throw new Error("RTSP consumer closed during activation");
      const ffmpegPath = await this.options.ffmpegPath();
      if (closed) throw new Error("RTSP consumer closed during preparation");
      server = createServer((client) => {
        if (closed || socket) {
          client.destroy();
          return;
        }
        socket = client;
        resetTimeout();
        server!.close(() => undefined);
        client.once("close", close);
        client.once("error", close);
        client.resume();
        try {
          ffmpeg = spawn(ffmpegPath, [
            ...this.inputArguments(rtspUrl),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c",
            "copy",
            // AAC-over-RTP packets may lack the keyframe flag. Without this,
            // FFmpeg can discard every audio packet while copying the stream.
            "-copyinkf:a",
            "-f",
            "mpegts",
            "-muxdelay",
            "0",
            "-flush_packets",
            "1",
            "pipe:1",
          ]);
          ffmpeg.stdin.end();
          ffmpeg.once("error", close);
          ffmpeg.once("close", close);
          ffmpeg.stdout.once("error", close);
          ffmpeg.stdout.on("data", resetTimeout);
          // FFmpeg diagnostics can contain authenticated camera URLs.
          ffmpeg.stderr.resume();
          ffmpeg.stdout.pipe(client);
        } catch {
          close();
        }
      });
      server.on("error", close);
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", () => {
          server!.removeListener("error", reject);
          resolve();
        });
      });
      if (closed) throw new Error("RTSP consumer closed while binding");
      server.unref();
      const port = (server.address() as { port: number }).port;
      const url = `tcp://127.0.0.1:${port}`;
      return {
        url,
        inputArguments: ["-f", "mpegts", "-i", url],
        close,
      };
    };

    try {
      return await Promise.race([prepare(), whenClosed]);
    } catch (error) {
      close();
      throw error;
    }
  }

  /** Capture a real JPEG inside the caller's fallback boundary. */
  async captureSnapshot(
    rtspUrl: string,
    requestedTimeoutMs?: number,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      let ffmpeg: ChildProcessWithoutNullStreams | undefined;
      let finished = false;
      let size = 0;
      const chunks: Buffer[] = [];
      const finish = (error?: Error, jpeg?: Buffer) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        ffmpeg?.kill("SIGKILL");
        lease.release();
        if (error) reject(error);
        else resolve(jpeg!);
      };
      const lease = this.acquire(() =>
        finish(new Error("RTSP service disposed")),
      );
      const timeoutMs = Number.isFinite(requestedTimeoutMs)
        ? Math.max(1, Math.min(requestedTimeoutMs!, CAPTURE_TIMEOUT_MS))
        : CAPTURE_TIMEOUT_MS;
      const timeout = setTimeout(
        () => finish(new Error("RTSP snapshot timed out")),
        timeoutMs,
      );

      const capture = async () => {
        await lease.ready;
        if (finished) return;
        const ffmpegPath = await this.options.ffmpegPath();
        if (finished) return;
        ffmpeg = spawn(ffmpegPath, [
          ...this.inputArguments(rtspUrl),
          "-an",
          "-frames:v",
          "1",
          "-c:v",
          "mjpeg",
          "-f",
          "image2pipe",
          "pipe:1",
        ]);
        ffmpeg.stdin.end();
        ffmpeg.once("error", () =>
          finish(new Error("RTSP snapshot FFmpeg failed")),
        );
        ffmpeg.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_SNAPSHOT_BYTES) {
            finish(new Error("RTSP snapshot exceeds size limit"));
          } else if (!finished) {
            chunks.push(chunk);
          }
        });
        ffmpeg.stdout.once("error", () =>
          finish(new Error("RTSP snapshot pipe failed")),
        );
        ffmpeg.stderr.resume();
        ffmpeg.once("close", (code) => {
          const jpeg = Buffer.concat(chunks);
          if (
            code !== 0 ||
            jpeg.length < 4 ||
            jpeg.readUInt16BE(0) !== 0xffd8 ||
            jpeg.readUInt16BE(jpeg.length - 2) !== 0xffd9
          ) {
            finish(new Error("RTSP snapshot capture failed"));
          } else {
            finish(undefined, jpeg);
          }
        });
      };
      void capture().catch((error: Error) => finish(error));
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const close of [...this.consumers]) close();
    await this.synchronize();
  }
}
