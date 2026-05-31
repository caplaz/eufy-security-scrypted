/**
 * H.264 transcode relay server tests
 */

import * as net from "net";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import {
  H264TranscodeServer,
  buildTranscodeArgs,
  SpawnFn,
} from "../../../src/utils/h264-transcode-server";

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  silly: jest.fn(),
  trace: jest.fn(),
} as any;

/** A controllable fake child process matching the SpawnedChild shape. */
function makeFakeChild() {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = jest.fn(() => true);
  return {
    stdout,
    stderr,
    kill,
    on: (ev: string, cb: (...a: any[]) => void) => emitter.on(ev, cb),
    emit: (ev: string, arg?: any) => emitter.emit(ev, arg),
  };
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("buildTranscodeArgs", () => {
  it("re-encodes to H.264 from the given muxed source port, copying audio", () => {
    const args = buildTranscodeArgs(40123);
    const joined = args.join(" ");
    expect(joined).toContain("-i tcp://127.0.0.1:40123");
    expect(joined).toContain("-c:v libx264");
    expect(joined).toContain("-c:a copy");
    // Optional audio map so video-only (mic-off) cameras don't fail.
    expect(args).toContain("0:a:0?");
    // Fragmented MP4 so the downstream consumer can start mid-stream.
    expect(joined).toContain("frag_keyframe");
    expect(args[args.length - 1]).toBe("pipe:1");
  });
});

describe("H264TranscodeServer", () => {
  let servers: H264TranscodeServer[] = [];
  let sockets: net.Socket[] = [];

  const make = (opts: {
    getSourcePort: () => number | undefined;
    spawnFn?: SpawnFn;
  }) => {
    const s = new H264TranscodeServer({
      serialNumber: "TEST",
      logger: mockLogger,
      ...opts,
    });
    servers.push(s);
    return s;
  };

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    sockets = [];
    for (const s of servers) await s.stop();
    servers = [];
    jest.clearAllMocks();
  });

  it("listens on a free port after start and reports it", async () => {
    const server = make({ getSourcePort: () => 50000 });
    expect(server.isRunning()).toBe(false);
    await server.start();
    expect(server.isRunning()).toBe(true);
    expect(typeof server.getPort()).toBe("number");
  });

  it("spawns one ffmpeg per client and pipes its stdout to the socket", async () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child) as unknown as SpawnFn;
    const server = make({ getSourcePort: () => 51111, spawnFn });
    await server.start();

    const client = await connect(server.getPort()!);
    sockets.push(client);
    await tick();

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [, args] = (spawnFn as jest.Mock).mock.calls[0];
    expect(args.join(" ")).toContain("-i tcp://127.0.0.1:51111");

    const received = new Promise<Buffer>((resolve) =>
      client.once("data", resolve),
    );
    child.stdout.write(Buffer.from("h264-bytes"));
    expect((await received).toString()).toBe("h264-bytes");
  });

  it("refuses (closes) a client when no muxed source port is available", async () => {
    const spawnFn = jest.fn() as unknown as SpawnFn;
    const server = make({ getSourcePort: () => undefined, spawnFn });
    await server.start();

    const client = await connect(server.getPort()!);
    sockets.push(client);
    const closed = new Promise<void>((resolve) =>
      client.once("close", () => resolve()),
    );
    await tick();

    expect(spawnFn).not.toHaveBeenCalled();
    await closed; // socket was destroyed by the server
  });

  it("kills the ffmpeg when the client disconnects", async () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child) as unknown as SpawnFn;
    const server = make({ getSourcePort: () => 52222, spawnFn });
    await server.start();

    const client = await connect(server.getPort()!);
    await tick();
    expect(spawnFn).toHaveBeenCalledTimes(1);

    client.end();
    client.destroy();
    await tick();
    expect(child.kill).toHaveBeenCalled();
  });

  it("stop() kills active encodes and closes the listener", async () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child) as unknown as SpawnFn;
    const server = make({ getSourcePort: () => 53333, spawnFn });
    await server.start();

    const client = await connect(server.getPort()!);
    sockets.push(client);
    await tick();

    await server.stop();
    expect(child.kill).toHaveBeenCalled();
    expect(server.isRunning()).toBe(false);
    expect(server.getPort()).toBeUndefined();
  });

  it("start() is idempotent", async () => {
    const server = make({ getSourcePort: () => 54444 });
    await server.start();
    const port = server.getPort();
    await server.start();
    expect(server.getPort()).toBe(port);
  });
});
