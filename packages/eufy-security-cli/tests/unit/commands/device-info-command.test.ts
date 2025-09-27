/**
 * Unit tests for DeviceInfoCommand
 */

import { DeviceInfoCommand } from "../../../src/commands/device-info-command";
import { ParsedArgs, CommandContext } from "../../../src/interfaces";
import { testUtils } from "../../test-utils";

// Mock the dependencies
jest.mock("@caplaz/eufy-security-client");

describe("DeviceInfoCommand", () => {
  let mockContext: CommandContext;
  let command: DeviceInfoCommand;
  let mockClient: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock context
    mockContext = {
      logger: testUtils.createMockLogger(),
      verbose: false,
      wsHost: "192.168.1.100:3000",
    };

    // Create mock client
    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      getDevices: jest.fn(),
      getDeviceProperties: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      off: jest.fn(),
    };

    // Mock the constructor
    const MockEufySecurityClient =
      require("@caplaz/eufy-security-client").EufySecurityClient;
    MockEufySecurityClient.mockImplementation(() => mockClient);

    command = new DeviceInfoCommand(mockContext);
  });

  describe("constructor", () => {
    it("should initialize with correct name and description", () => {
      expect(command.name).toBe("device-info");
      expect(command.description).toBe(
        "Show detailed information about a device"
      );
    });
  });

  describe("execute", () => {
    const validArgs: ParsedArgs = {
      wsHost: "ws://localhost:3000",
      cameraSerial: "CAM001",
      port: 0,
      verbose: false,
      help: false,
    };

    it("should validate required arguments", async () => {
      const invalidArgs = { ...validArgs, cameraSerial: "" };

      await expect(command.execute(invalidArgs)).rejects.toThrow(
        "cameraSerial is required for the device-info command"
      );
    });

    it("should connect to WebSocket server", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue({});

      await command.execute(validArgs);

      expect(mockClient.connect).toHaveBeenCalledWith();
    });

    it("should find the correct device", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue({});

      await command.execute(validArgs);

      expect(mockClient.getDevices).toHaveBeenCalled();
    });

    it("should throw error when device not found", async () => {
      mockClient.getDevices.mockResolvedValue([
        { name: "Other Camera", serialNumber: "CAM002" },
      ]);

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Device not found: CAM001"
      );
    });

    it("should retrieve device properties", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      const mockProperties = {
        hasMotionDetection: true,
        hasNightVision: true,
        batteryLevel: 85,
      };

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue(mockProperties);

      await command.execute(validArgs);

      expect(mockClient.getDeviceProperties).toHaveBeenCalledWith("CAM001");
    });

    it("should handle missing device properties gracefully", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockRejectedValue(
        new Error("Properties not available")
      );

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Device Information")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test Camera")
      );

      consoleSpy.mockRestore();
    });

    it("should display device information correctly", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      const mockProperties = {
        hasMotionDetection: true,
        hasNightVision: true,
        batteryLevel: 85,
        videoResolution: "1080p",
      };

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue(mockProperties);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Device Information")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Name: Test Camera")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Serial Number: CAM001")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Type: Camera")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Model: eufyCam 2C")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Hardware Version: 1.0")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Software Version: 1.2.3")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Device Properties")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("batteryLevel: 85")
      );

      consoleSpy.mockRestore();
    });

    it("should display capabilities for camera devices", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      const mockProperties = {
        hasMotionDetection: true,
        hasNightVision: true,
      };

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue(mockProperties);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Device Capabilities")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Video Streaming")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Motion Detection")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Night Vision")
      );

      consoleSpy.mockRestore();
    });

    it("should show usage examples", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue({});

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "eufy-security-cli stream --ws-host 192.168.1.100:3000 --camera-serial CAM001"
        )
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "eufy-security-cli monitor --ws-host 192.168.1.100:3000 --camera-serial CAM001"
        )
      );

      consoleSpy.mockRestore();
    });

    it("should disconnect client in finally block", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      mockClient.getDeviceProperties.mockResolvedValue({});

      await command.execute(validArgs);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("categorizeProperties", () => {
    it("should categorize properties correctly", () => {
      const properties = {
        wifiConnected: true,
        videoResolution: "1080p",
        audioEnabled: true,
        batteryLevel: 85,
        motionDetectionEnabled: true,
        customProperty: "value",
      };

      const result = (command as any).categorizeProperties(properties);

      expect(result.Connection).toHaveProperty("wifiConnected");
      expect(result.Video).toHaveProperty("videoResolution");
      expect(result.Audio).toHaveProperty("audioEnabled");
      expect(result.Power).toHaveProperty("batteryLevel");
      expect(result.Security).toHaveProperty("motionDetectionEnabled");
      expect(result.Other).toHaveProperty("customProperty");
    });
  });

  describe("formatPropertyValue", () => {
    it("should format boolean values", () => {
      expect((command as any).formatPropertyValue(true)).toBe("✅ Enabled");
      expect((command as any).formatPropertyValue(false)).toBe("❌ Disabled");
    });

    it("should format number values", () => {
      expect((command as any).formatPropertyValue(42)).toBe("42");
    });

    it("should format object values", () => {
      const obj = { key: "value" };
      const result = (command as any).formatPropertyValue(obj);
      expect(result).toContain('"key": "value"');
    });

    it("should format string values", () => {
      expect((command as any).formatPropertyValue("test")).toBe("test");
    });
  });
});
