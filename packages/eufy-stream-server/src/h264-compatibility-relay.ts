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
  private baseLease?: CompatibilityEncoderLease;
  private consumers = new Map<net.Socket, Consumer>();
  private lingerTimer?: ReturnType<typeof setTimeout>;
  private init?: Buffer;
  private videoTrackId?: number;
  private latestSyncFragment?: Buffer;
  private generation = 0;
  private stopping = false;

  public constructor(private readonly options: H264CompatibilityRelayOptions) {
    super();
    this.serialNumber = options.serialNumber ?? options.cameraId ?? "";
    this.netApi = options.net ?? net;
    this.pool = options.pool ?? new CompatibilityEncoderPool();
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
    if (this.startPromise) return this.startPromise;
    if (this.server && this.child && this.source && !this.stopping) return;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
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

    this.stopping = false;
    this.clearLinger();
    this.resetCache();
    this.generation += 1;
    try {
      this.baseLease = this.pool.acquire({
        serialNumber: this.serialNumber,
        name: this.options.name,
        consumerKind: "prebuffer",
        onPreempt: () => this.handlePreempt(),
      });
      await this.listen();
      this.spawnChild();
      await this.connectSource(sourcePort);
      this.emit("started", this.generation);
    } catch (error) {
      await this.teardown();
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot start H264 compatibility relay for ${this.serialNumber}: ${detail}`);
    }
  }

  public async stop(): Promise<void> {
    this.clearLinger();
    if (this.stopPromise) return this.stopPromise;
    if (!this.server && !this.source && !this.child && !this.baseLease) return;
    this.stopPromise = this.teardown().finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  private async listen(): Promise<void> {
    this.server = this.netApi.createServer((socket) => this.addConsumer(socket));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
  }

  private spawnChild(): void {
    let child: Child;
    try {
      child = this.createChild(
        this.options.ffmpegPath!,
        [
          "-hide_banner", "-loglevel", "error", "-f", "mp4", "-i", "pipe:0",
          "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-c:a", "aac",
          "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (error) {
      throw new Error(`failed to spawn ffmpeg: ${error instanceof Error ? error.message : error}`);
    }
    if (!child?.stdin || !child.stdout) throw new Error("ffmpeg did not provide stdio pipes");
    this.child = child;
    this.parser = new Fmp4BoxStream();
    this.parser.on("init", (init: Buffer) => this.acceptInit(init));
    this.parser.on("fragment", (fragment: Buffer) => this.acceptFragment(fragment));
    this.parser.on("error", (error) => this.handleFailure("fMP4 output", error));
    child.stdout.on("data", (chunk: Buffer) => this.parser?.write(chunk));
    child.on("error", (error) => this.handleFailure("ffmpeg", error));
    child.on("exit", (code, signal) => {
      if (!this.stopping) this.handleFailure("ffmpeg", new Error(`exited (${code ?? signal ?? "unknown"})`));
    });
    child.stderr.on("data", () => undefined);
  }

  private async connectSource(port: number): Promise<void> {
    const source = this.netApi.createConnection({ port, host: "127.0.0.1" });
    this.source = source;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        source.off("connect", onConnect);
        reject(new Error(`muxed source unavailable on port ${port}: ${error.message}`));
      };
      const onConnect = () => {
        source.off("error", onError);
        resolve();
      };
      source.once("error", onError);
      source.once("connect", onConnect);
    });
    source.on("error", (error) => {
      if (this.source === source) this.handleFailure("muxed source", error);
    });
    source.on("close", () => {
      if (this.source === source && !this.stopping) {
        this.handleFailure("muxed source", new Error("disconnected"));
      }
    });
    source.pipe(this.child!.stdin);
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

  private handleFailure(component: string, error: unknown): void {
    if (this.stopping) return;
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
    this.stopping = true;
    this.clearLinger();
    for (const consumer of [...this.consumers.values()]) {
      consumer.socket.destroy();
      this.removeConsumer(consumer);
    }
    try { this.child?.kill(); } catch { /* already exited */ }
    this.child = undefined;
    this.parser = undefined;
    const source = this.source;
    this.source = undefined;
    if (source) source.destroy();
    if (this.server) {
      const server = this.server;
      this.server = undefined;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.baseLease?.release();
    this.baseLease = undefined;
    this.resetCache();
    this.stopping = false;
    this.emit("stopped");
  }
}
