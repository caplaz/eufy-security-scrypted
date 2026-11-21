/**
 * Unit tests for EufyDevice Direct RTSP streaming.
 *
 * Covers:
 *  - Auto-detection of RTSP URL from camera properties (rtspStreamUrl)
 *  - Custom RTSP URL override via settings (customRtspUrl)
 *  - getVideoStreamOptions prepending direct RTSP option
 *  - getVideoStream routing to direct RTSP with TCP transport
 *  - getVideoStream fallback to P2P when requested or when no RTSP is available
 *  - Handling GOT_RTSP_URL events
 */

import { EufyDevice } from "../../src/eufy-device";
import {
  DEVICE_EVENTS,
  EufyWebSocketClient,
} from "@caplaz/eufy-security-client";
import { spawn } from "child_process";
import { EventEmitter, once } from "events";
import { createConnection, Socket } from "net";
import { PassThrough } from "stream";

const mockCreateFFmpegMediaObject = jest.fn();
const mockCreateMediaObject = jest.fn();
const JPEG = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

jest.mock("child_process", () => ({ spawn: jest.fn() }));

jest.mock("@scrypted/sdk", () => {
  const mediaManager = {
    convertMediaObjectToJSON: jest.fn(),
    createFFmpegMediaObject: (...args: any[]) =>
      mockCreateFFmpegMediaObject(...args),
    createMediaObject: (...args: any[]) => mockCreateMediaObject(...args),
    getFFmpegPath: jest.fn().mockResolvedValue("/scrypted/ffmpeg"),
  };
  return {
    __esModule: true,
    ScryptedDeviceBase: class {
      info: any = { serialNumber: "TEST_RTSP_CAMERA", metadata: {} };
      mixins: string[] = [];
      onDeviceEvent = jest.fn();
      storage: any = {
        _m: new Map<string, string>(),
        getItem(k: string) {
          return this._m.has(k) ? this._m.get(k) : null;
        },
        setItem(k: string, v: string) {
          this._m.set(k, String(v));
        },
        removeItem(k: string) {
          this._m.delete(k);
        },
      };
      log: any = { a: jest.fn(), clearAlert: jest.fn() };
    },
    ScryptedInterface: {
      VideoCamera: "VideoCamera",
      Camera: "Camera",
      Settings: "Settings",
      MotionSensor: "MotionSensor",
      Intercom: "Intercom",
    },
    ScryptedMimeTypes: {
      FFmpegInput: "x-scrypted/x-ffmpeg-input",
      MediaStreamUrl: "text/x-media-url",
    },
    SecuritySystemMode: {},
    ChargeState: {},
    deviceManager: {
      onDevicesChanged: jest.fn(),
    },
    default: { mediaManager },
    mediaManager,
  };
});

jest.mock("@caplaz/eufy-stream-server", () => ({
  StreamServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getPort: jest.fn().mockReturnValue(8080),
    getMuxedPort: jest.fn().mockReturnValue(undefined),
    getActiveConnectionCount: jest.fn().mockReturnValue(0),
    getVideoMetadata: jest.fn().mockReturnValue({
      videoCodec: "H264",
      videoWidth: 1920,
      videoHeight: 1080,
      videoFPS: 15,
    }),
    getCachedKeyframe: jest.fn().mockReturnValue(null),
    setCachedKeyframe: jest.fn(),
    captureSnapshot: jest.fn(),
    isRunning: jest.fn().mockReturnValue(false),
    isMetadataVerifiedForCurrentSession: jest.fn().mockReturnValue(true),
    acquireMetadataWaiter: jest.fn().mockReturnValue({
      waitForMetadata: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
    }),
    getAudioStatus: jest.fn().mockReturnValue("aac"),
    onNextConsumerAttached: jest.fn().mockReturnValue(jest.fn()),
    on: jest.fn(),
    off: jest.fn(),
    removeListener: jest.fn(),
  })),
}));

const makeLogger = (): any => {
  const sub: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    silly: jest.fn(),
    trace: jest.fn(),
    attachTransport: jest.fn(),
  };
  sub.getSubLogger = jest.fn().mockReturnValue(sub);
  return sub;
};

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
}

