/**
 * H.264 Parser - Simple NAL unit parsing for raw H.264 streams
 *
 * This parser provides essential H.264 parsing capabilities including NAL unit
 * extraction, keyframe detection, and basic validation. It's designed for
 * streaming scenarios where full H.264 parsing is not required.
 */

import { Logger, ILogObj } from "tslog";
import { NALUnit } from "./types";

/**
 * Simple H.264 parser for extracting NAL units and basic metadata
 *
 * Provides methods for parsing H.264 stream data, identifying NAL units,
 * detecting keyframes, and validating data structure integrity.
 *
 * @example
 * ```typescript
 * const parser = new H264Parser(logger);
 * const nalUnits = parser.extractNALUnits(h264Buffer);
 * const isKeyFrame = parser.isKeyFrame(h264Buffer);
 * ```
 */
export class H264Parser {
  private logger: Logger<ILogObj>;

  /**
   * Creates a new H264Parser instance
   *
   * @param logger - Logger instance compatible with tslog's Logger<ILogObj> interface
   */
  constructor(logger: Logger<ILogObj>) {
    this.logger = logger;
  }

  /**
   * Extract NAL units from raw H.264 data
   *
   * Scans the H.264 data buffer for start codes (0x000001 or 0x00000001)
   * and extracts all NAL units with their type information and keyframe status.
   *
   * @param data - Raw H.264 data buffer
   * @returns Array of extracted NAL units with type and keyframe information
   *
   * @example
   * ```typescript
   * const nalUnits = parser.extractNALUnits(h264Buffer);
   * console.log(`Found ${nalUnits.length} NAL units`);
   * nalUnits.forEach(nal => {
   *   console.log(`Type: ${nal.type}, KeyFrame: ${nal.isKeyFrame}`);
   * });
   * ```
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
   * Find H.264 start code in data buffer
   *
   * Searches for 4-byte (0x00000001) or 3-byte (0x000001) start codes
   * that mark the beginning of NAL units in H.264 streams.
   *
   * @param data - Buffer to search for start codes
   * @param startOffset - Offset position to begin searching from
   * @returns Object with position and length of start code, or null if not found
   * @private
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
   * Check if NAL unit type represents a key frame component
   *
   * Key frames contain:
   * - Type 5: IDR slice (Instantaneous Decoder Refresh) - the actual keyframe
   * - Type 7: SPS (Sequence Parameter Set) - decoder initialization
   * - Type 8: PPS (Picture Parameter Set) - picture parameters
   *
   * @param nalType - NAL unit type number (0-31)
   * @returns true if NAL type is part of a keyframe
   * @private
   */
  private isKeyFrameNAL(nalType: number): boolean {
    // NAL unit types that contain key frame data:
    // 5 = IDR slice (Instantaneous Decoder Refresh)
    // 7 = SPS (Sequence Parameter Set)
    // 8 = PPS (Picture Parameter Set)
    return nalType === 5 || nalType === 7 || nalType === 8;
  }

  /**
   * Check if H.264 data buffer contains a keyframe
   *
   * A keyframe (I-frame/IDR frame) is a self-contained frame that doesn't
   * depend on other frames. Essential for stream initialization and seeking.
   *
   * @param data - Raw H.264 data buffer
   * @returns true if data contains keyframe NAL units (IDR, SPS, or PPS)
   *
   * @example
   * ```typescript
   * if (parser.isKeyFrame(videoData)) {
   *   console.log('Keyframe detected - safe to start decoding');
   * }
   * ```
   */
  isKeyFrame(data: Buffer): boolean {
    const nalUnits = this.extractNALUnits(data);
    return nalUnits.some((nal) => nal.isKeyFrame);
  }

  /**
   * Validate H.264 data structure integrity
   *
   * Performs basic validation to ensure data contains valid H.264 structure:
   * - Minimum length check (at least 4 bytes for start code)
   * - Presence of valid start code
   * - At least one extractable NAL unit
   *
   * @param data - Buffer to validate as H.264 data
   * @returns true if data appears to be valid H.264, false otherwise
   *
   * @example
   * ```typescript
   * if (!parser.validateH264Data(buffer)) {
   *   console.error('Invalid H.264 data received');
   *   return;
   * }
   * ```
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
   * Get human-readable name for NAL unit type
   *
   * Converts numeric NAL type to descriptive string for logging and debugging.
   * Returns "Unknown(type)" for unrecognized types.
   *
   * @param type - NAL unit type number (0-31)
   * @returns Human-readable NAL type name
   *
   * @example
   * ```typescript
   * const nalUnits = parser.extractNALUnits(data);
   * nalUnits.forEach(nal => {
   *   console.log(`NAL Unit: ${parser.getNALTypeName(nal.type)}`);
   * });
   * ```
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
      14: "Data Partitioning",
    };
    return names[type] || `Unknown(${type})`;
  }
}
