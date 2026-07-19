import { H264CompatibilityRelay } from "../src/h264-compatibility-relay";
import { H264CompatibilityRelay as ExportedRelay } from "../src";
import { CompatibilityEncoderPool } from "../src/compatibility-encoder-pool";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import { PassThrough } from "node:stream";

function box(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const result = Buffer.alloc(8 + data.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  data.copy(result, 8);
  return result;
}

function initSegment(): Buffer {
  const tkhd = Buffer.alloc(20);
  tkhd.writeUInt32BE(1, 12);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, 4, "ascii");
  return Buffer.concat([
    box("ftyp"),
    box("moov", box("trak", Buffer.concat([box("tkhd", tkhd), box("mdia", box("hdlr", hdlr))]))),
  ]);
}

function fragment(trackId: number, sync: boolean): Buffer {
  const tfhd = Buffer.alloc(8);
  tfhd.writeUInt32BE(trackId, 4);
  const trun = Buffer.alloc(12);
  trun.writeUInt32BE(0x000004, 0);
  trun.writeUInt32BE(1, 4);
  trun.writeUInt32BE(sync ? 0 : 0x00010000, 8);
  return Buffer.concat([box("moof", box("traf", Buffer.concat([box("tfhd", tfhd), box("trun", trun)]))), box("mdat", Buffer.from([trackId]))]);
}

class FakeChild extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly kill = jest.fn();
}

async function sourceServer(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as net.AddressInfo).port };
}

async function readLength(socket: net.Socket, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= length) {
        socket.off("data", onData);
        resolve(Buffer.concat(chunks));
      }
    };
    socket.on("data", onData);
  });
}

