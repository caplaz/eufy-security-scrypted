/**
 * Test utilities for eufy-camera-cli package
 */

export const testUtils = {
  createMockLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),

  createMockClient: () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getDevices: jest.fn().mockResolvedValue([]),
    isConnected: jest.fn().mockReturnValue(true),
    on: jest.fn(),
    off: jest.fn(),
  }),

  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};
