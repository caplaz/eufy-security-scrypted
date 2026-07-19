import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import { Fmp4BoxStream, findVideoTrackId, moofFirstSampleIsSync } from "./fmp4-box-stream";
import {
  CompatibilityEncoderConsumerKind,
  CompatibilityEncoderLease,
  CompatibilityEncoderPool,
} from "./compatibility-encoder-pool";

const MAX_QUEUED_FRAGMENTS = 2;
const MAX_QUEUED_BYTES = 1024 * 1024;
const defaultCompatibilityEncoderPool = new CompatibilityEncoderPool();

type Child = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "kill"> &
  EventEmitter;

export interface H264CompatibilityRelayOptions {
  /** Camera serial number; cameraId is retained as a small compatibility alias. */
  serialNumber?: string;
  cameraId?: string;
  name?: string;
  getMuxedPort?: () => number | undefined;
  streamServer?: { getMuxedPort(): number | undefined };
  ffmpegPath?: string;
  pool?: CompatibilityEncoderPool;
  lingerMs?: number;
  classifyConsumer?: (socket: net.Socket) => CompatibilityEncoderConsumerKind;
  createChildProcess?: (
    command: string,
    args: readonly string[],
    options: Parameters<typeof spawn>[2],
  ) => Child;
  net?: Pick<typeof net, "createServer" | "createConnection">;
}

interface Consumer {
  socket: net.Socket;
  queue: Buffer[];
  queuedBytes: number;
  blocked: boolean;
  closed: boolean;
  kind: CompatibilityEncoderConsumerKind;
  protectionLease?: CompatibilityEncoderLease;
}

/**
 * One loopback TCP endpoint which converts the StreamServer's muxed fMP4
 * output once and fans its H.264/AAC fMP4 output to every downstream client.
 */
export class H264CompatibilityRelay extends EventEmitter {
  private readonly serialNumber: string;
  private readonly netApi: Pick<typeof net, "createServer" | "createConnection">;
  private readonly pool: CompatibilityEncoderPool;
  private readonly lingerMs: number;
  private readonly classifyConsumer: (socket: net.Socket) => CompatibilityEncoderConsumerKind;
  private readonly createChild: NonNullable<H264CompatibilityRelayOptions["createChildProcess"]>;
  private server?: net.Server;
  private source?: net.Socket;
  private child?: Child;
  private parser?: Fmp4BoxStream;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private teardownPromise?: Promise<void>;
  private baseLease?: CompatibilityEncoderLease;
  private consumers = new Map<net.Socket, Consumer>();
  private lingerTimer?: ReturnType<typeof setTimeout>;
  private init?: Buffer;
  private videoTrackId?: number;
  private latestSyncFragment?: Buffer;
  private generation = 0;
  private stopping = false;
  private disposed = false;

  public constructor(private readonly options: H264CompatibilityRelayOptions) {
    super();
    this.serialNumber = options.serialNumber ?? options.cameraId ?? "";
    this.netApi = options.net ?? net;
    this.pool = options.pool ?? defaultCompatibilityEncoderPool;
    this.lingerMs = options.lingerMs ?? 10_000;
    this.classifyConsumer = options.classifyConsumer ?? (() => "interactive");
    this.createChild = options.createChildProcess ?? ((command, args, spawnOptions) =>
      spawn(command, args, spawnOptions) as Child);
  }

  public getPort(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : undefined;
  }

