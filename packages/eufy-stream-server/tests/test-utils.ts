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

// Wait for a specified time
export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
