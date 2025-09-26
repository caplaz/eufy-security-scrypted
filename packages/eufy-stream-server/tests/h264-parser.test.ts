/**
 * Tests for H264Parser
 */

import { H264Parser } from "../src/h264-parser";
import {
  createTestLogger,
  createTestH264Data,
  createInvalidH264Data,
} from "./test-utils";

describe("H264Parser", () => {
  let parser: H264Parser;

  beforeEach(() => {
    const logger = createTestLogger();
    parser = new H264Parser(logger);
  });

  describe("extractNALUnits", () => {
    it("should extract NAL units from valid H.264 data", () => {
      const h264Data = createTestH264Data();
      const nalUnits = parser.extractNALUnits(h264Data);

      expect(nalUnits).toHaveLength(3); // SPS, PPS, IDR
      expect(nalUnits[0].type).toBe(7); // SPS
      expect(nalUnits[1].type).toBe(8); // PPS
      expect(nalUnits[2].type).toBe(5); // IDR
    });

    it("should return empty array for invalid data", () => {
      const invalidData = createInvalidH264Data();
      const nalUnits = parser.extractNALUnits(invalidData);

      expect(nalUnits).toHaveLength(0);
    });

    it("should handle empty buffer", () => {
      const nalUnits = parser.extractNALUnits(Buffer.alloc(0));
      expect(nalUnits).toHaveLength(0);
    });
  });

  describe("isKeyFrame", () => {
    it("should detect key frame in H.264 data", () => {
      const h264Data = createTestH264Data();
      const isKeyFrame = parser.isKeyFrame(h264Data);

      expect(isKeyFrame).toBe(true);
    });

    it("should return false for non-key frame data", () => {
      // Create P-frame data (NAL type 1)
      const pFrameData = Buffer.from([
        0x00,
        0x00,
        0x00,
        0x01, // Start code
        0x61,
        0x88,
        0x84,
        0x00, // P-frame NAL
      ]);

      const isKeyFrame = parser.isKeyFrame(pFrameData);
      expect(isKeyFrame).toBe(false);
    });
  });

  describe("validateH264Data", () => {
    it("should validate correct H.264 data", () => {
      const h264Data = createTestH264Data();
      const isValid = parser.validateH264Data(h264Data);

      expect(isValid).toBe(true);
    });

    it("should reject invalid H.264 data", () => {
      const invalidData = createInvalidH264Data();
      const isValid = parser.validateH264Data(invalidData);

      expect(isValid).toBe(false);
    });

    it("should reject empty buffer", () => {
      const isValid = parser.validateH264Data(Buffer.alloc(0));
      expect(isValid).toBe(false);
    });
  });

  describe("getNALTypeName", () => {
    it("should return correct NAL type names", () => {
      expect(parser.getNALTypeName(1)).toBe("P-slice");
      expect(parser.getNALTypeName(5)).toBe("IDR-slice");
      expect(parser.getNALTypeName(7)).toBe("SPS");
      expect(parser.getNALTypeName(8)).toBe("PPS");
      expect(parser.getNALTypeName(99)).toBe("Unknown(99)");
    });
  });
});
