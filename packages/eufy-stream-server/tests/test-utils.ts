/**
 * Test setup and utilities
 */

import { Logger, ILogObj } from "tslog";

// Create a test logger with minimal output
export const createTestLogger = (): Logger<ILogObj> => {
  return new Logger({
    name: "Test",
    minLevel: 6, // Only errors and above
  });
};

// Create test H.264 data with NAL units
export const createTestH264Data = (): Buffer => {
  // Create a simple H.264 data buffer with start codes and NAL units
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);

  // SPS NAL unit (type 7)
  const spsNal = Buffer.from([
    0x67, 0x42, 0xe0, 0x1e, 0x9a, 0x74, 0x05, 0x03, 0x78,
  ]);

  // PPS NAL unit (type 8)
  const ppsNal = Buffer.from([0x68, 0xce, 0x3c, 0x80]);

  // IDR NAL unit (type 5) - key frame
  const idrNal = Buffer.from([
    0x65, 0x88, 0x84, 0x00, 0x33, 0xff, 0xfe, 0xf6, 0xf0,
  ]);

  return Buffer.concat([
    startCode,
    spsNal,
    startCode,
    ppsNal,
    startCode,
    idrNal,
  ]);
};

// Create test H.264 data with just SPS NAL unit
export const createTestSPSData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  // SPS NAL unit (type 7)
  const spsNal = Buffer.from([
    0x67, 0x42, 0xe0, 0x1e, 0x9a, 0x74, 0x05, 0x03, 0x78,
  ]);
  return Buffer.concat([startCode, spsNal]);
};

// Create test H.264 data with just PPS NAL unit
export const createTestPPSData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  // PPS NAL unit (type 8)
  const ppsNal = Buffer.from([0x68, 0xce, 0x3c, 0x80]);
  return Buffer.concat([startCode, ppsNal]);
};

// Create invalid H.264 data for testing
export const createInvalidH264Data = (): Buffer => {
  return Buffer.from([0xff, 0xff, 0xff, 0xff, 0x12, 0x34, 0x56]);
};

// ─── H.265 / HEVC test helpers ──────────────────────────────────────────────
//
// H.265 NAL unit header (2 bytes):
//   forbidden(1) | nal_unit_type(6) | nuh_layer_id(6) | nuh_temporal_id_plus1(3)
//
// For layer_id=0 and temporal_id_plus1=1:
//   byte0 = (nal_unit_type << 1) | 0
//   byte1 = 0x01

const makeHevcNalHeader = (nalUnitType: number): Buffer =>
  Buffer.from([(nalUnitType << 1) & 0xff, 0x01]);

/** VPS + SPS + IDR_W_RADL keyframe access unit (all three in one buffer). */
export const createTestHevcData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);

  // VPS (type 32)
  const vpsNal = Buffer.concat([makeHevcNalHeader(32), Buffer.from([0xdc, 0x04])]);
  // SPS (type 33)
  const spsNal = Buffer.concat([makeHevcNalHeader(33), Buffer.from([0x01, 0x01, 0x60])]);
  // PPS (type 34)
  const ppsNal = Buffer.concat([makeHevcNalHeader(34), Buffer.from([0xc0, 0xf3])]);
  // IDR_W_RADL (type 19)
  const idrNal = Buffer.concat([makeHevcNalHeader(19), Buffer.from([0x02, 0x80, 0x00])]);

  return Buffer.concat([
    startCode, vpsNal,
    startCode, spsNal,
    startCode, ppsNal,
    startCode, idrNal,
  ]);
};

/** VPS-only buffer (for parameter-set caching tests). */
export const createTestHevcVpsData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([startCode, makeHevcNalHeader(32), Buffer.from([0xdc, 0x04])]);
};

/** SPS-only buffer (H.265 SPS = type 33). */
export const createTestHevcSpsData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([startCode, makeHevcNalHeader(33), Buffer.from([0x01, 0x01])]);
};

/** PPS-only buffer (H.265 PPS = type 34). */
export const createTestHevcPpsData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([startCode, makeHevcNalHeader(34), Buffer.from([0xc0, 0xf3])]);
};

/** Non-keyframe H.265 P-frame (TRAIL_R, type 1). */
export const createTestHevcPFrameData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([startCode, makeHevcNalHeader(1), Buffer.from([0x44, 0x01])]);
};

/** IDR_N_LP (type 20) — tests the other HEVC IDR variant. */
export const createTestHevcIdrNlpData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([startCode, makeHevcNalHeader(20), Buffer.from([0x00, 0x80])]);
};

/** CRA_NUT (type 21) — Clean Random Access, also a keyframe. */
export const createTestHevcCraData = (): Buffer => {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([startCode, makeHevcNalHeader(21), Buffer.from([0x00, 0x80])]);
};

// Wait for a specified time
export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
