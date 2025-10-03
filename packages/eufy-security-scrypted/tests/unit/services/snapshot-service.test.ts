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
      mockMediaObject
    );

    service = new SnapshotService(serialNumber, mockStreamServer, mockLogger);
  });

  describe("getPictureOptions", () => {
    it("should return default picture options", () => {
      const options = service.getPictureOptions();

      expect(options).toEqual({
        timeout: 15000,
      });
    });
  });

  describe("takePicture", () => {
    it("should capture snapshot and convert to JPEG", async () => {
      const result = await service.takePicture();

      expect(mockStreamServer.captureSnapshot).toHaveBeenCalledWith(15000);
      expect(FFmpegUtils.convertH264ToJPEG).toHaveBeenCalledWith(mockH264Data);
      expect(sdk.mediaManager.createMediaObject).toHaveBeenCalledWith(
        mockJpegData,
        "image/jpeg",
        { sourceId: serialNumber }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "📸 Taking snapshot from camera stream"
      );
    });

    it("should use custom timeout from options", async () => {
      await service.takePicture({ timeout: 20000 });

      expect(mockStreamServer.captureSnapshot).toHaveBeenCalledWith(20000);
    });

    it("should log snapshot size", async () => {
      await service.takePicture();

      expect(mockLogger.info).toHaveBeenCalledWith(
        `Captured H.264 keyframe: ${mockH264Data.length} bytes - converting to JPEG`
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        `✅ Snapshot converted to JPEG: ${mockJpegData.length} bytes`
      );
    });

    it("should handle capture errors", async () => {
      const error = new Error("Capture failed");
      mockStreamServer.captureSnapshot.mockRejectedValueOnce(error);

      await expect(service.takePicture()).rejects.toThrow("Capture failed");
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to capture snapshot: ${error}`
      );
    });

    it("should handle conversion errors", async () => {
      const error = new Error("Conversion failed");
      (FFmpegUtils.convertH264ToJPEG as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.takePicture()).rejects.toThrow("Conversion failed");
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Failed to capture snapshot: ${error}`
      );
    });

    it("should work with different timeout values", async () => {
      await service.takePicture({ timeout: 5000 });
      expect(mockStreamServer.captureSnapshot).toHaveBeenCalledWith(5000);

      await service.takePicture({ timeout: 30000 });
      expect(mockStreamServer.captureSnapshot).toHaveBeenCalledWith(30000);
    });
  });

  describe("dispose", () => {
    it("should log disposal", () => {
      service.dispose();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Snapshot service disposed"
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
