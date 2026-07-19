/**
 * Stream Service Tests
 */

import { StreamService } from "../../../src/services/device/stream-service";
import { IStreamServer } from "../../../src/services/device/types";
import { Logger, ILogObj } from "tslog";
import { VideoQuality } from "@caplaz/eufy-security-client";
import { MediaObject } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { CompatibilityMode } from "../../../src/services/device/stream-selector";

const liveH265Metadata = {
  videoCodec: "H265" as const,
  videoWidth: 1920,
  videoHeight: 1080,
  videoFPS: 15,
};

// Mock the SDK
jest.mock("@scrypted/sdk", () => ({
  __esModule: true,
  default: {
    mediaManager: {
      createFFmpegMediaObject: jest.fn(),
    },
  },
}));

describe("StreamService", () => {
  let service: StreamService;
  let mockStreamServer: jest.Mocked<IStreamServer>;
  let mockLogger: jest.Mocked<Logger<ILogObj>>;

  const serialNumber = "TEST-DEVICE-123";
  const mockPort = 12345;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      silly: jest.fn(),
      trace: jest.fn(),
    } as any;

    mockStreamServer = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getPort: jest.fn().mockReturnValue(mockPort),
      isRunning: jest.fn().mockReturnValue(false),
      getVideoMetadata: jest.fn().mockReturnValue({
        videoCodec: "H264",
        videoWidth: 1920,
        videoHeight: 1080,
        videoFPS: 15,
      }),
      getAudioMetadata: jest.fn().mockReturnValue(null),
      getMuxedPort: jest.fn().mockReturnValue(undefined),
      getAudioStatus: jest.fn().mockReturnValue("aac"),
      isMetadataVerifiedForCurrentSession: jest.fn().mockReturnValue(true),
      acquireMetadataWaiter: jest.fn(),
      onNextConsumerAttached: jest.fn().mockReturnValue(jest.fn()),
      captureSnapshot: jest.fn(),
    } as any;

    // Mock SDK mediaManager
    const mockMediaObject: MediaObject = {
      mimeType: "video/h264",
    } as any;
    (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mockResolvedValue(
      mockMediaObject,
    );

    service = new StreamService(serialNumber, mockStreamServer, mockLogger);
  });

  afterEach(async () => {
    await service.dispose();
  });

  describe("getVideoDimensions", () => {
    it("should return LOW quality dimensions", () => {
      const dimensions = service.getVideoDimensions(VideoQuality.LOW);
      expect(dimensions).toEqual({ width: 640, height: 480 });
    });

    it("should return MEDIUM quality dimensions", () => {
      const dimensions = service.getVideoDimensions(VideoQuality.MEDIUM);
      expect(dimensions).toEqual({ width: 1280, height: 720 });
    });

    it("should return HIGH quality dimensions", () => {
      const dimensions = service.getVideoDimensions(VideoQuality.HIGH);
      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });

    it("should return ULTRA quality dimensions", () => {
      const dimensions = service.getVideoDimensions(VideoQuality.ULTRA);
      expect(dimensions).toEqual({ width: 2560, height: 1440 });
    });

    it("should return default dimensions for undefined quality", () => {
      const dimensions = service.getVideoDimensions(undefined);
      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });

    it("should return default dimensions for unknown quality", () => {
      const dimensions = service.getVideoDimensions(999 as VideoQuality);
      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });
  });

  describe("getVideoStreamOptions", () => {
    it("does not advertise a stale codec hint as native stream bytes", () => {
      mockStreamServer.getVideoMetadata.mockReturnValue(liveH265Metadata);
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        false,
      );
      mockStreamServer.getAudioStatus.mockReturnValue("unknown");

      const [native] = service.getVideoStreamOptions(VideoQuality.HIGH);

      expect(native.video).toEqual({ width: 1920, height: 1080 });
      expect(native.audio).toBeUndefined();
    });

    it("advertises verified native fMP4 codec and observed audio truthfully", () => {
      mockStreamServer.getVideoMetadata.mockReturnValue(liveH265Metadata);
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        true,
      );
      mockStreamServer.getAudioStatus.mockReturnValue("none");

      expect(service.getVideoStreamOptions(VideoQuality.HIGH)).toEqual([
        {
          id: "p2p",
          name: "P2P Stream",
          container: "mp4",
          video: { codec: "h265", width: 1920, height: 1080 },
        },
        {
          id: "p2p-h264",
          name: "P2P Stream (H.264 Compatibility)",
          container: "mp4",
          video: { codec: "h264", width: 1920, height: 1080 },
        },
      ]);
    });
    it("should return stream options with correct dimensions", () => {
      const options = service.getVideoStreamOptions(VideoQuality.HIGH);

      expect(options).toHaveLength(1);
      expect(options[0]).toEqual({
        id: "p2p",
        name: "P2P Stream",
        container: "mp4",
        video: {
          codec: "h264",
          width: 1920,
          height: 1080,
        },
        audio: {
          codec: "aac",
        },
      });
    });

    it("should handle undefined quality", () => {
      const options = service.getVideoStreamOptions(undefined);

      expect(options[0].video).toMatchObject({
        width: 1920,
        height: 1080,
      });
    });

    it("should adapt dimensions based on quality", () => {
      const lowOptions = service.getVideoStreamOptions(VideoQuality.LOW);
      const highOptions = service.getVideoStreamOptions(VideoQuality.HIGH);

      expect(lowOptions[0].video?.width).toBe(640);
      expect(highOptions[0].video?.width).toBe(1920);
    });
  });

  describe("getVideoStream", () => {
    it("waits for current-session metadata and holds bootstrap until a consumer attaches", async () => {
      let resolveMetadata!: (metadata: typeof liveH265Metadata) => void;
      const release = jest.fn();
      let consumerAttached: (() => void) | undefined;
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        false,
      );
      mockStreamServer.acquireMetadataWaiter.mockReturnValue({
        promise: new Promise((resolve) => {
          resolveMetadata = resolve;
        }),
        release,
        cancel: release,
      });
      mockStreamServer.onNextConsumerAttached.mockImplementation((callback) => {
        consumerAttached = callback;
        return jest.fn();
      });

      const result = service.getVideoStream(VideoQuality.HIGH, { id: "p2p" });
      await Promise.resolve();
      await Promise.resolve();
      expect(mockStreamServer.acquireMetadataWaiter).toHaveBeenCalledTimes(1);
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        true,
      );
      resolveMetadata(liveH265Metadata);
      await result;

      expect(release).not.toHaveBeenCalled();
      consumerAttached?.();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("keeps a verified H265 native stream truthful when the consumer requests H264", async () => {
      mockStreamServer.getVideoMetadata.mockReturnValue(liveH265Metadata);
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        true,
      );
      mockStreamServer.getMuxedPort.mockReturnValue(55555);

      await service.getVideoStream(VideoQuality.HIGH, {
        id: "p2p",
        video: { codec: "h264" },
      } as any);

      expect(sdk.mediaManager.createFFmpegMediaObject).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaStreamOptions: expect.objectContaining({
            video: expect.objectContaining({ codec: "h265" }),
          }),
        }),
      );
    });

    it("routes an explicit compatibility stream through a shared H264 relay", async () => {
      const relay = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        getPort: jest.fn().mockReturnValue(45678),
      };
      const relayFactory = jest.fn().mockReturnValue(relay);
      mockStreamServer.getVideoMetadata.mockReturnValue(liveH265Metadata);
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        true,
      );
      mockStreamServer.getMuxedPort.mockReturnValue(55555);
      service = new StreamService(serialNumber, mockStreamServer, mockLogger, {
        compatibilityMode: () => "Auto" as CompatibilityMode,
        relayFactory,
      });

      await service.getVideoStream(VideoQuality.HIGH, { id: "p2p-h264" });

      expect(relay.start).toHaveBeenCalledTimes(1);
      expect(sdk.mediaManager.createFFmpegMediaObject).toHaveBeenCalledWith(
        expect.objectContaining({
          inputArguments: expect.arrayContaining(["tcp://127.0.0.1:45678"]),
          mediaStreamOptions: expect.objectContaining({
            container: "mp4",
            video: expect.objectContaining({ codec: "h264" }),
          }),
        }),
      );
    });

    it("reports a thermal admission denial for an explicit compatibility stream", async () => {
      mockStreamServer.getVideoMetadata.mockReturnValue(liveH265Metadata);
      mockStreamServer.isMetadataVerifiedForCurrentSession.mockReturnValue(
        true,
      );
      service = new StreamService(serialNumber, mockStreamServer, mockLogger, {
        thermalGovernor: {
          checkCompatibilityEncoderAdmission: jest
            .fn()
            .mockResolvedValue(false),
          getStatus: jest.fn().mockReturnValue({
            throttled: true,
            reason: "critical-temperature",
            temperatureC: 92,
          }),
        },
      });

      await expect(
        service.getVideoStream(VideoQuality.HIGH, { id: "p2p-h264" }),
      ).rejects.toThrow("compatibility-unavailable");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("thermal admission denied"),
      );
    });
    it("should start stream server if not already started", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      expect(mockStreamServer.start).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith("Starting stream server...");
      expect(mockLogger.info).toHaveBeenCalledWith("Stream server started");
    });

    it("should not start stream server if already started", async () => {
      await service.getVideoStream(VideoQuality.HIGH);
      await service.getVideoStream(VideoQuality.HIGH);

      expect(mockStreamServer.start).toHaveBeenCalledTimes(1);
    });

    it("should get port from stream server", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      expect(mockStreamServer.getPort).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        `Stream server is listening on port ${mockPort}`,
      );
    });

    it("should throw error if port is not available", async () => {
      mockStreamServer.getPort.mockReturnValueOnce(undefined);

      await expect(service.getVideoStream(VideoQuality.HIGH)).rejects.toThrow(
        "Failed to get stream server port",
      );
    });

    it("should create FFmpeg media object with correct configuration", async () => {
      await service.getVideoStream(VideoQuality.HIGH, {
        id: "custom-stream",
        name: "Custom Stream",
      });

      expect(sdk.mediaManager.createFFmpegMediaObject).toHaveBeenCalledWith(
        expect.objectContaining({
          url: undefined,
          inputArguments: expect.arrayContaining([
            "-f",
            "h264",
            "-i",
            `tcp://127.0.0.1:${mockPort}`,
          ]),
          mediaStreamOptions: expect.objectContaining({
            id: "custom-stream",
            name: "Custom Stream",
            video: expect.objectContaining({
              codec: "h264",
              width: 1920,
              height: 1080,
            }),
          }),
        }),
      );
    });

    it("reports our actual source codec, not a consumer's requested codec", async () => {
      // Source is H.265. A consumer (HomeKit) requests h264; we must NOT relabel
      // our stream as h264 — that gets it `-vcodec copy`'d as-is and fails.
      mockStreamServer.getVideoMetadata = jest.fn().mockReturnValue({
        videoCodec: "H265",
        videoWidth: 1920,
        videoHeight: 1080,
        videoFPS: 15,
      });

      await service.getVideoStream(VideoQuality.HIGH, {
        id: "main",
        video: { codec: "h264" },
      } as any);

      expect(sdk.mediaManager.createFFmpegMediaObject).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaStreamOptions: expect.objectContaining({
            video: expect.objectContaining({ codec: "h265" }),
          }),
        }),
      );
    });

    it("should use default stream options if not provided", async () => {
      await service.getVideoStream(VideoQuality.MEDIUM);

      expect(sdk.mediaManager.createFFmpegMediaObject).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaStreamOptions: expect.objectContaining({
            id: "main",
            name: "Eufy Camera Stream",
            video: expect.objectContaining({
              width: 1280,
              height: 720,
            }),
          }),
        }),
      );
    });

    it("should handle stream server start errors", async () => {
      const error = new Error("Failed to start server");
      mockStreamServer.start.mockRejectedValueOnce(error);

      await expect(service.getVideoStream(VideoQuality.HIGH)).rejects.toThrow(
        "Failed to start server",
      );
    });

    it("should return media object", async () => {
      const result = await service.getVideoStream(VideoQuality.HIGH);

      expect(result).toBeDefined();
      expect(result.mimeType).toBe("video/h264");
    });

    it("logs requested stream id and destination for the verification gate", async () => {
      await service.getVideoStream(undefined, {
        id: "p2p",
        destination: "local-recorder",
        tool: "ffmpeg",
      } as any);
      expect(
        mockLogger.info.mock.calls.some(
          (c: any[]) =>
            typeof c[0] === "string" &&
            c[0].includes("[stream-request]") &&
            c[0].includes("id=p2p") &&
            c[0].includes("destination=local-recorder") &&
            c[0].includes("tool=ffmpeg"),
        ),
      ).toBe(true);
    });

    it("logs absent id and destination as <none>", async () => {
      await service.getVideoStream(undefined, undefined);
      expect(
        mockLogger.info.mock.calls.some(
          (c: any[]) =>
            typeof c[0] === "string" &&
            c[0].includes(
              "[stream-request] id=<none> destination=<none> tool=<none>",
            ),
        ),
      ).toBe(true);
    });

    it("escapes CR/LF in requested stream fields to keep the log entry on one line", async () => {
      await service.getVideoStream(undefined, {
        id: "p2p\nspoofed",
        destination: "local\r\nrecorder",
        tool: "ffmpeg\rtool",
      } as any);

      const streamRequest = mockLogger.info.mock.calls.find(
        (c: any[]) =>
          typeof c[0] === "string" && c[0].includes("[stream-request]"),
      );

      expect(streamRequest?.[0]).toBe(
        "[stream-request] id=p2p\\nspoofed destination=local\\r\\nrecorder tool=ffmpeg\\rtool",
      );
      expect(streamRequest?.[0]).not.toMatch(/[\r\n]/);
    });
  });

  describe("stopStream", () => {
    it("should stop stream server if started", async () => {
      await service.getVideoStream(VideoQuality.HIGH);
      await service.stopStream();

      expect(mockStreamServer.stop).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith("Stopping stream server");
      expect(mockLogger.info).toHaveBeenCalledWith("Stream server stopped");
    });

    it("should not stop stream server if not started", async () => {
      await service.stopStream();

      expect(mockStreamServer.stop).not.toHaveBeenCalled();
    });

    it("should allow restart after stop", async () => {
      await service.getVideoStream(VideoQuality.HIGH);
      await service.stopStream();
      await service.getVideoStream(VideoQuality.HIGH);

      expect(mockStreamServer.start).toHaveBeenCalledTimes(2);
      expect(mockStreamServer.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe("isStreaming", () => {
    it("should return false initially", () => {
      expect(service.isStreaming()).toBe(false);
    });

    it("should return true after starting stream", async () => {
      await service.getVideoStream(VideoQuality.HIGH);
      expect(service.isStreaming()).toBe(true);
    });

    it("should return false after stopping stream", async () => {
      await service.getVideoStream(VideoQuality.HIGH);
      await service.stopStream();
      expect(service.isStreaming()).toBe(false);
    });
  });

  describe("dispose", () => {
    it("should stop stream if running", async () => {
      await service.getVideoStream(VideoQuality.HIGH);
      await service.dispose();

      expect(mockStreamServer.stop).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith("Stream service disposed");
    });

    it("should not throw if stream not running", async () => {
      await expect(service.dispose()).resolves.not.toThrow();
    });

    it("should handle multiple dispose calls", async () => {
      await service.dispose();
      await expect(service.dispose()).resolves.not.toThrow();
    });
  });

  describe("FFmpeg configuration", () => {
    it("should include wallclock timestamps for Eufy stream compatibility", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-use_wallclock_as_timestamps");
      expect(args).toContain("1");
    });

    it("should include increased probe size for front camera support", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-analyzeduration");
      expect(args).toContain("5000000");
      expect(args).toContain("-probesize");
      expect(args).toContain("5000000");
    });

    it("should include H.264 format specification", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-f");
      expect(args).toContain("h264");
    });

    it("should disable audio when no muxed port is available (fallback path)", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-an");
    });

    it("should use fMP4 input when muxed port is available", async () => {
      mockStreamServer.getMuxedPort.mockReturnValue(55555);
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("mp4");
      expect(args).toContain("tcp://127.0.0.1:55555");
      expect(args).not.toContain("-an");
      expect(call.mediaStreamOptions.audio).toEqual({ codec: "aac" });
    });
  });
});
