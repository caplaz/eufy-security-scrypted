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
      // Cached frame converted with its own codec, downscaled for thumbnails.
      expect(FFmpegUtils.convertH264ToJPEG).toHaveBeenCalledWith(
        cachedKeyframe,
        3,
        "H265",
        640,
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

    it("returns a placeholder (never throws, never wakes) when no frame is cached yet", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue(null);

      // Must resolve, not reject: a rejection makes Scrypted's Snapshot plugin
      // fall back to the video stream, which would wake the camera.
      const result = await service.takePicture();
      expect(result).toBeDefined();
      expect(mockStreamServer.captureSnapshot).not.toHaveBeenCalled();
      // A real (placeholder) image MediaObject is created.
      expect(sdk.mediaManager.createMediaObject).toHaveBeenCalledWith(
        expect.any(Buffer),
        "image/jpeg",
        { sourceId: serialNumber },
      );
    });

    it("converts a keyframe once and reuses the JPEG until a newer keyframe arrives", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 10,
      });
      await service.takePicture();
      await service.takePicture();
      expect(FFmpegUtils.convertH264ToJPEG).toHaveBeenCalledTimes(1);

      const newer = Buffer.from(cachedKeyframe);
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: newer,
        codec: "H265",
        ageMs: 5,
      });
      await service.takePicture();
      expect(FFmpegUtils.convertH264ToJPEG).toHaveBeenCalledTimes(2);
    });

    it("never rejects on an undecodable keyframe: serves the last good JPEG and does not retry it", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 10,
      });
      await service.takePicture(); // good JPEG cached

      const broken = Buffer.from([0x00, 0x00, 0x01, 0x26]);
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: broken,
        codec: "H265",
        ageMs: 1,
      });
      (FFmpegUtils.convertH264ToJPEG as jest.Mock).mockRejectedValueOnce(
        new Error("Conversion failed"),
      );

      await expect(service.takePicture()).resolves.toBeDefined();
      await service.takePicture();
      // One good conversion + one failed attempt; the broken frame is not retried.
      expect(FFmpegUtils.convertH264ToJPEG).toHaveBeenCalledTimes(2);
      const served = (sdk.mediaManager.createMediaObject as jest.Mock).mock
        .calls;
      expect(served[served.length - 1][0]).toBe(mockJpegData);
    });

    it("serves the motion-event picture when it is newer than the cached keyframe", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 60_000,
      });
      const eventJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x01]);
      service.setEventPicture(eventJpeg);

      await service.takePicture();

      const served = (sdk.mediaManager.createMediaObject as jest.Mock).mock
        .calls;
      expect(served[served.length - 1][0]).toBe(eventJpeg);
    });

    it("ignores a small event crop that follows the full event frame", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 60_000,
      });
      // SOI, then SOF0 with height 360 / width 640, and a 120x160 crop.
      const sof = (width: number, height: number) =>
        Buffer.from([
          0xff,
          0xd8,
          0xff,
          0xc0,
          0x00,
          0x11,
          0x08,
          height >> 8,
          height & 0xff,
          width >> 8,
          width & 0xff,
          0x03,
          0x01,
          0x22,
          0x00,
          0x02,
          0x11,
          0x01,
          0x03,
          0x11,
          0x01,
        ]);
      const fullFrame = sof(640, 360);
      service.setEventPicture(fullFrame);
      service.setEventPicture(sof(120, 160));

      await service.takePicture();

      const served = (sdk.mediaManager.createMediaObject as jest.Mock).mock
        .calls;
      expect(served[served.length - 1][0]).toBe(fullFrame);
    });

    it("ignores an event picture that is not a JPEG", async () => {
      mockStreamServer.getCachedKeyframe = jest.fn().mockReturnValue({
        data: cachedKeyframe,
        codec: "H265",
        ageMs: 60_000,
      });
      service.setEventPicture(Buffer.from("not a jpeg"));

      await service.takePicture();

      const served = (sdk.mediaManager.createMediaObject as jest.Mock).mock
        .calls;
      expect(served[served.length - 1][0]).toBe(mockJpegData);
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
