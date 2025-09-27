/**
 * Unit tests for ListDevicesCommand
 */

import { ListDevicesCommand } from "../../../src/commands/list-devices-command";
import { ParsedArgs, CommandContext } from "../../../src/interfaces";
import { testUtils } from "../../test-utils";

// Mock the dependencies
jest.mock("@caplaz/eufy-security-client");

describe("ListDevicesCommand", () => {
  let mockContext: CommandContext;
  let command: ListDevicesCommand;
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
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      off: jest.fn(),
    };

    // Mock the constructor
    const MockEufySecurityClient =
      require("@caplaz/eufy-security-client").EufySecurityClient;
    MockEufySecurityClient.mockImplementation(() => mockClient);

    command = new ListDevicesCommand(mockContext);
  });

  describe("constructor", () => {
    it("should initialize with correct name and description", () => {
      expect(command.name).toBe("list-devices");
      expect(command.description).toBe("List all available camera devices");
    });
  });

  describe("execute", () => {
    const validArgs: ParsedArgs = {
      command: "list-devices",
      wsHost: "192.168.1.100:3000",
      cameraSerial: "",
      port: 0,
      verbose: false,
      help: false,
    };

    it("should connect to WebSocket server", async () => {
      mockClient.getDevices.mockResolvedValue([]);

      await command.execute(validArgs);

      expect(mockClient.connect).toHaveBeenCalledWith();
    });

    it("should handle no devices found", async () => {
      mockClient.getDevices.mockResolvedValue([]);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("❌ No devices found")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "The eufy-security-ws server is not properly configured"
        )
      );

      consoleSpy.mockRestore();
    });

    it("should display devices correctly", async () => {
      const mockDevices = [
        {
          name: "Front Door Camera",
          serialNumber: "CAM001",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
        {
          name: "Backyard Camera",
          serialNumber: "CAM002",
          type: "Camera",
          stationSerial: "STATION001",
          model: "eufyCam 2C",
          hardwareVersion: "1.0",
          softwareVersion: "1.2.3",
        },
        {
          name: "Home Base",
          serialNumber: "STATION001",
          type: "Station",
          stationSerial: "STATION001",
          model: "HomeBase 2",
          hardwareVersion: "2.0",
          softwareVersion: "2.1.0",
        },
      ];

      mockClient.getDevices.mockResolvedValue(mockDevices);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Available Eufy Security Devices")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cameras (2)")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Stations (1)")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Front Door Camera")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Backyard Camera")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Home Base")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Total: 3 device(s) found")
      );

      consoleSpy.mockRestore();
    });

    it("should show usage examples for camera devices", async () => {
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

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "eufy-security-cli stream --ws-host 192.168.1.100:3000 --camera-serial CAM001"
        )
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "eufy-security-cli device-info --ws-host 192.168.1.100:3000 --camera-serial CAM001"
        )
      );

      consoleSpy.mockRestore();
    });

    it("should handle device retrieval errors", async () => {
      mockClient.getDevices.mockRejectedValue(new Error("Connection failed"));

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Failed to retrieve device list: Connection failed"
      );
    });

    it("should disconnect client in finally block", async () => {
      mockClient.getDevices.mockResolvedValue([]);

      await command.execute(validArgs);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should handle disconnect errors gracefully", async () => {
      mockClient.getDevices.mockResolvedValue([]);
      mockClient.disconnect.mockRejectedValue(new Error("Disconnect failed"));

      // Should not throw due to disconnect error
      await expect(command.execute(validArgs)).resolves.toBeUndefined();

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });
});
