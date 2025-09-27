/**
 * Unit tests for MonitorCommand
 */

import { MonitorCommand } from "../../../src/commands/monitor-command";
import { ParsedArgs, CommandContext } from "../../../src/interfaces";
import { testUtils } from "../../test-utils";

// Mock the dependencies
jest.mock("@caplaz/eufy-security-client");

describe("MonitorCommand", () => {
  let mockContext: CommandContext;
  let command: MonitorCommand;
  let mockClient: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Clear any intervals
    jest.useFakeTimers();

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
      getDeviceStatus: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      off: jest.fn(),
      targetDevice: { serialNumber: "CAM001" },
    };

    // Mock the constructor
    const MockEufySecurityClient =
      require("@caplaz/eufy-security-client").EufySecurityClient;
    MockEufySecurityClient.mockImplementation(() => mockClient);

    command = new MonitorCommand(mockContext);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should initialize with correct name and description", () => {
      expect(command.name).toBe("monitor");
      expect(command.description).toBe(
        "Monitor camera connection status and events"
      );
    });
  });

  describe("execute", () => {
    const validArgs: ParsedArgs = {
      command: "monitor",
      wsHost: "192.168.1.100:3000",
      cameraSerial: "CAM001",
      port: 0,
      verbose: false,
      help: false,
    };

    it("should validate required arguments", async () => {
      const invalidArgs = { ...validArgs, cameraSerial: "" };

      await expect(command.execute(invalidArgs)).rejects.toThrow(
        "cameraSerial is required for the monitor command"
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
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      expect(mockClient.connect).toHaveBeenCalledWith();
    });

    it("should find and validate target device", async () => {
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
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      expect(mockClient.getDevices).toHaveBeenCalled();
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Monitoring device: Test Camera")
      );
    });

    it("should throw error when device not found", async () => {
      mockClient.getDevices.mockResolvedValue([
        { name: "Other Camera", serialNumber: "CAM002" },
      ]);

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Device not found: CAM001"
      );
    });

    it("should setup event monitoring", async () => {
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
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      expect(mockClient.on).toHaveBeenCalledWith(
        "connected",
        expect.any(Function)
      );
      expect(mockClient.on).toHaveBeenCalledWith(
        "disconnected",
        expect.any(Function)
      );
      expect(mockClient.on).toHaveBeenCalledWith(
        "deviceEvent",
        expect.any(Function)
      );
      expect(mockClient.on).toHaveBeenCalledWith(
        "streamStarted",
        expect.any(Function)
      );
      expect(mockClient.on).toHaveBeenCalledWith(
        "streamStopped",
        expect.any(Function)
      );
    });

    it("should start periodic monitoring", async () => {
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
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      // Should have set up interval
      expect((command as any).monitoringInterval).toBeDefined();
      expect((command as any).isMonitoring).toBe(true);
    });

    it("should display monitoring information", async () => {
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
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Eufy Camera Monitor")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Device: Test Camera")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Serial: CAM001")
      );

      consoleSpy.mockRestore();
    });

    it("should handle cleanup on error", async () => {
      mockClient.getDevices.mockRejectedValue(new Error("Connection failed"));

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Connection failed"
      );

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("performStatusCheck", () => {
    beforeEach(() => {
      (command as any).client = mockClient;
      (command as any).isMonitoring = true;
      (command as any).startTime = new Date();
      (command as any).eventCount = 5;
      (command as any).lastEventTime = new Date(Date.now() - 60000); // 1 minute ago
    });

    it("should perform status check when monitoring is active", async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ status: "online" });

      await (command as any).performStatusCheck();

      expect(mockClient.isConnected).toHaveBeenCalled();
      expect(mockClient.getDeviceStatus).toHaveBeenCalledWith("CAM001");
    });

    it("should log status in verbose mode", async () => {
      mockContext.verbose = true;
      mockClient.getDeviceStatus.mockResolvedValue({ status: "online" });

      await (command as any).performStatusCheck();

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Status Check")
      );
    });

    it("should handle device status errors gracefully", async () => {
      mockClient.getDeviceStatus.mockRejectedValue(
        new Error("Status unavailable")
      );

      await (command as any).performStatusCheck();

      // Should not throw, just log debug
      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        "Device status not available:",
        expect.any(Error)
      );
    });

    it("should skip status check when not monitoring", async () => {
      (command as any).isMonitoring = false;

      await (command as any).performStatusCheck();

      expect(mockClient.isConnected).not.toHaveBeenCalled();
    });
  });

  describe("logEvent", () => {
    it("should log events and update counters", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      (command as any).logEvent("Test Event", "Test details");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] Test Event: Test details$/)
      );
      expect((command as any).eventCount).toBe(1);
      expect((command as any).lastEventTime).toBeInstanceOf(Date);

      consoleSpy.mockRestore();
    });

    it("should log debug info in verbose mode", () => {
      mockContext.verbose = true;

      (command as any).logEvent("Test Event", "Test details");

      expect(mockContext.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Event #1: Test Event - Test details")
      );
    });
  });

  describe("cleanup", () => {
    beforeEach(() => {
      (command as any).client = mockClient;
      (command as any).isMonitoring = true;
      (command as any).monitoringInterval = setInterval(() => {}, 1000);
      (command as any).startTime = new Date(Date.now() - 60000); // 1 minute ago
      (command as any).eventCount = 10;
    });

    it("should cleanup resources properly", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await (command as any).cleanup();

      expect((command as any).isMonitoring).toBe(false);
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Monitoring Session Summary")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Total Events: 10")
      );

      consoleSpy.mockRestore();
    });

    it("should handle cleanup errors gracefully", async () => {
      (command as any).client = mockClient;
      (command as any).isMonitoring = true;
      (command as any).monitoringInterval = setInterval(() => {}, 1000);
      (command as any).startTime = new Date(Date.now() - 60000); // 1 minute ago
      (command as any).eventCount = 10;

      mockClient.disconnect.mockRejectedValue(new Error("Disconnect failed"));

      await (command as any).cleanup();

      expect(mockContext.logger.error).toHaveBeenCalledWith(
        "❌ Error during cleanup:",
        expect.any(Error)
      );
    });
  });
});