describe("H264CompatibilityRelay", () => {
  it("is exported by the package entry point", () => {
    expect(ExportedRelay).toBe(H264CompatibilityRelay);
  });

  it("fails with an actionable error when no ffmpeg path is configured", async () => {
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1",
      getMuxedPort: () => 12345,
    });

    await expect(relay.start()).rejects.toThrow("ffmpeg path");
  });

  it("shares one encoder and replays init plus the latest video sync fragment to late clients", async () => {
    const source = await sourceServer();
    const child = new FakeChild();
    const spawn = jest.fn(() => child);
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1",
      getMuxedPort: () => source.port,
      ffmpegPath: "/fake/ffmpeg",
      createChildProcess: spawn,
    });
    await relay.start();
    const port = relay.getPort();
    const first = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => first.once("connect", resolve));

    const expected = Buffer.concat([initSegment(), fragment(1, true)]);
    const firstRead = readLength(first, expected.length);
    child.stdout.write(Buffer.concat([initSegment(), fragment(2, true), fragment(1, true)]));
    expect((await firstRead).subarray(0, expected.length)).toEqual(expected);

    const late = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => late.once("connect", resolve));
    expect((await readLength(late, expected.length)).subarray(0, expected.length)).toEqual(expected);
    expect(spawn).toHaveBeenCalledTimes(1);

    first.destroy();
    late.destroy();
    await relay.stop();
    await new Promise<void>((resolve) => source.server.close(() => resolve()));
  });

  it("keeps its encoder warm through linger and releases it only after expiry", async () => {
    const source = await sourceServer();
    const child = new FakeChild();
    const pool = new CompatibilityEncoderPool({ capacity: 1 });
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1", getMuxedPort: () => source.port, ffmpegPath: "/fake/ffmpeg",
      createChildProcess: () => child, pool, lingerMs: 20,
    });
    await relay.start();
    const socket = net.createConnection({ port: relay.getPort(), host: "127.0.0.1" });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(pool.diagnostics).toHaveLength(1);
    const reconnect = net.createConnection({ port: relay.getPort(), host: "127.0.0.1" });
    await new Promise<void>((resolve) => reconnect.once("connect", resolve));
    expect(child.kill).not.toHaveBeenCalled();
    reconnect.destroy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(pool.diagnostics).toHaveLength(0);
    await new Promise<void>((resolve) => source.server.close(() => resolve()));
  });

  it("stops consumers with a pool-preemption reason", async () => {
    const source = await sourceServer();
    const child = new FakeChild();
    const pool = new CompatibilityEncoderPool({ capacity: 1 });
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1", getMuxedPort: () => source.port, ffmpegPath: "/fake/ffmpeg",
      createChildProcess: () => child, pool,
    });
    await relay.start();
    const events: unknown[] = [];
    relay.on("preempted", (event) => events.push(event));
    pool.acquire({ serialNumber: "camera-2", consumerKind: "interactive" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([{ serialNumber: "camera-1", reason: "encoder-pool-preempted" }]);
    expect(child.kill).toHaveBeenCalled();
    await new Promise<void>((resolve) => source.server.close(() => resolve()));
  });

  it("isolates a slow client after two queued fragments while healthy clients continue", () => {
    const relay = new H264CompatibilityRelay({ serialNumber: "camera-1" });
    const slow = Object.assign(new EventEmitter(), {
      destroyed: false, write: jest.fn(() => false), destroy: jest.fn(),
    }) as unknown as net.Socket;
    const healthy = Object.assign(new EventEmitter(), {
      destroyed: false, write: jest.fn(() => true), destroy: jest.fn(),
    }) as unknown as net.Socket;
    const consumer = (socket: net.Socket) => ({ socket, queue: [], queuedBytes: 0, blocked: false, closed: false, kind: "prebuffer" as const });
    (relay as any).consumers.set(slow, consumer(slow));
    (relay as any).consumers.set(healthy, consumer(healthy));
    (relay as any).broadcast(Buffer.from("one"));
    (relay as any).broadcast(Buffer.from("two"));
    (relay as any).broadcast(Buffer.from("three"));
    (relay as any).broadcast(Buffer.from("four"));
    expect(slow.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("overflow") }));
    expect(healthy.write).toHaveBeenCalledTimes(4);
  });

  it("reports an unavailable muxed source before launching ffmpeg", async () => {
    const spawn = jest.fn();
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1", getMuxedPort: () => undefined, ffmpegPath: "/fake/ffmpeg", createChildProcess: spawn,
    });
    await expect(relay.start()).rejects.toThrow("muxed source is unavailable");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("serializes start calls and makes stop idempotent", async () => {
    const source = await sourceServer();
    const child = new FakeChild();
    const spawn = jest.fn(() => child);
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1", getMuxedPort: () => source.port, ffmpegPath: "/fake/ffmpeg", createChildProcess: spawn,
    });
    await Promise.all([relay.start(), relay.start()]);
    expect(spawn).toHaveBeenCalledTimes(1);
    await Promise.all([relay.stop(), relay.stop()]);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(relay.getPort()).toBeUndefined();
    await new Promise<void>((resolve) => source.server.close(() => resolve()));
  });

  it("invalidates a generation's cache when its muxed source disconnects", async () => {
    let upstream: net.Socket | undefined;
    let sourceConnected!: () => void;
    const upstreamReady = new Promise<void>((resolve) => { sourceConnected = resolve; });
    const source = net.createServer((socket) => { upstream = socket; sourceConnected(); });
    await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
    const port = (source.address() as net.AddressInfo).port;
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    const spawn = jest.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const relay = new H264CompatibilityRelay({
      serialNumber: "camera-1", getMuxedPort: () => port, ffmpegPath: "/fake/ffmpeg", createChildProcess: spawn,
    });
    relay.on("error", () => undefined);
    await relay.start();
    await upstreamReady;
    firstChild.stdout.write(Buffer.concat([initSegment(), fragment(1, true)]));
    await new Promise((resolve) => setImmediate(resolve));
    upstream!.destroy();
    await new Promise<void>((resolve) => relay.once("stopped", () => resolve()));
    expect((relay as any).init).toBeUndefined();
    await relay.start();
    const client = net.createConnection({ port: relay.getPort(), host: "127.0.0.1" });
    await new Promise<void>((resolve) => client.once("connect", resolve));
    const expected = Buffer.concat([initSegment(), fragment(1, true)]);
    const read = readLength(client, expected.length);
    secondChild.stdout.write(expected);
    expect((await read).subarray(0, expected.length)).toEqual(expected);
    client.destroy();
    await relay.stop();
    await new Promise<void>((resolve) => source.close(() => resolve()));
  });
});
