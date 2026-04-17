/**
 * NAL Unit Parser — H.264 and H.265/HEVC
 *
 * Provides NAL unit extraction, keyframe detection, and basic structural
 * validation for both H.264 and H.265 raw bitstreams.
 *
 * Both codecs share the same Annex-B start-code framing (0x00000001 /
 * 0x000001), so start-code scanning is reused.  Only the NAL unit header
 * layout differs:
 *
 *   H.264  header: 1 byte  —  forbidden(1) | nal_ref_idc(2) | nal_unit_type(5)
 *   H.265  header: 2 bytes —  forbidden(1) | nal_unit_type(6) | layer_id(6) | temporal_id(3)
 *
 * For H.265 the type is therefore extracted as `(byte0 >> 1) & 0x3F`.
 */

import { Logger, ILogObj } from "tslog";
import { NALUnit } from "./types";

export class H264Parser {
  private logger: Logger<ILogObj>;

  constructor(logger: Logger<ILogObj>) {
    this.logger = logger;
  }

  // ─── Shared start-code logic ───────────────────────────────────────────────

  /**
   * Scan for an Annex-B start code (0x00000001 or 0x000001) starting at
   * `startOffset`.  Returns position + length of the start code, or null.
   */
  private findStartCode(
    data: Buffer,
    startOffset: number
  ): { position: number; length: number } | null {
    for (let i = startOffset; i <= data.length - 3; i++) {
      if (
        i <= data.length - 4 &&
        data[i] === 0x00 &&
        data[i + 1] === 0x00 &&
        data[i + 2] === 0x00 &&
        data[i + 3] === 0x01
      ) {
        return { position: i, length: 4 };
      }
      if (data[i] === 0x00 && data[i + 1] === 0x00 && data[i + 2] === 0x01) {
        return { position: i, length: 3 };
      }
    }
    return null;
  }

  /**
   * Walk all Annex-B start codes and call `extractType` for each NAL payload's
   * first byte(s) to obtain the codec-specific NAL type.
   */
  private scanNALUnits(
    data: Buffer,
    extractType: (nalPayload: Buffer) => number,
    isKeyFrameType: (nalType: number) => boolean
  ): NALUnit[] {
    const nalUnits: NALUnit[] = [];
    let offset = 0;

    if (data.length < 4) return nalUnits;

    while (offset < data.length) {
      const startCodeInfo = this.findStartCode(data, offset);
      if (!startCodeInfo) break;

      const nalStart = startCodeInfo.position + startCodeInfo.length;
      if (nalStart >= data.length) break;

      const nextStartCode = this.findStartCode(data, nalStart);
      const nalEnd = nextStartCode ? nextStartCode.position : data.length;

      if (nalStart < nalEnd) {
        const nalData = data.subarray(nalStart, nalEnd);
        if (nalData.length > 0) {
          const nalType = extractType(nalData);
          nalUnits.push({ type: nalType, data: nalData, isKeyFrame: isKeyFrameType(nalType) });
        }
      }

      offset = nalEnd;
    }

    return nalUnits;
  }

  // ─── H.264 ─────────────────────────────────────────────────────────────────

  /**
   * Extract the H.264 NAL unit type from the first byte of the payload.
   * H.264 header: forbidden(1) | nal_ref_idc(2) | nal_unit_type(5)
   */
  private extractH264Type(nalPayload: Buffer): number {
    return nalPayload[0] & 0x1f;
  }

  /**
   * H.264 keyframe NAL types:
   * - 5  IDR slice (the actual keyframe)
   * - 7  SPS (Sequence Parameter Set)
   * - 8  PPS (Picture Parameter Set)
   */
  private isKeyFrameNAL(nalType: number): boolean {
    return nalType === 5 || nalType === 7 || nalType === 8;
  }

  extractNALUnits(data: Buffer): NALUnit[] {
    return this.scanNALUnits(data, this.extractH264Type.bind(this), this.isKeyFrameNAL.bind(this));
  }

  isKeyFrame(data: Buffer): boolean {
    return this.extractNALUnits(data).some((nal) => nal.isKeyFrame);
  }

  validateH264Data(data: Buffer): boolean {
    if (data.length < 4) return false;
    if (this.findStartCode(data, 0) === null) return false;
    return this.extractNALUnits(data).length > 0;
  }

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
    return names[type] ?? `Unknown(${type})`;
  }

  // ─── H.265 / HEVC ──────────────────────────────────────────────────────────

  /**
   * Extract the H.265 NAL unit type from the first byte of the payload.
   *
   * H.265 NAL header (2 bytes, 16 bits):
   *   forbidden(1) | nal_unit_type(6) | nuh_layer_id(6) | nuh_temporal_id_plus1(3)
   *
   * The 6-bit type occupies bits [14:9], i.e. bits [6:1] of the first byte:
   *   nal_unit_type = (byte0 >> 1) & 0x3F
   */
  private extractHevcType(nalPayload: Buffer): number {
    return (nalPayload[0] >> 1) & 0x3f;
  }

  /**
   * H.265 keyframe NAL types.
   *
   * IRAP (Intra Random Access Point) frames — all self-decodable without prior frames:
   *   16  BLA_W_LP
   *   17  BLA_W_RADL
   *   18  BLA_N_LP
   *   19  IDR_W_RADL
   *   20  IDR_N_LP
   *   21  CRA_NUT  (Clean Random Access)
   *   22  RSV_IRAP_VCL22
   *   23  RSV_IRAP_VCL23
   *
   * Parameter sets (sent before every IDR access unit):
   *   32  VPS_NUT  (Video Parameter Set)
   *   33  SPS_NUT  (Sequence Parameter Set)
   *   34  PPS_NUT  (Picture Parameter Set)
   */
  private isKeyFrameHevcNAL(nalType: number): boolean {
    return (nalType >= 16 && nalType <= 23) || (nalType >= 32 && nalType <= 34);
  }

  extractNALUnitsHevc(data: Buffer): NALUnit[] {
    return this.scanNALUnits(data, this.extractHevcType.bind(this), this.isKeyFrameHevcNAL.bind(this));
  }

  isKeyFrameHevc(data: Buffer): boolean {
    return this.extractNALUnitsHevc(data).some((nal) => nal.isKeyFrame);
  }

  /**
   * Structural validation for H.265 data — identical rules to H.264 since
   * both use Annex-B start codes.
   */
  validateHevcData(data: Buffer): boolean {
    if (data.length < 4) return false;
    if (this.findStartCode(data, 0) === null) return false;
    return this.extractNALUnitsHevc(data).length > 0;
  }

  getNALTypeNameHevc(type: number): string {
    const names: Record<number, string> = {
      0: "TRAIL_N",
      1: "TRAIL_R",
      2: "TSA_N",
      3: "TSA_R",
      4: "STSA_N",
      5: "STSA_R",
      6: "RADL_N",
      7: "RADL_R",
      8: "RASL_N",
      9: "RASL_R",
      16: "BLA_W_LP",
      17: "BLA_W_RADL",
      18: "BLA_N_LP",
      19: "IDR_W_RADL",
      20: "IDR_N_LP",
      21: "CRA_NUT",
      32: "VPS_NUT",
      33: "SPS_NUT",
      34: "PPS_NUT",
      35: "AUD_NUT",
      36: "EOS_NUT",
      37: "EOB_NUT",
      38: "FD_NUT",
      39: "PREFIX_SEI_NUT",
      40: "SUFFIX_SEI_NUT",
    };
    return names[type] ?? `Unknown(${type})`;
  }
}