  public get generationId(): number {
    return this.generation;
  }

  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error(`H264 compatibility relay for ${this.serialNumber} has been disposed`);
    }
    if (this.stopPromise) await this.stopPromise;
    if (this.disposed) {
      throw new Error(`H264 compatibility relay for ${this.serialNumber} has been disposed`);
    }
    if (this.startPromise) return this.startPromise;
    if (this.server && this.child && this.source && !this.stopping) return;
    const generation = ++this.generation;
    this.startPromise = this.startInternal(generation).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startInternal(generation: number): Promise<void> {
    if (!this.serialNumber) {
      throw new Error("Cannot start H264 compatibility relay: camera serial number is required");
    }
    if (!this.options.ffmpegPath) {
      throw new Error(
        `Cannot start H264 compatibility relay for ${this.serialNumber}: ffmpeg path is required`,
      );
    }
    const sourcePort = this.options.getMuxedPort?.() ?? this.options.streamServer?.getMuxedPort();
    if (!sourcePort) {
      throw new Error(
        `Cannot start H264 compatibility relay for ${this.serialNumber}: StreamServer muxed source is unavailable`,
      );
    }

    this.ensureCurrent(generation);
    this.clearLinger();
    this.resetCache();
    try {
      this.baseLease = this.pool.acquire({
        serialNumber: this.serialNumber,
        name: this.options.name,
        consumerKind: "prebuffer",
        onPreempt: () => this.handlePreempt(),
      });
      await this.listen(generation);
      this.ensureCurrent(generation);
      this.spawnChild(generation);
      await this.connectSource(sourcePort, generation);
      this.ensureCurrent(generation);
      this.emit("started", generation);
    } catch (error) {
      if (generation === this.generation && !this.stopping) await this.teardown();
      if (generation !== this.generation || this.stopping) {
        throw new Error(`H264 compatibility relay start was cancelled for ${this.serialNumber}`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot start H264 compatibility relay for ${this.serialNumber}: ${detail}`);
    }
  }

  public async stop(): Promise<void> {
    this.clearLinger();
    if (this.stopPromise) return this.stopPromise;
    if (!this.server && !this.source && !this.child && !this.baseLease) return;
    const starting = this.startPromise;
    this.generation += 1;
    this.stopping = true;
    this.stopPromise = (async () => {
      await this.teardown();
      await starting?.catch(() => undefined);
    })().finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  /** Permanently prevents this relay instance from being restarted. */
  public async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
  }

  private async listen(generation: number): Promise<void> {
    this.server = this.netApi.createServer((socket) => this.addConsumer(socket));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const cleanup = () => {
        server.off("error", onError);
        server.off("listening", onListening);
        server.off("close", onClose);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error("relay stopped while loopback listener was starting"));
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.once("close", onClose);
      server.listen(0, "127.0.0.1");
    });
    this.ensureCurrent(generation);
  }

  private spawnChild(generation: number): void {
    let child: Child;
    try {
      child = this.createChild(
        this.options.ffmpegPath!,
        [
          "-hide_banner", "-loglevel", "error",
          // A persistent fMP4 pipe does not get an EOF to flush the MOV
          // demuxer. Restrict probing/decoder reordering so complete moof
          // fragments are processed as they arrive instead of on close.
          "-threads", "1", "-blocksize", "4096", "-probesize", "4096", "-analyzeduration", "0",
          "-f", "mp4", "-i", "pipe:0",
          "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264",
          "-preset", "ultrafast", "-tune", "zerolatency", "-g", "30", "-keyint_min", "30",
          "-sc_threshold", "0", "-c:a", "aac",
          // Fragment each output frame and flush the AVIO layer: fMP4 output
          // then reaches relay consumers while the upstream remains connected.
          "-movflags", "frag_every_frame+empty_moov+default_base_moof", "-flush_packets", "1",
          "-f", "mp4", "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (error) {
      throw new Error(`failed to spawn ffmpeg: ${error instanceof Error ? error.message : error}`);
    }
    if (!child?.stdin || !child.stdout) throw new Error("ffmpeg did not provide stdio pipes");
    this.child = child;
    const parser = new Fmp4BoxStream();
    this.parser = parser;
    parser.on("init", (init: Buffer) => {
      if (this.isCurrent(generation) && this.parser === parser && this.child === child) {
        this.acceptInit(init);
      }
    });
    parser.on("fragment", (fragment: Buffer) => {
      if (this.isCurrent(generation) && this.parser === parser && this.child === child) {
        this.acceptFragment(fragment);
      }
    });
    parser.on("error", (error) => this.handleFailure(generation, "fMP4 output", error));
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.isCurrent(generation) && this.parser === parser && this.child === child) {
        parser.write(chunk);
      }
    });
    child.on("error", (error) => this.handleFailure(generation, "ffmpeg", error));
    child.on("exit", (code, signal) => {
      this.handleFailure(generation, "ffmpeg", new Error(`exited (${code ?? signal ?? "unknown"})`));
    });
    child.stdin.on("error", (error) => this.handleFailure(generation, "ffmpeg stdin", error));
    child.stdout.on("error", (error) => this.handleFailure(generation, "ffmpeg stdout", error));
    child.stderr.on("error", (error) => this.handleFailure(generation, "ffmpeg stderr", error));
    child.stderr.on("data", () => undefined);
  }

  private async connectSource(port: number, generation: number): Promise<void> {
    const source = this.netApi.createConnection({ port, host: "127.0.0.1" });
    this.source = source;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        source.off("error", onError);
        source.off("connect", onConnect);
        source.off("close", onClose);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new Error(`muxed source unavailable on port ${port}: ${error.message}`));
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error(`muxed source unavailable on port ${port}: disconnected`));
      };
      source.once("error", onError);
      source.once("connect", onConnect);
      source.once("close", onClose);
    });
    source.on("error", (error) => {
      if (this.source === source) this.handleFailure(generation, "muxed source", error);
    });
    source.on("close", () => {
      if (this.source === source) {
        this.handleFailure(generation, "muxed source", new Error("disconnected"));
      }
    });
    this.ensureCurrent(generation);
    try {
      source.pipe(this.child!.stdin);
    } catch (error) {
      this.handleFailure(generation, "muxed source pipe", error);
      throw error;
    }
  }

  private acceptInit(init: Buffer): void {
    const trackId = findVideoTrackId(init);
    this.init = init;
    this.videoTrackId = trackId;
    this.latestSyncFragment = undefined;
    for (const consumer of this.consumers.values()) this.send(consumer, init);
  }

  private acceptFragment(fragment: Buffer): void {
    if (!this.init || this.videoTrackId === undefined) return;
    if (moofFirstSampleIsSync(fragment, this.videoTrackId)) {
      this.latestSyncFragment = fragment;
    }
    this.broadcast(fragment);
  }

  private addConsumer(socket: net.Socket): void {
    if (this.stopping || this.disposed) {
      socket.destroy();
      return;
    }
    this.clearLinger();
    const kind = this.classifyConsumer(socket);
    const consumer: Consumer = { socket, kind, queue: [], queuedBytes: 0, blocked: false, closed: false };
    // An interactive attachment protects the otherwise-prebuffer relay from pool preemption.
    if (kind === "interactive" && this.baseLease) {
      try {
        consumer.protectionLease = this.pool.acquire({
          serialNumber: this.serialNumber,
          name: this.options.name,
          consumerKind: "interactive",
          onPreempt: () => this.handlePreempt(),
        });
      } catch (error) {
        socket.destroy(error instanceof Error ? error : undefined);
        return;
      }
    }
    this.consumers.set(socket, consumer);
    socket.on("drain", () => this.flush(consumer));
    socket.on("close", () => this.removeConsumer(consumer));
    socket.on("error", () => this.removeConsumer(consumer));
    if (this.init && this.latestSyncFragment) {
      this.send(consumer, Buffer.concat([this.init, this.latestSyncFragment]));
    }
  }

  private removeConsumer(consumer: Consumer): void {
    if (consumer.closed) return;
    consumer.closed = true;
    this.consumers.delete(consumer.socket);
    consumer.protectionLease?.release();
    if (this.consumers.size === 0 && !this.stopping) {
      this.lingerTimer = setTimeout(() => void this.stop(), this.lingerMs);
    }
  }

  private broadcast(fragment: Buffer): void {
    for (const consumer of this.consumers.values()) this.send(consumer, fragment);
  }

  private send(consumer: Consumer, fragment: Buffer): void {
    if (consumer.closed || consumer.socket.destroyed) return;
    if (consumer.blocked) {
      this.queue(consumer, fragment);
      return;
    }
    if (!consumer.socket.write(fragment)) consumer.blocked = true;
  }

  private queue(consumer: Consumer, fragment: Buffer): void {
    if (
      consumer.queue.length >= MAX_QUEUED_FRAGMENTS ||
      consumer.queuedBytes + fragment.length > MAX_QUEUED_BYTES
    ) {
      consumer.socket.destroy(new Error("H264 compatibility relay consumer overflow"));
      return;
    }
    consumer.queue.push(fragment);
    consumer.queuedBytes += fragment.length;
  }

  private flush(consumer: Consumer): void {
    consumer.blocked = false;
    while (!consumer.blocked && consumer.queue.length) {
      const fragment = consumer.queue.shift()!;
      consumer.queuedBytes -= fragment.length;
      if (!consumer.socket.write(fragment)) consumer.blocked = true;
    }
  }

  private handlePreempt(): void {
    if (this.stopping) return;
    this.emit("preempted", { serialNumber: this.serialNumber, reason: "encoder-pool-preempted" });
    for (const consumer of this.consumers.values()) {
      consumer.socket.destroy(new Error("H264 compatibility relay preempted by encoder pool"));
    }
    void this.stop();
  }

  private handleFailure(generation: number, component: string, error: unknown): void {
    if (!this.isCurrent(generation)) return;
    this.resetCache();
    const failure = new Error(
      `H264 compatibility relay ${component} failure: ${error instanceof Error ? error.message : error}`,
    );
    this.emit("failure", failure);
    if (this.listenerCount("error") > 0) this.emit("error", failure);
    void this.stop();
  }

  private resetCache(): void {
    this.init = undefined;
    this.videoTrackId = undefined;
    this.latestSyncFragment = undefined;
    this.parser?.reset();
  }

  private clearLinger(): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = undefined;
  }

  private async teardown(): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    this.teardownPromise = this.teardownInternal().finally(() => {
      this.teardownPromise = undefined;
    });
    return this.teardownPromise;
  }

  private async teardownInternal(): Promise<void> {
    this.stopping = true;
    this.clearLinger();
    const server = this.server;
    this.server = undefined;
    // Stop accepting before any asynchronous drain/child/source cleanup.
    const serverClosed = server
      ? new Promise<void>((resolve) => {
          try {
            server.close(() => resolve());
          } catch {
            resolve();
          }
        })
      : Promise.resolve();
    for (const consumer of [...this.consumers.values()]) {
      consumer.socket.destroy();
      this.removeConsumer(consumer);
    }
    const child = this.child;
    this.child = undefined;
    const parser = this.parser;
    this.parser = undefined;
    parser?.removeAllListeners();
    if (child) {
      child.stdout.removeAllListeners("data");
      child.stdin.removeAllListeners("error");
      child.stdout.removeAllListeners("error");
      child.stderr.removeAllListeners("error");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      // A delayed child-process error after teardown must not become an
      // unhandled EventEmitter error while the OS finishes reaping it.
      child.on("error", () => undefined);
      child.stdin.on("error", () => undefined);
      child.stdout.on("error", () => undefined);
      child.stderr.on("error", () => undefined);
      try { child.kill(); } catch { /* already exited */ }
    }
    const source = this.source;
    this.source = undefined;
    if (source) {
      (source as unknown as { unpipe?: (destination?: unknown) => void }).unpipe?.(child?.stdin);
      if (!source.destroyed) {
        await new Promise<void>((resolve) => {
          source.once("close", resolve);
          source.destroy();
        });
      }
      source.removeAllListeners("error");
      source.removeAllListeners("close");
      source.on("error", () => undefined);
    }
    await serverClosed;
    this.baseLease?.release();
    this.baseLease = undefined;
    this.resetCache();
    this.stopping = false;
    this.emit("stopped");
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.stopping;
  }

  private ensureCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new Error(`H264 compatibility relay start was cancelled for ${this.serialNumber}`);
    }
  }
}

const sharedRelays = new Map<string, H264CompatibilityRelay>();

/**
 * Returns the process-wide relay for a camera. This is the default entry
 * point for consumers so independently-created downstream sessions cannot
 * accidentally launch a second encoder for the same camera.
 */
export function getSharedH264CompatibilityRelay(
  options: H264CompatibilityRelayOptions,
): H264CompatibilityRelay {
  const serialNumber = options.serialNumber ?? options.cameraId;
  if (!serialNumber) {
    throw new Error("Cannot create shared H264 compatibility relay: camera serial number is required");
  }
  const existing = sharedRelays.get(serialNumber);
  if (existing) return existing;

  const relay = new H264CompatibilityRelay(options);
  sharedRelays.set(serialNumber, relay);
  return relay;
}

/** Removes the factory entry only when the camera is permanently discarded. */
export async function disposeSharedH264CompatibilityRelay(
  serialNumber: string,
): Promise<void> {
  const relay = sharedRelays.get(serialNumber);
  if (!relay) return;
  sharedRelays.delete(serialNumber);
  await relay.dispose();
}
