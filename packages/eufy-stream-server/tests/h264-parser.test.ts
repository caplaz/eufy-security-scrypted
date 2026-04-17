/**
 * Tests for H264Parser
 */

import { H264Parser } from "../src/h264-parser";
import {
  createTestLogger,
  createTestH264Data,
  createInvalidH264Data,
  createTestHevcData,
  createTestHevcVpsData,
  createTestHevcSpsData,
  createTestHevcPpsData,
  createTestHevcPFrameData,
  createTestHevcIdrNlpData,
  createTestHevcCraData,
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

    it("should return 'Data Partitioning' for NAL type 14", () => {
      expect(parser.getNALTypeName(14)).toBe("Data Partitioning");
    });
  });

  // ─── H.265 / HEVC ──────────────────────────────────────────────────────────

  describe("extractNALUnitsHevc", () => {
    it("extracts VPS, SPS, PPS and IDR with correct types from a full access unit", () => {
      const hevcData = createTestHevcData();
      const nalUnits = parser.extractNALUnitsHevc(hevcData);

      expect(nalUnits).toHaveLength(4);
      expect(nalUnits[0].type).toBe(32); // VPS
      expect(nalUnits[1].type).toBe(33); // SPS
      expect(nalUnits[2].type).toBe(34); // PPS
      expect(nalUnits[3].type).toBe(19); // IDR_W_RADL
    });

    it("marks VPS, SPS, PPS and IDR NAL units as keyframe components", () => {
      const hevcData = createTestHevcData();
      const nalUnits = parser.extractNALUnitsHevc(hevcData);

      nalUnits.forEach((nal) =>
        expect(nal.isKeyFrame).toBe(true)
      );
    });

    it("correctly extracts IDR_N_LP (type 20)", () => {
      const nalUnits = parser.extractNALUnitsHevc(createTestHevcIdrNlpData());
      expect(nalUnits[0].type).toBe(20);
      expect(nalUnits[0].isKeyFrame).toBe(true);
    });

    it("correctly extracts CRA_NUT (type 21) as a keyframe", () => {
      const nalUnits = parser.extractNALUnitsHevc(createTestHevcCraData());
      expect(nalUnits[0].type).toBe(21);
      expect(nalUnits[0].isKeyFrame).toBe(true);
    });

    it("marks TRAIL_R P-frame (type 1) as non-keyframe", () => {
      const nalUnits = parser.extractNALUnitsHevc(createTestHevcPFrameData());
      expect(nalUnits[0].type).toBe(1);
      expect(nalUnits[0].isKeyFrame).toBe(false);
    });

    it("returns empty array for data without start codes", () => {
      expect(parser.extractNALUnitsHevc(createInvalidH264Data())).toHaveLength(0);
    });
  });

  describe("isKeyFrameHevc", () => {
    it("returns true for a full H.265 IDR access unit", () => {
      expect(parser.isKeyFrameHevc(createTestHevcData())).toBe(true);
    });

    it("returns true for IDR_W_RADL alone", () => {
      // createTestHevcData includes VPS+SPS+PPS+IDR; verify IDR alone also works
      const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      // IDR_W_RADL byte0 = 0x26
      const idrBuf = Buffer.concat([startCode, Buffer.from([0x26, 0x01, 0x02])]);
      expect(parser.isKeyFrameHevc(idrBuf)).toBe(true);
    });

    it("returns true for IDR_N_LP", () => {
      expect(parser.isKeyFrameHevc(createTestHevcIdrNlpData())).toBe(true);
    });

    it("returns true for CRA_NUT", () => {
      expect(parser.isKeyFrameHevc(createTestHevcCraData())).toBe(true);
    });

    it("returns false for a TRAIL_R P-frame", () => {
      expect(parser.isKeyFrameHevc(createTestHevcPFrameData())).toBe(false);
    });
  });

  describe("validateHevcData", () => {
    it("validates a well-formed H.265 buffer", () => {
      expect(parser.validateHevcData(createTestHevcData())).toBe(true);
    });

    it("rejects data without start codes", () => {
      expect(parser.validateHevcData(createInvalidH264Data())).toBe(false);
    });

    it("rejects an empty buffer", () => {
      expect(parser.validateHevcData(Buffer.alloc(0))).toBe(false);
    });
  });

  describe("getNALTypeNameHevc", () => {
    it("returns correct names for parameter-set types", () => {
      expect(parser.getNALTypeNameHevc(32)).toBe("VPS_NUT");
      expect(parser.getNALTypeNameHevc(33)).toBe("SPS_NUT");
      expect(parser.getNALTypeNameHevc(34)).toBe("PPS_NUT");
    });

    it("returns correct names for IRAP types", () => {
      expect(parser.getNALTypeNameHevc(19)).toBe("IDR_W_RADL");
      expect(parser.getNALTypeNameHevc(20)).toBe("IDR_N_LP");
      expect(parser.getNALTypeNameHevc(21)).toBe("CRA_NUT");
    });

    it("returns Unknown for unrecognised types", () => {
      expect(parser.getNALTypeNameHevc(99)).toBe("Unknown(99)");
    });
  });

  describe("H.264 parser correctness on H.265 data (demonstrates why codec dispatch matters)", () => {
    it("misidentifies H.265 IDR_W_RADL as non-keyframe (type 6 SEI in H.264 space)", () => {
      const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      // IDR_W_RADL: byte0 = 0x26, H.264 parser sees 0x26 & 0x1F = 6 (SEI)
      const idrBuf = Buffer.concat([startCode, Buffer.from([0x26, 0x01, 0x02])]);
      expect(parser.isKeyFrame(idrBuf)).toBe(false); // wrong!
      expect(parser.isKeyFrameHevc(idrBuf)).toBe(true); // correct
    });

    it("misidentifies H.265 VPS as H.264 unspecified type 0 (not a keyframe)", () => {
      const nalUnits264 = parser.extractNALUnits(createTestHevcVpsData());
      expect(nalUnits264[0].type).toBe(0); // VPS byte0=0x40, 0x40&0x1F=0
      expect(nalUnits264[0].isKeyFrame).toBe(false);

      const nalUnits265 = parser.extractNALUnitsHevc(createTestHevcVpsData());
      expect(nalUnits265[0].type).toBe(32); // correct
      expect(nalUnits265[0].isKeyFrame).toBe(true);
    });
  });
});
