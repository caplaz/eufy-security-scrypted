/**
 * Unit tests for StreamCommand
 */

import { StreamCommand } from "../../../src/commands/stream-command";
import {
  ParsedArgs,
  CommandContext,
  DeviceInfo,
} from "../../../src/interfaces";
import { testUtils } from "../../test-utils";

// Mock the dependencies
jest.mock("@caplaz/eufy-stream-server");
jest.mock("@caplaz/eufy-security-client");

describe("StreamCommand", () => {
  let mockContext: CommandContext;
  let command: StreamCommand;
  let mockClient: any;
  let mockStreamServer: any;

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
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      off: jest.fn(),
      apiManager: {}, // Mock API manager for StreamServer
    };

    // Create mock stream server
    mockStreamServer = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getPort: jest.fn().mockReturnValue(8080),
      on: jest.fn(),
      off: jest.fn(),
    };

    // Mock the constructors
    const MockStreamServer = require("@caplaz/eufy-stream-server").StreamServer;
    MockStreamServer.mockImplementation(() => mockStreamServer);

    const MockEufySecurityClient =
      require("@caplaz/eufy-security-client").EufySecurityClient;
    MockEufySecurityClient.mockImplementation(() => mockClient);

    command = new StreamCommand(mockContext);
  });

  describe("constructor", () => {
    it("should initialize with correct name and description", () => {
      expect(command.name).toBe("stream");
      expect(command.description).toBe("Start streaming from a camera device");
    });
  });

  describe("execute", () => {
    const validArgs: ParsedArgs = {
      command: "stream",
      wsHost: "192.168.1.100:3000",
      cameraSerial: "ABC1234567890",
      port: 8080,
      verbose: false,
      help: false,
    };

    it("should validate required arguments", async () => {
      const invalidArgs = { ...validArgs, cameraSerial: "" };

      await expect(command.execute(invalidArgs)).rejects.toThrow(
        "cameraSerial is required for the stream command"
      );
    });

    it("should connect to WebSocket server", async () => {
      // Mock successful device finding
      mockClient.getDevices.mockResolvedValue([
        {
          name: "Test Camera",
          serialNumber: "ABC1234567890",
          type: "Camera",
          stationSerial: "STATION123",
          model: "Model X",
          hardwareVersion: "1.0",
          softwareVersion: "2.0",
        },
      ]);

      // Mock the execute to be interrupted before keepAlive
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      expect(mockClient.connect).toHaveBeenCalledWith();
    });

    it("should find and validate target device", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "ABC1234567890",
          type: "Camera",
          stationSerial: "STATION123",
          model: "Model X",
          hardwareVersion: "1.0",
          softwareVersion: "2.0",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      expect(mockClient.getDevices).toHaveBeenCalled();
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Found device: Test Camera")
      );
    });

    it("should throw error when device not found", async () => {
      mockClient.getDevices.mockResolvedValue([
        { name: "Other Camera", serialNumber: "XYZ9876543210" },
      ]);

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Camera device not found: ABC1234567890"
      );
    });

    it("should start TCP server with correct configuration", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "ABC1234567890",
          type: "Camera",
          stationSerial: "STATION123",
          model: "Model X",
          hardwareVersion: "1.0",
          softwareVersion: "2.0",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      const MockStreamServer =
        require("@caplaz/eufy-stream-server").StreamServer;
      expect(MockStreamServer).toHaveBeenCalledWith({
        port: 8080,
        debug: false,
        wsClient: mockClient.apiManager,
        serialNumber: "ABC1234567890",
      });

      expect(mockStreamServer.start).toHaveBeenCalled();
    });

    it("should setup event handlers for stream server", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "ABC1234567890",
          type: "Camera",
          stationSerial: "STATION123",
          model: "Model X",
          hardwareVersion: "1.0",
          softwareVersion: "2.0",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      await command.execute(validArgs);

      expect(mockStreamServer.on).toHaveBeenCalledWith(
        "clientConnected",
        expect.any(Function)
      );
      expect(mockStreamServer.on).toHaveBeenCalledWith(
        "clientDisconnected",
        expect.any(Function)
      );
      expect(mockStreamServer.on).toHaveBeenCalledWith(
        "error",
        expect.any(Function)
      );
      expect(mockStreamServer.on).toHaveBeenCalledWith(
        "videoStreamed",
        expect.any(Function)
      );
    });

    it("should display connection information", async () => {
      const mockDevices = [
        {
          name: "Test Camera",
          serialNumber: "ABC1234567890",
          type: "Camera",
          stationSerial: "STATION123",
          model: "Model X",
          hardwareVersion: "1.0",
          softwareVersion: "2.0",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);
      jest.spyOn(command as any, "keepAlive").mockResolvedValue(undefined);

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Eufy Camera Stream Ready")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Camera: Test Camera")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("TCP Server: localhost:8080")
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

  describe("cleanup", () => {
    it("should cleanup resources properly", async () => {
      // Set up the command with initialized resources
      (command as any).client = mockClient;
      (command as any).streamServer = mockStreamServer;

      await (command as any).cleanup();

      expect(mockStreamServer.stop).toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        "✅ Cleanup completed"
      );
    });

    it("should handle cleanup errors gracefully", async () => {
      (command as any).client = mockClient;
      (command as any).streamServer = mockStreamServer;

      mockStreamServer.stop.mockRejectedValue(new Error("Stop failed"));
      mockClient.disconnect.mockRejectedValue(new Error("Disconnect failed"));

      await (command as any).cleanup();

      expect(mockContext.logger.error).toHaveBeenCalledWith(
        "❌ Error during cleanup:",
        expect.any(Error)
      );
    });
  });
});
