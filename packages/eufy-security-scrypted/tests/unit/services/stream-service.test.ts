/**
 * Stream Service Tests
 */

import { StreamService } from "../../../src/services/device/stream-service";
import { IStreamServer } from "../../../src/services/device/types";
import { Logger, ILogObj } from "tslog";
import { VideoQuality } from "@caplaz/eufy-security-client";
import { MediaObject } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

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
    } as any;

    // Mock SDK mediaManager
    const mockMediaObject: MediaObject = {
      mimeType: "video/h264",
    } as any;
    (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mockResolvedValue(
      mockMediaObject
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
    it("should return stream options with correct dimensions", () => {
      const options = service.getVideoStreamOptions(VideoQuality.HIGH);

      expect(options).toHaveLength(1);
      expect(options[0]).toEqual({
        id: "p2p",
        name: "P2P Stream",
        container: "h264",
        video: {
          codec: "h264",
          width: 1920,
          height: 1080,
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
        `Stream server is listening on port ${mockPort}`
      );
    });

    it("should throw error if port is not available", async () => {
      mockStreamServer.getPort.mockReturnValueOnce(undefined);

      await expect(service.getVideoStream(VideoQuality.HIGH)).rejects.toThrow(
        "Failed to get stream server port"
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
        })
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
        })
      );
    });

    it("should handle stream server start errors", async () => {
      const error = new Error("Failed to start server");
      mockStreamServer.start.mockRejectedValueOnce(error);

      await expect(service.getVideoStream(VideoQuality.HIGH)).rejects.toThrow(
        "Failed to start server"
      );
    });

    it("should return media object", async () => {
      const result = await service.getVideoStream(VideoQuality.HIGH);

      expect(result).toBeDefined();
      expect(result.mimeType).toBe("video/h264");
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
    it("should include low-latency flags", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-fflags");
      expect(args).toContain(
        "+nobuffer+fastseek+flush_packets+discardcorrupt+igndts+genpts"
      );
      expect(args).toContain("-flags");
      expect(args).toContain("low_delay");
    });

    it("should include hardware acceleration", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-hwaccel");
      expect(args).toContain("auto");
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

    it("should include error tolerance for battery cameras", async () => {
      await service.getVideoStream(VideoQuality.HIGH);

      const call = (sdk.mediaManager.createFFmpegMediaObject as jest.Mock).mock
        .calls[0][0];
      const args = call.inputArguments;

      expect(args).toContain("-err_detect");
      expect(args).toContain("ignore_err+crccheck");
    });
  });
});