describe("EufyDevice Direct RTSP Streaming", () => {
  let device: EufyDevice;
  let mockApi: any;
  let mockWsClient: any;
  let children: ReturnType<typeof makeChild>[];
  let sockets: Socket[];
  const eventListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateFFmpegMediaObject.mockResolvedValue({ mediaObject: true });
    mockCreateMediaObject.mockImplementation((obj, mime, opts) => ({
      obj,
      mime,
      opts,
    }));
    children = [];
    sockets = [];
    (spawn as jest.Mock).mockImplementation(() => {
      const child = makeChild();
      children.push(child);
      return child;
    });

    eventListeners[DEVICE_EVENTS.PROPERTY_CHANGED] = [];
    eventListeners[DEVICE_EVENTS.GOT_RTSP_URL] = [];

    mockApi = {
      getProperties: jest.fn().mockResolvedValue({
        properties: {
          serialNumber: "TEST_RTSP_CAMERA",
          name: "Front Yard",
          model: "T8410",
          type: 10,
          videoStreamingQuality: 2,
          rtspStream: true,
          rtspStreamUrl: "rtsp://192.168.4.22/live0",
        },
      }),
      isLivestreaming: jest.fn().mockResolvedValue({ livestreaming: false }),
      startLivestream: jest.fn().mockResolvedValue(undefined),
      stopLivestream: jest.fn().mockResolvedValue(undefined),
      isRtspLivestreaming: jest
        .fn()
        .mockResolvedValue({ livestreaming: false }),
      startRtspLivestream: jest.fn().mockResolvedValue(undefined),
      stopRtspLivestream: jest.fn().mockResolvedValue(undefined),
      setProperty: jest.fn().mockResolvedValue(undefined),
      panAndTilt: jest.fn().mockResolvedValue(undefined),
    };

    mockWsClient = {
      commands: {
        device: jest.fn().mockReturnValue(mockApi),
      },
      addEventListener: jest.fn((event: string, cb: Function) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(cb);
        return () => true;
      }),
      removeEventListenersBySerialNumber: jest.fn().mockReturnValue(1),
      isConnected: jest.fn().mockReturnValue(true),
    };

    device = new EufyDevice(
      "TEST_RTSP_CAMERA",
      mockWsClient as unknown as EufyWebSocketClient,
      makeLogger(),
    );
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    device.dispose();
    await (device as any).directRtspService.dispose();
    jest.useRealTimers();
  });

  async function consumeStream() {
    const spawnCount = (spawn as jest.Mock).mock.calls.length;
    const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
    const url = new URL(callArg.url);
    const socket = createConnection(Number(url.port), url.hostname);
    sockets.push(socket);
    socket.on("error", () => undefined);
    await once(socket, "connect");
    for (let i = 0; i < 100; i++) {
      if ((spawn as jest.Mock).mock.calls.length > spawnCount) return socket;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("RTSP consumer did not attach");
  }

  describe("Auto-detected RTSP", () => {
    it("advertises direct RTSP stream option without unverified codec/dimension metadata", async () => {
      const options = await device.getVideoStreamOptions();
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options[0]).toEqual({
        id: "rtsp",
        name: "RTSP Stream (Direct)",
        container: "mpegts",
        tool: "ffmpeg",
      });
      expect(options[0].video).toBeUndefined();
      expect(options[0].audio).toBeUndefined();
    });

    it("streams via direct RTSP by default with TCP transport", async () => {
      await device.getVideoStream();
      expect(mockCreateFFmpegMediaObject).toHaveBeenCalledTimes(1);
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/);
      expect(callArg.inputArguments).toEqual([
        "-f",
        "mpegts",
        "-i",
        callArg.url,
      ]);
      expect(callArg.mediaStreamOptions).toEqual({
        id: "rtsp",
        name: "RTSP Stream (Direct)",
        container: "mpegts",
        tool: "ffmpeg",
      });
      expect(callArg.mediaStreamOptions.video).toBeUndefined();
      expect(callArg.mediaStreamOptions.audio).toBeUndefined();
      expect(mockApi.startRtspLivestream).toHaveBeenCalledTimes(1);
      await consumeStream();
      expect(spawn).toHaveBeenCalledWith(
        "/scrypted/ffmpeg",
        expect.arrayContaining([
          "-rtsp_transport",
          "tcp",
          "rtsp://192.168.4.22/live0",
          "-c",
          "copy",
        ]),
      );
    });

    it("falls back to P2P stream when explicit p2p stream id is requested", async () => {
      const p2pStream = await device.getVideoStream({ id: "p2p" });
      expect(p2pStream).toBeDefined();
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toBeUndefined();
      expect(callArg.inputArguments).toContain("tcp://127.0.0.1:8080");
      expect(mockApi.startRtspLivestream).not.toHaveBeenCalled();
    });

    it("ignores cached rtspStreamUrl and uses P2P when NAS rtspStream is disabled", async () => {
      await device.getVideoStreamOptions();
      (device as any).latestProperties.rtspStream = false;
      (device as any).latestProperties.rtspStreamUrl =
        "rtsp://192.168.4.22/live0";

      expect(device.getResolvedRtspUrl()).toBeUndefined();
      const options = await device.getVideoStreamOptions();
      expect(options.some((option) => option.id === "rtsp")).toBe(false);

      await device.getVideoStream();
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toBeUndefined();
      expect(callArg.inputArguments).toContain("tcp://127.0.0.1:8080");
      expect(mockApi.isRtspLivestreaming).not.toHaveBeenCalled();
      expect(mockApi.startRtspLivestream).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it("uses P2P when no RTSP URL is available", async () => {
      await device.getVideoStreamOptions();
      (device as any).latestProperties.rtspStreamUrl = "";
      const options = await device.getVideoStreamOptions();
      expect(options.some((option) => option.id === "rtsp")).toBe(false);
      await device.getVideoStream();
      expect(
        mockCreateFFmpegMediaObject.mock.calls[0][0].inputArguments,
      ).toContain("tcp://127.0.0.1:8080");
      expect(mockApi.startRtspLivestream).not.toHaveBeenCalled();
    });

    it("releases activation if creating the media descriptor fails", async () => {
      mockCreateFFmpegMediaObject.mockRejectedValueOnce(
        new Error("descriptor failed"),
      );
      await expect(device.getVideoStream()).rejects.toThrow(
        "descriptor failed",
      );
      await settle();
      expect(mockApi.stopRtspLivestream).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe("Custom RTSP URL Override", () => {
    it("uses custom RTSP URL set in device settings over auto-detected URL", async () => {
      await device.putSetting(
        "customRtspUrl",
        "rtsp://admin:secret123@192.168.4.99/live0",
      );

      const resolved = device.getResolvedRtspUrl();
      expect(resolved).toBe("rtsp://admin:secret123@192.168.4.99/live0");

      await device.getVideoStream();
      await consumeStream();
      expect((spawn as jest.Mock).mock.calls[0][1]).toContain(
        "rtsp://admin:secret123@192.168.4.99/live0",
      );
    });

    it("keeps custom RTSP URL working with a direct descriptor when NAS rtspStream is disabled", async () => {
      await device.getVideoStreamOptions();
      (device as any).latestProperties.rtspStream = false;
      (device as any).latestProperties.rtspStreamUrl =
        "rtsp://192.168.4.22/live0";
      await device.putSetting(
        "customRtspUrl",
        "rtsp://admin:secret123@192.168.4.99/live0",
      );

      expect(device.getResolvedRtspUrl()).toBe(
        "rtsp://admin:secret123@192.168.4.99/live0",
      );
      const options = await device.getVideoStreamOptions();
      expect(options[0]).toEqual({
        id: "rtsp",
        name: "RTSP Stream (Direct)",
        container: "rtsp",
        tool: "ffmpeg",
      });

      await device.getVideoStream();
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toBe("rtsp://admin:secret123@192.168.4.99/live0");
      expect(callArg.inputArguments).toEqual(
        expect.arrayContaining(["-rtsp_transport", "tcp", callArg.url]),
      );
      expect(callArg.mediaStreamOptions).toEqual({
        id: "rtsp",
        name: "RTSP Stream (Direct)",
        container: "rtsp",
        tool: "ffmpeg",
      });
      expect(mockApi.isRtspLivestreaming).not.toHaveBeenCalled();
      expect(mockApi.startRtspLivestream).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it("clearing custom RTSP URL restores fallback to auto-detected URL", async () => {
      await device.putSetting("customRtspUrl", "rtsp://custom/stream");
      expect(device.getResolvedRtspUrl()).toBe("rtsp://custom/stream");

      await device.putSetting("customRtspUrl", "");
      expect(device.getResolvedRtspUrl()).toBe("rtsp://192.168.4.22/live0");
    });

    it("includes RTSP Stream URL as a password setting and strips user info from detected placeholder", async () => {
      await device.getVideoStreamOptions();
      (device as any).latestProperties.rtspStreamUrl =
        "rtsp://admin:secret123@192.168.4.22:554/live0";

      const settings = await device.getSettings();
      const rtspSetting = settings.find((s) => s.key === "customRtspUrl");
      expect(rtspSetting).toBeDefined();
      expect(rtspSetting?.title).toBe("RTSP Stream URL");
      expect(rtspSetting?.group).toBe("Streaming");
      expect(rtspSetting?.type).toBe("password");
      expect(rtspSetting?.placeholder).toBe("rtsp://192.168.4.22:554/live0");
      expect(rtspSetting?.placeholder).not.toContain("admin");
      expect(rtspSetting?.placeholder).not.toContain("secret123");
      expect(rtspSetting?.description).toContain(
        "rtsp://192.168.4.22:554/live0",
      );
      expect(rtspSetting?.description).not.toContain("admin");
      expect(rtspSetting?.description).not.toContain("secret123");
    });
  });

  describe("Event-driven RTSP Updates", () => {
    it("updates RTSP URL when GOT_RTSP_URL event is received", async () => {
      (device as any).latestProperties.rtspStreamUrl = "";
      expect(device.getResolvedRtspUrl()).toBeUndefined();

      const listeners = eventListeners[DEVICE_EVENTS.GOT_RTSP_URL] || [];
      expect(listeners.length).toBeGreaterThan(0);
      listeners[0]({ rtspUrl: "rtsp://192.168.4.50/live0" });

      expect(device.getResolvedRtspUrl()).toBe("rtsp://192.168.4.50/live0");
      expect((device as any).onDeviceEvent).toHaveBeenCalledWith(
        "VideoCamera",
        undefined,
      );
      expect((device as any).onDeviceEvent).toHaveBeenCalledWith(
        "Settings",
        undefined,
      );
    });
  });

  describe("Snapshot with RTSP", () => {
    it("activates and awaits real JPEG capture instead of returning a descriptor", async () => {
      const picture = device.takePicture();
      await settle();
      expect(mockApi.startRtspLivestream).toHaveBeenCalledTimes(1);
      expect(mockCreateFFmpegMediaObject).not.toHaveBeenCalled();
      expect(mockCreateMediaObject).not.toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][1]).toEqual(
        expect.arrayContaining([
          "-rtsp_transport",
          "tcp",
          "rtsp://192.168.4.22/live0",
          "-frames:v",
          "1",
        ]),
      );
      children[0].stdout.write(JPEG);
      children[0].emit("close", 0);
      await expect(picture).resolves.toEqual({
        obj: JPEG,
        mime: "image/jpeg",
        opts: { sourceId: "TEST_RTSP_CAMERA" },
      });
      await settle();
      expect(mockApi.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });

    it("uses SnapshotService after a real RTSP capture failure", async () => {
      const options = { timeout: 1000 };
      const fallback = { fallback: true };
      const takePicture = jest
        .spyOn((device as any).snapshotService, "takePicture")
        .mockResolvedValue(fallback);
      const picture = device.takePicture(options);
      await settle();
      children[0].emit("close", 1);
      await expect(picture).resolves.toBe(fallback);
      expect(takePicture).toHaveBeenCalledTimes(1);
      expect(takePicture).toHaveBeenCalledWith(options);
      expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
      await settle();
      expect(mockApi.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });

    it("falls back promptly on capture timeout and releases activation", async () => {
      jest.useFakeTimers();
      const fallback = { fallback: true };
      const takePicture = jest
        .spyOn((device as any).snapshotService, "takePicture")
        .mockResolvedValue(fallback);
      const picture = device.takePicture({ timeout: 50 });
      await settle();
      await jest.advanceTimersByTimeAsync(50);
      await expect(picture).resolves.toBe(fallback);
      expect(takePicture).toHaveBeenCalledTimes(1);
      expect(children[0].kill).toHaveBeenCalledWith("SIGKILL");
      expect(mockApi.stopRtspLivestream).toHaveBeenCalledTimes(1);
    });

    it("falls back if activation fails without claiming ownership", async () => {
      mockApi.startRtspLivestream.mockRejectedValueOnce(
        new Error("camera asleep"),
      );
      const fallback = { fallback: true };
      const takePicture = jest
        .spyOn((device as any).snapshotService, "takePicture")
        .mockResolvedValue(fallback);
      await expect(device.takePicture()).resolves.toBe(fallback);
      expect(takePicture).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
      expect(mockApi.stopRtspLivestream).not.toHaveBeenCalled();
    });

    it("uses a cached snapshot without activating RTSP", async () => {
      (device as any).streamServer.getCachedKeyframe.mockReturnValue({
        data: Buffer.from("cached keyframe"),
        ageMs: 100,
        codec: "H264",
      });
      const cached = { cached: true };
      const takePicture = jest
        .spyOn((device as any).snapshotService, "takePicture")
        .mockResolvedValue(cached);
      await expect(device.takePicture()).resolves.toBe(cached);
      expect(takePicture).toHaveBeenCalledTimes(1);
      expect(mockApi.isRtspLivestreaming).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it("waits for initial properties before selecting the cold snapshot source", async () => {
      device.dispose();
      await (device as any).directRtspService.dispose();
      const properties = await mockApi.getProperties();
      let resolveProperties!: (value: unknown) => void;
      mockApi.getProperties.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveProperties = resolve;
        }),
      );
      device = new EufyDevice("TEST_RTSP_CAMERA", mockWsClient, makeLogger());
      const picture = device.takePicture();
      await settle();
      expect(spawn).not.toHaveBeenCalled();
      resolveProperties(properties);
      await settle();
      expect(mockApi.startRtspLivestream).toHaveBeenCalledTimes(1);
      children[0].stdout.write(JPEG);
      children[0].emit("close", 0);
      await expect(picture).resolves.toMatchObject({
        obj: JPEG,
        mime: "image/jpeg",
      });
    });
  });
});
