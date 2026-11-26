/**
 * Tests for H264Parser
 */

import { H264Parser } from "../src/h264-parser";
import { S330_HEVC } from "./fixtures/s330-hevc-nal-units";
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

    it("marks only the IDR slice as a keyframe, not the parameter sets", () => {
      const hevcData = createTestHevcData();
      const nalUnits = parser.extractNALUnitsHevc(hevcData);

      expect(nalUnits.map((nal) => [nal.type, nal.isKeyFrame])).toEqual([
        [32, false],
        [33, false],
        [34, false],
        [19, true],
      ]);
      expect(parser.isKeyFrameHevc(hevcData)).toBe(true);
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
      expect(parser.extractNALUnitsHevc(createInvalidH264Data())).toHaveLength(
        0,
      );
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
      const idrBuf = Buffer.concat([
        startCode,
        Buffer.from([0x26, 0x01, 0x02]),
      ]);
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
      const idrBuf = Buffer.concat([
        startCode,
        Buffer.from([0x26, 0x01, 0x02]),
      ]);
      expect(parser.isKeyFrame(idrBuf)).toBe(false); // wrong!
      expect(parser.isKeyFrameHevc(idrBuf)).toBe(true); // correct
    });

    it("misidentifies H.265 VPS as H.264 unspecified type 0 (not a keyframe)", () => {
      const nalUnits264 = parser.extractNALUnits(createTestHevcVpsData());
      expect(nalUnits264[0].type).toBe(0); // VPS byte0=0x40, 0x40&0x1F=0
      expect(nalUnits264[0].isKeyFrame).toBe(false);

      const nalUnits265 = parser.extractNALUnitsHevc(createTestHevcVpsData());
      expect(nalUnits265[0].type).toBe(32); // correct
      expect(nalUnits265[0].isKeyFrame).toBe(false); // a parameter set, not a picture
    });
  });

  describe("real S330 H.265 NAL units (fixture)", () => {
    const sc = Buffer.from([0x00, 0x00, 0x00, 0x01]);
    const au = (...nals: Buffer[]) =>
      Buffer.concat(nals.flatMap((nal) => [sc, nal]));

    it("parses the keyframe access unit and flags only the IDR slice", () => {
      const nalUnits = parser.extractNALUnitsHevc(
        au(S330_HEVC.vps, S330_HEVC.sps, S330_HEVC.pps, S330_HEVC.idrSlice),
      );
      expect(
        nalUnits.map((n) => [parser.getNALTypeNameHevc(n.type), n.isKeyFrame]),
      ).toEqual([
        ["VPS_NUT", false],
        ["SPS_NUT", false],
        ["PPS_NUT", false],
        ["IDR_W_RADL", true],
      ]);
    });

    it("parses a P-frame as TRAIL_R, not a keyframe (3- and 4-byte start codes)", () => {
      for (const start of [sc, Buffer.from([0x00, 0x00, 0x01])]) {
        const [nal] = parser.extractNALUnitsHevc(
          Buffer.concat([start, S330_HEVC.trailSlice]),
        );
        expect(parser.getNALTypeNameHevc(nal.type)).toBe("TRAIL_R");
        expect(nal.isKeyFrame).toBe(false);
        expect(nal.data.equals(S330_HEVC.trailSlice)).toBe(true);
      }
    });

    it("explains the field symptom: H.264 bytes read as H.265 look like BLA/IDR", () => {
      // H.264 SPS 0x27, PPS 0x28, IDR 0x25, P-slice 0x21 under HEVC rules.
      const h264 = au(
        Buffer.from([0x27, 0x4d, 0x00, 0x2a]),
        Buffer.from([0x28, 0xee, 0x3c, 0x80]),
        Buffer.from([0x25, 0x88, 0x80, 0x10]),
        Buffer.from([0x21, 0x9a, 0x02, 0x04]),
      );
      expect(
        parser
          .extractNALUnitsHevc(h264)
          .map((n) => parser.getNALTypeNameHevc(n.type)),
      ).toEqual(["IDR_W_RADL", "IDR_N_LP", "BLA_N_LP", "BLA_W_LP"]);
      expect(parser.detectParameterSetCodec(h264)).toBe("H264");
    });
  });

  describe("detectParameterSetCodec", () => {
    const sc = Buffer.from([0x00, 0x00, 0x00, 0x01]);

    it("identifies H.265 from the real S330 parameter sets", () => {
      expect(
        parser.detectParameterSetCodec(
          Buffer.concat([sc, S330_HEVC.vps, sc, S330_HEVC.sps]),
        ),
      ).toBe("H265");
      expect(
        parser.detectParameterSetCodec(Buffer.concat([sc, S330_HEVC.pps])),
      ).toBe("H265");
    });

    it("identifies H.264 from an SPS with a known profile_idc", () => {
      for (const sps of [
        [0x67, 0x64, 0x00, 0x33], // High
        [0x67, 0x42, 0x00, 0x1e], // Baseline
        [0x27, 0x4d, 0x00, 0x2a], // Main, nal_ref_idc=1
      ]) {
        expect(
          parser.detectParameterSetCodec(Buffer.concat([sc, Buffer.from(sps)])),
        ).toBe("H264");
      }
    });

    it("returns undefined for slices without parameter sets", () => {
      expect(
        parser.detectParameterSetCodec(
          Buffer.concat([sc, S330_HEVC.trailSlice]),
        ),
      ).toBeUndefined();
      expect(
        parser.detectParameterSetCodec(
          Buffer.concat([sc, Buffer.from([0x21, 0x9a, 0x02, 0x04])]),
        ),
      ).toBeUndefined();
      // nal_ref_idc = 0 or an unknown profile_idc is not trusted as an SPS.
      expect(
        parser.detectParameterSetCodec(
          Buffer.concat([sc, Buffer.from([0x07, 0x64, 0x00, 0x33])]),
        ),
      ).toBeUndefined();
      expect(
        parser.detectParameterSetCodec(
          Buffer.concat([sc, Buffer.from([0x67, 0x05, 0x00, 0x33])]),
        ),
      ).toBeUndefined();
    });
  });
});
