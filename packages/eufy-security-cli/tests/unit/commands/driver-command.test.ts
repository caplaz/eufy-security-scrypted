/**
 * Unit tests for DriverCommand
 */

import { DriverCommand } from "../../../src/commands/driver-command";
import { ParsedArgs, CommandContext } from "../../../src/interfaces";
import { testUtils } from "../../test-utils";

// Mock the dependencies
jest.mock("@caplaz/eufy-security-client");

describe("DriverCommand", () => {
  let mockContext: CommandContext;
  let command: DriverCommand;
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

    // Create mock client with apiManager
    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      apiManager: {
        startListening: jest.fn().mockResolvedValue({
          state: {
            driver: {
              connected: true,
            },
          },
        }),
        connectDriver: jest.fn().mockResolvedValue(undefined),
        getPendingCaptcha: jest.fn().mockReturnValue(null),
        clearPendingCaptcha: jest.fn(),
        getPendingMfa: jest.fn().mockReturnValue(null),
        clearPendingMfa: jest.fn(),
        commands: {
          driver: jest.fn().mockReturnValue({
            setCaptcha: jest.fn().mockResolvedValue(undefined),
            setVerifyCode: jest.fn().mockResolvedValue(undefined),
          }),
        },
      },
    };

    // Mock the constructor
    const MockEufySecurityClient =
      require("@caplaz/eufy-security-client").EufySecurityClient;
    MockEufySecurityClient.mockImplementation(() => mockClient);

    command = new DriverCommand(mockContext);
  });

  describe("constructor", () => {
    it("should initialize with correct name and description", () => {
      expect(command.name).toBe("driver");
      expect(command.description).toBe(
        "Manage Eufy Security driver connections"
      );
    });
  });

  describe("execute - status subcommand", () => {
    const validArgs: ParsedArgs = {
      command: "driver",
      subcommand: "status",
      wsHost: "192.168.1.100:3000",
      cameraSerial: "",
      port: 0,
      verbose: false,
      help: false,
    };

    it("should connect to WebSocket server", async () => {
      mockClient.isConnected.mockReturnValue(true);

      await command.execute(validArgs);

      expect(mockClient.connect).toHaveBeenCalledWith();
    });

    it("should display connected status", async () => {
      mockClient.isConnected.mockReturnValue(true);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("🔍 Eufy Security Driver Status")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("✅ Status: FULLY CONNECTED")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "You can now use other CLI commands to interact with your devices."
        )
      );

      consoleSpy.mockRestore();
    });

    it("should display disconnected status", async () => {
      mockClient.isConnected.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("🔍 Eufy Security Driver Status")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("❌ Status: WEBSOCKET DISCONNECTED")
      );

      consoleSpy.mockRestore();
    });

    it("should handle connection errors", async () => {
      mockClient.connect.mockRejectedValue(new Error("Connection refused"));

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Failed to connect to WebSocket server"
      );
    });

    it("should disconnect client in finally block", async () => {
      mockClient.isConnected.mockReturnValue(true);

      await command.execute(validArgs);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should handle disconnect errors gracefully", async () => {
      mockClient.isConnected.mockReturnValue(true);
      mockClient.disconnect.mockRejectedValue(new Error("Disconnect failed"));

      // Should not throw due to disconnect error
      await expect(command.execute(validArgs)).resolves.toBeUndefined();

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("execute - connect subcommand", () => {
    const validArgs: ParsedArgs = {
      command: "driver",
      subcommand: "connect",
      wsHost: "192.168.1.100:3000",
      cameraSerial: "",
      port: 0,
      verbose: false,
      help: false,
    };

    it("should connect to WebSocket server", async () => {
      mockClient.isConnected.mockReturnValue(true);

      await command.execute(validArgs);

      expect(mockClient.connect).toHaveBeenCalledWith();
    });

    it("should display success message when connected", async () => {
      mockClient.isConnected.mockReturnValue(true);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await command.execute(validArgs);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("🔗 Eufy Security Driver Connection")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("✅ Connection Successful: FULLY CONNECTED")
      );

      consoleSpy.mockRestore();
    });

    it("should throw error when connection fails", async () => {
      mockClient.isConnected.mockReturnValue(false);

      await expect(command.execute(validArgs)).rejects.toThrow(
        "❌ WebSocket connection failed"
      );
    });

    it("should handle connection errors", async () => {
      mockClient.connect.mockRejectedValue(new Error("Connection refused"));

      await expect(command.execute(validArgs)).rejects.toThrow(
        "Failed to connect to WebSocket server"
      );
    });

    it("should disconnect client in finally block", async () => {
      mockClient.isConnected.mockReturnValue(true);

      await command.execute(validArgs);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should handle disconnect errors gracefully", async () => {
      mockClient.isConnected.mockReturnValue(true);
      mockClient.disconnect.mockRejectedValue(new Error("Disconnect failed"));

      // Should not throw due to disconnect error
      await expect(command.execute(validArgs)).resolves.toBeUndefined();

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("execute - invalid subcommand", () => {
    it("should throw error for missing subcommand", async () => {
      const args: ParsedArgs = {
        command: "driver",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      await expect(command.execute(args)).rejects.toThrow(
        "Driver command requires a subcommand. Use 'driver status' or 'driver connect'"
      );
    });

    it("should throw error for unknown subcommand", async () => {
      const args: ParsedArgs = {
        command: "driver",
        subcommand: "invalid",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      await expect(command.execute(args)).rejects.toThrow(
        "Unknown driver subcommand: invalid. Valid subcommands: status, connect, set_captcha, set_verify_code"
      );
    });
  });
});
