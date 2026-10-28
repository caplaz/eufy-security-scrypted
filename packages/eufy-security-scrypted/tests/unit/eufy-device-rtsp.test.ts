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

const mockCreateFFmpegMediaObject = jest.fn();

jest.mock("@scrypted/sdk", () => {
  const mediaManager = {
    convertMediaObjectToJSON: jest.fn(),
    createFFmpegMediaObject: (...args: any[]) =>
      mockCreateFFmpegMediaObject(...args),
    createMediaObject: jest
      .fn()
      .mockImplementation((obj, mime, opts) => ({ obj, mime, opts })),
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

describe("EufyDevice Direct RTSP Streaming", () => {
  let device: EufyDevice;
  let mockApi: any;
  let mockWsClient: any;
  const eventListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateFFmpegMediaObject.mockResolvedValue({ mediaObject: true });

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

  afterEach(() => {
    device.dispose();
  });

  describe("Auto-detected RTSP", () => {
    it("advertises direct RTSP stream option when rtspStreamUrl property is present", async () => {
      const options = await device.getVideoStreamOptions();
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options[0]).toEqual({
        id: "rtsp",
        name: "RTSP Stream (Direct)",
        container: "rtsp",
        tool: "ffmpeg",
        video: { codec: "h264", width: 1920, height: 1080 },
        audio: { codec: "aac" },
      });
    });

    it("streams via direct RTSP by default with TCP transport", async () => {
      await device.getVideoStream();
      expect(mockCreateFFmpegMediaObject).toHaveBeenCalledTimes(1);
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toBe("rtsp://192.168.4.22/live0");
      expect(callArg.inputArguments).toContain("-rtsp_transport");
      expect(callArg.inputArguments).toContain("tcp");
      expect(callArg.inputArguments).toContain("rtsp://192.168.4.22/live0");
      expect(callArg.mediaStreamOptions.id).toBe("rtsp");
      expect(callArg.mediaStreamOptions.audio.codec).toBe("aac");
    });

    it("falls back to P2P stream when explicit p2p stream id is requested", async () => {
      const p2pStream = await device.getVideoStream({ id: "p2p" });
      expect(p2pStream).toBeDefined();
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toBeUndefined();
      expect(callArg.inputArguments).toContain("tcp://127.0.0.1:8080");
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
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.url).toBe("rtsp://admin:secret123@192.168.4.99/live0");
      expect(callArg.inputArguments).toContain(
        "rtsp://admin:secret123@192.168.4.99/live0",
      );
    });

    it("clearing custom RTSP URL restores fallback to auto-detected URL", async () => {
      await device.putSetting("customRtspUrl", "rtsp://custom/stream");
      expect(device.getResolvedRtspUrl()).toBe("rtsp://custom/stream");

      await device.putSetting("customRtspUrl", "");
      expect(device.getResolvedRtspUrl()).toBe("rtsp://192.168.4.22/live0");
    });

    it("includes RTSP Stream URL in getSettings", async () => {
      const settings = await device.getSettings();
      const rtspSetting = settings.find((s) => s.key === "customRtspUrl");
      expect(rtspSetting).toBeDefined();
      expect(rtspSetting?.title).toBe("RTSP Stream URL");
      expect(rtspSetting?.group).toBe("Streaming");
      expect(rtspSetting?.placeholder).toContain("rtsp://192.168.4.22/live0");
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
    it("captures snapshot from RTSP stream via FFmpeg when available and no keyframe cached", async () => {
      await device.takePicture();
      expect(mockCreateFFmpegMediaObject).toHaveBeenCalledTimes(1);
      const callArg = mockCreateFFmpegMediaObject.mock.calls[0][0];
      expect(callArg.inputArguments).toContain("-rtsp_transport");
      expect(callArg.inputArguments).toContain("tcp");
      expect(callArg.inputArguments).toContain("-vframes");
      expect(callArg.inputArguments).toContain("1");
    });
  });
});
