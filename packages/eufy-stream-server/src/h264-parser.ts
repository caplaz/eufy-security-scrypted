/**
 * H.264 Parser - Simple NAL unit parsing for raw H.264 streams
 */

import { Logger, ILogObj } from "tslog";
import { NALUnit, VideoMetadata } from "./types";

/**
 * Simple H.264 parser for extracting NAL units and basic metadata
 */
export class H264Parser {
  private logger: Logger<ILogObj>;

  constructor(logger: Logger<ILogObj>) {
    this.logger = logger;
  }

  /**
   * Extract NAL units from raw H.264 data
   */
  extractNALUnits(data: Buffer): NALUnit[] {
    const nalUnits: NALUnit[] = [];
    let offset = 0;

    if (data.length < 4) {
      return nalUnits;
    }

    while (offset < data.length) {
      // Find start code (0x00000001 or 0x000001)
      const startCodeInfo = this.findStartCode(data, offset);
      if (!startCodeInfo) {
        break;
      }

      const { position, length } = startCodeInfo;
      const nalStart = position + length;

      if (nalStart >= data.length) {
        break;
      }

      // Find next start code or end of data
      let nalEnd = data.length;
      const nextStartCode = this.findStartCode(data, nalStart);
      if (nextStartCode) {
        nalEnd = nextStartCode.position;
      }

      // Extract NAL unit
      if (nalStart < nalEnd) {
        const nalData = data.subarray(nalStart, nalEnd);
        if (nalData.length > 0) {
          const nalType = nalData[0] & 0x1f;
          const isKeyFrame = this.isKeyFrameNAL(nalType);

          nalUnits.push({
            type: nalType,
            data: nalData,
            isKeyFrame,
          });
        }
      }

      offset = nalEnd;
    }

    return nalUnits;
  }

  /**
   * Find start code in H.264 data
   */
  private findStartCode(
    data: Buffer,
    startOffset: number
  ): { position: number; length: number } | null {
    for (let i = startOffset; i <= data.length - 3; i++) {
      // Check for 4-byte start code (0x00000001)
      if (
        i <= data.length - 4 &&
        data[i] === 0x00 &&
        data[i + 1] === 0x00 &&
        data[i + 2] === 0x00 &&
        data[i + 3] === 0x01
      ) {
        return { position: i, length: 4 };
      }

      // Check for 3-byte start code (0x000001)
      if (data[i] === 0x00 && data[i + 1] === 0x00 && data[i + 2] === 0x01) {
        return { position: i, length: 3 };
      }
    }
    return null;
  }

  /**
   * Check if NAL unit type represents a key frame
   */
  private isKeyFrameNAL(nalType: number): boolean {
    // NAL unit types that contain key frame data:
    // 5 = IDR slice (Instantaneous Decoder Refresh)
    // 7 = SPS (Sequence Parameter Set)
    // 8 = PPS (Picture Parameter Set)
    return nalType === 5 || nalType === 7 || nalType === 8;
  }

  /**
   * Check if data contains a key frame
   */
  isKeyFrame(data: Buffer): boolean {
    const nalUnits = this.extractNALUnits(data);
    return nalUnits.some((nal) => nal.isKeyFrame);
  }

  /**
   * Extract basic video metadata from SPS NAL unit (simplified)
   */
  extractVideoMetadata(data: Buffer): VideoMetadata | null {
    const nalUnits = this.extractNALUnits(data);
    const spsNal = nalUnits.find((nal) => nal.type === 7); // SPS

    if (!spsNal) {
      return null;
    }

    try {
      // Very basic SPS parsing - in production you'd want more robust parsing
      const spsData = spsNal.data;
      if (spsData.length < 4) {
        return null;
      }

      // Extract profile and level (simplified)
      const profile = spsData[1];
      const level = spsData[3];

      return {
        profile: `0x${profile.toString(16).padStart(2, "0")}`,
        level: `0x${level.toString(16).padStart(2, "0")}`,
      };
    } catch (error) {
      this.logger.error("Failed to extract video metadata:", error);
      return null;
    }
  }

  /**
   * Validate H.264 data structure
   */
  validateH264Data(data: Buffer): boolean {
    if (data.length < 4) {
      return false;
    }

    // Check for valid start code
    const hasStartCode = this.findStartCode(data, 0) !== null;
    if (!hasStartCode) {
      return false;
    }

    // Check for at least one valid NAL unit
    const nalUnits = this.extractNALUnits(data);
    return nalUnits.length > 0;
  }

  /**
   * Get NAL unit type name for debugging
   */
  getNALTypeName(type: number): string {
    const names: Record<number, string> = {
      1: "P-slice",
      2: "B-slice",
      3: "I-slice",
      5: "IDR-slice",
      6: "SEI",
      7: "SPS",
      8: "PPS",
      9: "AUD",
    };
    return names[type] || `Unknown(${type})`;
  }
}
