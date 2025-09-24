/**
 * Jest setup file for eufy-security-client package tests
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock WebSocket globally for tests
const MockWebSocket = jest.fn().mockImplementation(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  readyState: 1, // OPEN
}));

// Add static properties
(MockWebSocket as any).CLOSED = 3;
(MockWebSocket as any).CLOSING = 2;
(MockWebSocket as any).CONNECTING = 0;
(MockWebSocket as any).OPEN = 1;

global.WebSocket = MockWebSocket as any;

// Mock console methods to reduce noise in tests
const originalConsole = console;
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});
