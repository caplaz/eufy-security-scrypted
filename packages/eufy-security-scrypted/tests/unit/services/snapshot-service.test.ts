/**
 * Snapshot Service Tests
 */

import { SnapshotService } from "../../../src/services/device/snapshot-service";
import { IStreamServer } from "../../../src/services/device/types";
import { Logger, ILogObj } from "tslog";
import { FFmpegUtils } from "../../../src/utils/ffmpeg-utils";
import { MediaObject } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

// Mock the SDK
jest.mock("@scrypted/sdk", () => ({
  __esModule: true,
  default: {
    mediaManager: {
      createMediaObject: jest.fn(),
    },
  },
}));

// Mock FFmpegUtils
jest.mock("../../../src/utils/ffmpeg-utils");

describe("SnapshotService", () => {
  let service: SnapshotService;
  let mockStreamServer: jest.Mocked<IStreamServer>;
  let mockLogger: jest.Mocked<Logger<ILogObj>>;

  const serialNumber = "TEST-DEVICE-123";
  const mockH264Data = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65]); // H.264 NAL unit
  const mockJpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG header

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
      captureSnapshot: jest.fn().mockResolvedValue(mockH264Data),
      getVideoMetadata: jest.fn().mockReturnValue(null),
      // Default: no fresh cached frame, so takePicture falls back to a live
      // capture. Cache-hit behavior is exercised in its own describe block.
      getCachedKeyframe: jest.fn().mockReturnValue(null),
    } as any;

    // Mock FFmpegUtils static method
    (FFmpegUtils.convertH264ToJPEG as jest.Mock) = jest
      .fn()
      .mockResolvedValue(mockJpegData);

    // Mock SDK mediaManager
    const mockMediaObject: MediaObject = {
      mimeType: "image/jpeg",
    } as any;
    (sdk.mediaManager.createMediaObject as jest.Mock).mockReturnValue(
      mockMediaObject,
    );

    service = new SnapshotService(serialNumber, mockStreamServer, mockLogger);
  });

  describe("getPictureOptions", () => {
    it("should return default picture options", () => {
      const options = service.getPictureOptions();

      expect(options).toEqual({
        timeout: 60000,
      });
    });
  });

  describe("takePicture — cache-only (never wakes the camera)", () => {
    const cachedKeyframe = Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x99,
    ]); // pretend H.265 keyframe

    it("serves the cached frame and converts it to JPEG", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 4200,
      });

      const result = await service.takePicture();

      // Cached frame converted with its own stored codec.
      expect(FFmpegUtils.convertH264ToJPEG).toHaveBeenCalledWith(
        cachedKeyframe,
        2,
        "H265",
      );
      expect(sdk.mediaManager.createMediaObject).toHaveBeenCalledWith(
        mockJpegData,
        "image/jpeg",
        { sourceId: serialNumber },
      );
      expect(result).toBeDefined();
      // The whole point: a thumbnail NEVER wakes the camera.
      expect(mockStreamServer.captureSnapshot).not.toHaveBeenCalled();
    });

    it("requests the cache at any age (never treats a frame as too stale)", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 999999,
      });
      await service.takePicture();
      expect(mockStreamServer.getCachedKeyframe).toHaveBeenCalledWith(
        Number.POSITIVE_INFINITY,
      );
    });

    it("ignores any requested timeout (no on-demand wake path)", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 10,
      });
      await service.takePicture({ timeout: 20000 });
      expect(mockStreamServer.captureSnapshot).not.toHaveBeenCalled();
    });

    it("throws WITHOUT waking the camera when no frame is cached yet", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue(null);

      await expect(service.takePicture()).rejects.toThrow(/No cached frame/);
      expect(mockStreamServer.captureSnapshot).not.toHaveBeenCalled();
    });

    it("propagates conversion errors", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 10,
      });
      const error = new Error("Conversion failed");
      (FFmpegUtils.convertH264ToJPEG as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.takePicture()).rejects.toThrow("Conversion failed");
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to capture snapshot: ${error}`,
      );
    });
  });

  describe("dispose", () => {
    it("should log disposal", () => {
      service.dispose();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Snapshot service disposed",
      );
    });

    it("should handle multiple dispose calls", () => {
      expect(() => {
        service.dispose();
        service.dispose();
      }).not.toThrow();
    });
  });
});
