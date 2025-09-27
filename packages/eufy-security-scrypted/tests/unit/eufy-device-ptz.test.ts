/**
 * Unit tests for EufyDevice PTZ (Pan/Tilt/Zoom) functionality
 * Tests the dynamic PTZ capabilities detection and command execution
 */

import { EufyDevice } from "../../src/eufy-device";
import {
  EufyWebSocketClient,
  PanTiltDirection,
  getDeviceCapabilities,
} from "@caplaz/eufy-security-client";
import { DebugLogger } from "../../src/utils/debug-logger";

// Mock the ScryptedDeviceBase
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

// Mock the StreamServer
jest.mock("@caplaz/eufy-stream-server", () => ({
  StreamServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getPort: jest.fn().mockReturnValue(8080),
  })),
}));

// Mock the debug logger
jest.mock("../../src/utils/debug-logger", () => ({
  createDebugLogger: jest.fn(),
  DebugLogger: jest.fn().mockImplementation(() => ({
    i: jest.fn(),
    d: jest.fn(),
    w: jest.fn(),
    e: jest.fn(),
  })),
  isDebugEnabled: jest.fn().mockReturnValue(false),
}));

describe("EufyDevice PTZ Functionality", () => {
  let mockWsClient: jest.Mocked<EufyWebSocketClient>;
  let mockLogger: jest.Mocked<DebugLogger>;
  let device: EufyDevice;
  let mockDeviceCommands: any;

  beforeEach(() => {
    // Create mock device commands
    mockDeviceCommands = {
      panAndTilt: jest.fn().mockResolvedValue(undefined),
      getProperties: jest.fn().mockResolvedValue({
        properties: {
          type: 31, // DeviceType that supports pan/tilt (e.g., Indoor PT Camera)
          name: "Test Camera",
          serialNumber: "TEST123",
        },
      }),
    };

    // Create mocks
    mockWsClient = {
      commands: {
        device: jest.fn().mockReturnValue(mockDeviceCommands),
      },
      addEventListener: jest.fn(),
      removeEventListenersBySerialNumber: jest.fn(),
    } as any;

    mockLogger = {
      i: jest.fn(),
      d: jest.fn(),
      w: jest.fn(),
      e: jest.fn(),
    } as any;

    // Mock the createDebugLogger function
    (
      require("../../src/utils/debug-logger").createDebugLogger as jest.Mock
    ).mockReturnValue(mockLogger);

    // Create device instance
    device = new EufyDevice("test-device", mockWsClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("PTZ Capabilities Detection", () => {
    test("should enable PTZ capabilities for pan/tilt capable devices", () => {
      // Mock device type that supports pan/tilt (e.g., Indoor PT Camera)
      const mockProperties = { type: 31 }; // DeviceType that supports pan/tilt
      (device as any).latestProperties = mockProperties;

      // Call updatePtzCapabilities
      (device as any).updatePtzCapabilities();

      // Check that PTZ capabilities are enabled
      expect(device.ptzCapabilities!.pan).toBe(true);
      expect(device.ptzCapabilities!.tilt).toBe(true);
      expect(device.ptzCapabilities!.zoom).toBe(false);
    });

    test("should disable PTZ capabilities for non-pan/tilt devices", () => {
      // Mock device type that doesn't support pan/tilt (e.g., basic camera)
      const mockProperties = { type: 1 }; // DeviceType.CAMERA (basic camera)
      (device as any).latestProperties = mockProperties;

      // Call updatePtzCapabilities
      (device as any).updatePtzCapabilities();

      // Check that PTZ capabilities are disabled
      expect(device.ptzCapabilities!.pan).toBe(false);
      expect(device.ptzCapabilities!.tilt).toBe(false);
      expect(device.ptzCapabilities!.zoom).toBe(false);
    });

    test("should handle undefined device type gracefully", () => {
      // Mock undefined device type
      const mockProperties = { type: undefined };
      (device as any).latestProperties = mockProperties;

      // Call updatePtzCapabilities
      (device as any).updatePtzCapabilities();

      // Check that PTZ capabilities are disabled
      expect(device.ptzCapabilities!.pan).toBe(false);
      expect(device.ptzCapabilities!.tilt).toBe(false);
      expect(device.ptzCapabilities!.zoom).toBe(false);
    });

    test("should update PTZ capabilities when properties are loaded", async () => {
      // Mock device with pan/tilt support
      const mockApiResponse = {
        properties: {
          type: 31, // DeviceType that supports pan/tilt
          name: "PT Camera",
          serialNumber: "PT123",
        },
      };

      mockDeviceCommands.getProperties.mockResolvedValue(mockApiResponse);

      // Call loadInitialProperties
      await (device as any).loadInitialProperties();

      // Check that PTZ capabilities are enabled
      expect(device.ptzCapabilities!.pan).toBe(true);
      expect(device.ptzCapabilities!.tilt).toBe(true);
    });

    test("should update PTZ capabilities on refresh", async () => {
      // Mock device with pan/tilt support
      const mockApiResponse = {
        properties: {
          type: 31, // DeviceType that supports pan/tilt
          name: "PT Camera",
          serialNumber: "PT123",
        },
      };

      mockDeviceCommands.getProperties.mockResolvedValue(mockApiResponse);

      // Set initial properties without PT support
      (device as any).latestProperties = { type: 1 };

      // Call refresh
      await device.refresh();

      // Check that PTZ capabilities are now enabled
      expect(device.ptzCapabilities!.pan).toBe(true);
      expect(device.ptzCapabilities!.tilt).toBe(true);
    });
  });

  describe("PTZ Command Execution", () => {
    beforeEach(() => {
      // Set up device with PTZ capabilities
      (device as any).latestProperties = { type: 31 }; // PT capable device
      (device as any).updatePtzCapabilities();
    });

    test("should execute tilt up command correctly", async () => {
      // Execute tilt up command
      await device.ptzCommand({ tilt: 1 });

      // Verify the correct API call was made
      expect(mockDeviceCommands.panAndTilt).toHaveBeenCalledWith({
        direction: PanTiltDirection.UP,
      });
    });

    test("should execute tilt down command correctly", async () => {
      // Execute tilt down command
      await device.ptzCommand({ tilt: -1 });

      // Verify the correct API call was made
      expect(mockDeviceCommands.panAndTilt).toHaveBeenCalledWith({
        direction: PanTiltDirection.DOWN,
      });
    });

    test("should execute pan left command correctly", async () => {
      // Execute pan left command
      await device.ptzCommand({ pan: -1 });

      // Verify the correct API call was made
      expect(mockDeviceCommands.panAndTilt).toHaveBeenCalledWith({
        direction: PanTiltDirection.LEFT,
      });
    });

    test("should execute pan right command correctly", async () => {
      // Execute pan right command
      await device.ptzCommand({ pan: 1 });

      // Verify the correct API call was made
      expect(mockDeviceCommands.panAndTilt).toHaveBeenCalledWith({
        direction: PanTiltDirection.RIGHT,
      });
    });

    test("should throw error for unsupported commands", () => {
      // Execute command with no pan or tilt values
      expect(() => device.ptzCommand({})).toThrow("Method not implemented.");
    });

    test("should prioritize tilt over pan when both are provided", async () => {
      // Execute command with both pan and tilt
      await device.ptzCommand({ pan: 1, tilt: -1 });

      // Should execute tilt command (processed first)
      expect(mockDeviceCommands.panAndTilt).toHaveBeenCalledWith({
        direction: PanTiltDirection.DOWN,
      });
      expect(mockDeviceCommands.panAndTilt).toHaveBeenCalledTimes(1);
    });
  });

  describe("Device Capability Integration", () => {
    test("should correctly identify pan/tilt capable devices", () => {
      // Test various device types
      const testCases = [
        { type: 31, expectedPanTilt: true }, // Pan/tilt capable device
        { type: 1, expectedPanTilt: false }, // Basic camera
        { type: 0, expectedPanTilt: false }, // Unknown
      ];

      testCases.forEach(({ type, expectedPanTilt }) => {
        const capabilities = getDeviceCapabilities(type);
        expect(capabilities.panTilt).toBe(expectedPanTilt);
      });
    });

    test("should handle edge cases in capability detection", () => {
      // Test with invalid device types
      expect(getDeviceCapabilities(-1).panTilt).toBe(false);
      expect(getDeviceCapabilities(99999).panTilt).toBe(false);
      expect(getDeviceCapabilities(NaN).panTilt).toBe(false);
    });
  });
});
