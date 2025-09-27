/**
 * Jest setup file for @scrypted/eufy-security-scrypted package tests
 */

// Increase timeout for tests
jest.setTimeout(30000);

// Mock WebSocket globally for tests
const mockWebSocket = jest.fn().mockImplementation(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  readyState: 1, // OPEN
}));

// Add static properties
(mockWebSocket as any).CLOSED = 3;
(mockWebSocket as any).CLOSING = 2;
(mockWebSocket as any).CONNECTING = 0;
(mockWebSocket as any).OPEN = 1;

global.WebSocket = mockWebSocket as any;

// Mock Scrypted SDK
jest.mock("@scrypted/sdk", () => ({
  ScryptedDeviceBase: class {
    ptzCapabilities = { pan: false, tilt: false, zoom: false };
  },
  deviceManager: {
    onDevicesChanged: jest.fn(),
  },
  sdk: {
    mediaManager: {
      createFFmpegMediaObject: jest.fn(),
    },
  },
}));

// Mock device-utils to avoid import issues
jest.mock("../src/utils/device-utils", () => ({
  DeviceUtils: {
    genericDeviceInformation: jest.fn().mockReturnValue([]),
    allWriteableDeviceProperties: jest.fn().mockReturnValue([]),
  },
}));

// Mock debug-logger
jest.mock("../src/utils/debug-logger", () => ({
  createDebugLogger: jest.fn().mockReturnValue({
    i: jest.fn(),
    d: jest.fn(),
    w: jest.fn(),
    e: jest.fn(),
    log: jest.fn(),
  }),
  isDebugEnabled: jest.fn().mockReturnValue(false), // Default to debug disabled for tests
  initializeDebugLogger: jest.fn(),
  setDebugEnabled: jest.fn(),
}));

// Mock console methods to reduce noise in tests
const originalConsoleMethods = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleMethods.log;
  console.warn = originalConsoleMethods.warn;
  console.error = originalConsoleMethods.error;
});
