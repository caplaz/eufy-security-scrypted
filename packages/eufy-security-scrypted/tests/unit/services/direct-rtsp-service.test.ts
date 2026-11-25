import { spawn } from "child_process";
import { EventEmitter, once } from "events";
import { createConnection, Socket } from "net";
import { PassThrough } from "stream";
import { DirectRtspService } from "../../../src/services/device/direct-rtsp-service";

jest.mock("child_process", () => ({ spawn: jest.fn() }));

const RTSP_URL = "rtsp://user:password@192.0.2.1/live0";
const JPEG = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition did not settle");
}

function makeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
}

describe("DirectRtspService", () => {
  let service: DirectRtspService;
  let api: {
    isRtspLivestreaming: jest.Mock;
    startRtspLivestream: jest.Mock;
    stopRtspLivestream: jest.Mock;
  };
  let ffmpegPath: jest.Mock;
  let requiresActivation: jest.Mock;
  let children: ReturnType<typeof makeChild>[];
  let sockets: Socket[];
  let logger: any;

  beforeEach(() => {
    jest.clearAllMocks();
    children = [];
    sockets = [];
    api = {
      isRtspLivestreaming: jest
        .fn()
        .mockResolvedValue({ livestreaming: false }),
      startRtspLivestream: jest.fn().mockResolvedValue(undefined),
      stopRtspLivestream: jest.fn().mockResolvedValue(undefined),
    };
    ffmpegPath = jest.fn().mockResolvedValue("/scrypted/ffmpeg");
    requiresActivation = jest.fn().mockReturnValue(true);
    logger = { warn: jest.fn() };
    service = new DirectRtspService({
      api: () => api,
      ffmpegPath,
      requiresActivation,
      logger,
    });
    mockSpawn.mockImplementation(() => {
      const child = makeChild();
      children.push(child);
      return child as any;
    });
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    await service.dispose();
    jest.useRealTimers();
  });

  async function connect(url: string) {
    const spawnCount = mockSpawn.mock.calls.length;
    const parsed = new URL(url);
    const socket = createConnection(Number(parsed.port), parsed.hostname);
    sockets.push(socket);
    socket.on("error", () => undefined);
    await once(socket, "connect");
    await waitFor(() => mockSpawn.mock.calls.length > spawnCount);
    return socket;
  }

  it("deduplicates concurrent activation and stops only after the last socket closes", async () => {
    const start = deferred<void>();
    api.startRtspLivestream.mockReturnValue(start.promise);
    const first = service.createVideoStream(RTSP_URL);
    const second = service.createVideoStream(RTSP_URL);
    await settle();
    expect(api.startRtspLivestream).toHaveBeenCalledTimes(1);
    start.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(api.isRtspLivestreaming).toHaveBeenCalledTimes(1);
    expect(mockSpawn).not.toHaveBeenCalled();

    const viewerA = await connect(a.url);
    const viewerB = await connect(b.url);
    expect(children).toHaveLength(2);
    const received = once(viewerA, "data");
    children[0].stdout.write(Buffer.from("copied media"));
    expect((await received)[0]).toEqual(Buffer.from("copied media"));
    expect(mockSpawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining([RTSP_URL, "-c", "copy", "mpegts"]),
    );

    viewerA.destroy();
    await waitFor(() => children[0].kill.mock.calls.length === 1);
    await settle();
    expect(api.stopRtspLivestream).not.toHaveBeenCalled();
    viewerB.destroy();
    await waitFor(() => api.stopRtspLivestream.mock.calls.length === 1);
    expect(children[1].kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not claim or stop a session that was already active", async () => {
    api.isRtspLivestreaming.mockResolvedValue({ livestreaming: true });
    const endpoint = await service.createVideoStream(RTSP_URL);
    const viewer = await connect(endpoint.url);
    viewer.destroy();
    await waitFor(() => children[0].kill.mock.calls.length === 1);
    await service.dispose();
    expect(api.startRtspLivestream).not.toHaveBeenCalled();
    expect(api.stopRtspLivestream).not.toHaveBeenCalled();
  });

  it("expires a descriptor that is never consumed", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    await service.createVideoStream(RTSP_URL);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("closes listeners, sockets and FFmpeg on disposal", async () => {
    const active = await service.createVideoStream(RTSP_URL);
    const unused = await service.createVideoStream(RTSP_URL);
    const viewer = await connect(active.url);
    const disconnected = once(viewer, "close");
    viewer.resume();
    await service.dispose();
    await disconnected;
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    const url = new URL(unused.url);
    const rejected = createConnection(Number(url.port), url.hostname);
    sockets.push(rejected);
    const [error] = await once(rejected, "error");
    expect(error.code).toBe("ECONNREFUSED");
  });

  it("stops a late successful start after disposal without publishing an endpoint", async () => {
    const start = deferred<void>();
    api.startRtspLivestream.mockReturnValue(start.promise);
    const stream = service.createVideoStream(RTSP_URL);
    const rejected = expect(stream).rejects.toThrow("closed");
    await settle();
    const disposed = service.dispose();
    await rejected;
    start.resolve();
    await disposed;
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    expect(ffmpegPath).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("does not start after disposal during the status query", async () => {
    const status = deferred<{ livestreaming: boolean }>();
    api.isRtspLivestreaming.mockReturnValue(status.promise);
    const stream = service.createVideoStream(RTSP_URL);
    const rejected = expect(stream).rejects.toThrow("closed");
    await settle();
    const disposed = service.dispose();
    await rejected;
    status.resolve({ livestreaming: false });
    await disposed;
    expect(api.startRtspLivestream).not.toHaveBeenCalled();
    expect(api.stopRtspLivestream).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("does not publish an endpoint after disposal while resolving FFmpeg", async () => {
    const path = deferred<string>();
    ffmpegPath.mockReturnValue(path.promise);
    const stream = service.createVideoStream(RTSP_URL);
    const rejected = expect(stream).rejects.toThrow("closed");
    await settle();
    await service.dispose();
    await rejected;
    path.resolve("/scrypted/ffmpeg");
    await settle();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("waits for an in-flight stop before activating for a new consumer", async () => {
    const first = await service.createVideoStream(RTSP_URL);
    const stop = deferred<void>();
    api.stopRtspLivestream.mockReturnValueOnce(stop.promise);
    first.close();
    await settle();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    const next = service.createVideoStream(RTSP_URL);
    await settle();
    expect(api.startRtspLivestream).toHaveBeenCalledTimes(1);
    stop.resolve();
    const second = await next;
    expect(api.startRtspLivestream).toHaveBeenCalledTimes(2);
    second.close();
    await settle();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(2);
  });

  it.each(["isRtspLivestreaming", "startRtspLivestream"] as const)(
    "releases a failed %s request and permits a later retry",
    async (command) => {
      api[command].mockRejectedValueOnce(new Error("camera unavailable"));
      await expect(service.createVideoStream(RTSP_URL)).rejects.toThrow(
        "camera unavailable",
      );
      await settle();
      expect(api.stopRtspLivestream).not.toHaveBeenCalled();
      const endpoint = await service.createVideoStream(RTSP_URL);
      endpoint.close();
      await settle();
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    },
  );

  it("cleans activation if resolving the FFmpeg binary fails", async () => {
    ffmpegPath.mockRejectedValueOnce(new Error("FFmpeg missing"));
    await expect(service.createVideoStream(RTSP_URL)).rejects.toThrow(
      "FFmpeg missing",
    );
    await settle();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it.each(["error", "close"])(
    "releases a live consumer when FFmpeg emits %s",
    async (event) => {
      const endpoint = await service.createVideoStream(RTSP_URL);
      const viewer = await connect(endpoint.url);
      viewer.resume();
      const disconnected = once(viewer, "close");
      children[0].emit(
        event,
        event === "error" ? new Error("spawn failed") : 1,
      );
      await disconnected;
      await settle();
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    },
  );

  it("closes the consumer when spawn throws synchronously", async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });
    const endpoint = await service.createVideoStream(RTSP_URL);
    const url = new URL(endpoint.url);
    const viewer = createConnection(Number(url.port), url.hostname);
    sockets.push(viewer);
    viewer.on("error", () => undefined);
    const disconnected = once(viewer, "close");
    viewer.resume();
    await disconnected;
    await settle();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
  });

  it("keeps ownership after a failed stop so disposal can retry cleanup", async () => {
    const endpoint = await service.createVideoStream(RTSP_URL);
    api.stopRtspLivestream.mockRejectedValueOnce(new Error("disconnected"));
    endpoint.close();
    await settle();
    expect(logger.warn).toHaveBeenCalled();
    await service.dispose();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(2);
  });

  it("rechecks activation after an uncertain stop result", async () => {
    const endpoint = await service.createVideoStream(RTSP_URL);
    api.stopRtspLivestream.mockRejectedValueOnce(new Error("response lost"));
    endpoint.close();
    await settle();
    const next = await service.createVideoStream(RTSP_URL);
    expect(api.isRtspLivestreaming).toHaveBeenCalledTimes(2);
    expect(api.startRtspLivestream).toHaveBeenCalledTimes(2);
    next.close();
    await settle();
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(2);
  });

  it("does not extend activation for an unresponsive connected consumer", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    const endpoint = await service.createVideoStream(RTSP_URL);
    const viewer = await connect(endpoint.url);
    viewer.resume();
    const disconnected = once(viewer, "close");
    await jest.advanceTimersByTimeAsync(30_000);
    await disconnected;
    await settle();
    expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
  });

  it("makes repeated close, socket error and FFmpeg exit cleanup idempotent", async () => {
    const endpoint = await service.createVideoStream(RTSP_URL);
    const viewer = await connect(endpoint.url);
    endpoint.close();
    endpoint.close();
    children[0].emit("error", new Error("process ended"));
    children[0].emit("close", 1);
    viewer.destroy();
    await service.dispose();
    await service.dispose();
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
  });

  it("rejects new consumers after disposal", async () => {
    await service.dispose();
    await expect(service.createVideoStream(RTSP_URL)).rejects.toThrow(
      "disposed",
    );
    await expect(service.captureSnapshot(RTSP_URL)).rejects.toThrow("disposed");
    expect(api.startRtspLivestream).not.toHaveBeenCalled();
  });

  describe("snapshots", () => {
    it("activates before capture, waits for JPEG bytes and cleans up", async () => {
      const start = deferred<void>();
      api.startRtspLivestream.mockReturnValue(start.promise);
      const capture = service.captureSnapshot(RTSP_URL);
      let settled = false;
      void capture.then(() => {
        settled = true;
      });
      await settle();
      expect(mockSpawn).not.toHaveBeenCalled();
      start.resolve();
      await settle();
      expect(settled).toBe(false);
      children[0].stdout.write(JPEG.subarray(0, 3));
      children[0].stdout.write(JPEG.subarray(3));
      expect(settled).toBe(false);
      children[0].emit("close", 0);
      await expect(capture).resolves.toEqual(JPEG);
      await settle();
      expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });

    it("does not stop activation while a live viewer still needs it", async () => {
      const endpoint = await service.createVideoStream(RTSP_URL);
      const viewer = await connect(endpoint.url);
      const capture = service.captureSnapshot(RTSP_URL);
      await settle();
      children[1].stdout.write(JPEG);
      children[1].emit("close", 0);
      await capture;
      await settle();
      expect(api.startRtspLivestream).toHaveBeenCalledTimes(1);
      expect(api.stopRtspLivestream).not.toHaveBeenCalled();
      viewer.destroy();
      await waitFor(() => api.stopRtspLivestream.mock.calls.length === 1);
    });

    it("shares activation between simultaneous snapshot captures", async () => {
      const first = service.captureSnapshot(RTSP_URL);
      const second = service.captureSnapshot(RTSP_URL);
      await settle();
      expect(api.startRtspLivestream).toHaveBeenCalledTimes(1);
      children[0].stdout.write(JPEG);
      children[0].emit("close", 0);
      await first;
      await settle();
      expect(api.stopRtspLivestream).not.toHaveBeenCalled();
      children[1].stdout.write(JPEG);
      children[1].emit("close", 0);
      await second;
      await settle();
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });

    it("does not activate or stop unmanaged RTSP sources", async () => {
      requiresActivation.mockReturnValue(false);
      const capture = service.captureSnapshot(RTSP_URL);
      await settle();
      children[0].stdout.write(JPEG);
      children[0].emit("close", 0);
      await capture;
      await service.dispose();
      expect(api.isRtspLivestreaming).not.toHaveBeenCalled();
      expect(api.startRtspLivestream).not.toHaveBeenCalled();
      expect(api.stopRtspLivestream).not.toHaveBeenCalled();
    });

    it.each([
      [1, JPEG],
      [0, Buffer.alloc(0)],
      [0, Buffer.from("invalid image")],
    ])("rejects failed or invalid capture (exit %s)", async (code, data) => {
      const capture = service.captureSnapshot(RTSP_URL);
      const rejected = expect(capture).rejects.toThrow("capture failed");
      await settle();
      children[0].stdout.write(data);
      children[0].emit("close", code);
      await rejected;
      await settle();
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });

    it.each(["error", "pipe error", "oversized"])(
      "cleans up a capture after %s",
      async (failure) => {
        const capture = service.captureSnapshot(RTSP_URL);
        const rejected = expect(capture).rejects.toThrow();
        await settle();
        if (failure === "error") children[0].emit("error", new Error("ENOENT"));
        else if (failure === "pipe error")
          children[0].stdout.emit("error", new Error("EPIPE"));
        else children[0].stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1));
        await rejected;
        await settle();
        expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
        expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
      },
    );

    it.each([100, 60_000, undefined])(
      "bounds capture time and kills FFmpeg (requested timeout %s)",
      async (requestedTimeout) => {
        jest.useFakeTimers();
        const capture = service.captureSnapshot(RTSP_URL, requestedTimeout);
        const rejected = expect(capture).rejects.toThrow("timed out");
        await settle();
        await jest.advanceTimersByTimeAsync(
          requestedTimeout === 100 ? 100 : 15_000,
        );
        await rejected;
        expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
        expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
      },
    );

    it("bounds a pending activation and stops it if it succeeds after timeout", async () => {
      jest.useFakeTimers();
      const start = deferred<void>();
      api.startRtspLivestream.mockReturnValue(start.promise);
      const capture = service.captureSnapshot(RTSP_URL, 50);
      const rejected = expect(capture).rejects.toThrow("timed out");
      await settle();
      await jest.advanceTimersByTimeAsync(50);
      await rejected;
      expect(mockSpawn).not.toHaveBeenCalled();
      start.resolve();
      await settle();
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("does not activate after a snapshot times out during the status query", async () => {
      jest.useFakeTimers();
      const status = deferred<{ livestreaming: boolean }>();
      api.isRtspLivestreaming.mockReturnValue(status.promise);
      const capture = service.captureSnapshot(RTSP_URL, 50);
      const rejected = expect(capture).rejects.toThrow("timed out");
      await settle();
      await jest.advanceTimersByTimeAsync(50);
      await rejected;
      status.resolve({ livestreaming: false });
      await settle();
      expect(api.startRtspLivestream).not.toHaveBeenCalled();
      expect(api.stopRtspLivestream).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("cancels a running capture on disposal", async () => {
      const capture = service.captureSnapshot(RTSP_URL);
      const rejected = expect(capture).rejects.toThrow("disposed");
      await settle();
      await service.dispose();
      await rejected;
      expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
      expect(api.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });
  });
});
