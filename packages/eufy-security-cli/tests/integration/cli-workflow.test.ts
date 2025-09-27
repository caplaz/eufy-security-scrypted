/**
 * CLI Workflow Integration Tests
 * Tests complete CLI workflows and command interactions
 */

import { CLIApplication } from "../../src/cli-application";
import { CLIParser } from "../../src/cli-parser";
import { testUtils } from "../test-utils";

// Mock the dependencies to avoid actual network calls
jest.mock("@caplaz/eufy-security-client");
jest.mock("@caplaz/eufy-stream-server");

describe("CLI Workflow Integration", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("Argument Parsing Workflow", () => {
    it("should reject old stream command", () => {
      const args = [
        "stream",
        "--ws-host",
        "192.168.1.100:3000",
        "--camera-serial",
        "ABC1234567890",
        "--port",
        "8080",
        "--verbose",
      ];

      expect(() => CLIParser.parse(args)).toThrow("Unknown command: stream");
    });

    it("should reject old list-devices command", () => {
      const args = [
        "list-devices",
        "--ws-host",
        "192.168.1.100:3000",
        "--verbose",
      ];

      expect(() => CLIParser.parse(args)).toThrow(
        "Unknown command: list-devices"
      );
    });

    it("should reject old device-info command", () => {
      const args = [
        "device-info",
        "--ws-host",
        "192.168.1.100:3000",
        "--camera-serial",
        "ABC1234567890",
      ];

      expect(() => CLIParser.parse(args)).toThrow(
        "Unknown command: device-info"
      );
    });

    it("should reject old monitor command", () => {
      const args = [
        "monitor",
        "--ws-host",
        "192.168.1.100:3000",
        "--camera-serial",
        "ABC1234567890",
      ];

      expect(() => CLIParser.parse(args)).toThrow("Unknown command: monitor");
    });
  });

  describe("Error Handling Workflow", () => {
    it("should handle validation errors gracefully", () => {
      const args = {
        command: "device",
        subcommand: "stream",
        wsHost: "",
        cameraSerial: "ABC1234567890",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).toThrow(
        "WebSocket host is required"
      );
    });

    it("should handle unknown command errors gracefully", () => {
      const args = ["unknown-command"];

      expect(() => CLIParser.parse(args)).toThrow(
        "Unknown command: unknown-command"
      );
    });

    it("should handle argument parsing errors gracefully", () => {
      const args = ["device", "--invalid-flag"];

      expect(() => CLIParser.parse(args)).toThrow(
        "Unknown argument: --invalid-flag"
      );
    });
  });

  describe("Help and Information Workflow", () => {
    it("should display help when requested", async () => {
      const app = new CLIApplication();
      const args = ["--help"];

      await app.run(args);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("USAGE:")
      );
    });

    it("should handle version display through static method", () => {
      CLIApplication.displayVersion();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Eufy Camera CLI v")
      );
    });

    it("should handle commands display through static method", () => {
      CLIApplication.displayCommands();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Available commands:")
      );
    });
  });

  describe("Command Context Creation", () => {
    it("should create proper context for verbose mode", () => {
      const args = [
        "device",
        "list",
        "--ws-host",
        "192.168.1.100:3000",
        "--verbose",
      ];

      const parsed = CLIParser.parse(args);
      expect(parsed.verbose).toBe(true);
      expect(parsed.command).toBe("device");
      expect(parsed.subcommand).toBe("list");
    });

    it("should create proper context for non-verbose mode", () => {
      const args = ["device", "list", "--ws-host", "192.168.1.100:3000"];

      const parsed = CLIParser.parse(args);
      expect(parsed.verbose).toBe(false);
      expect(parsed.command).toBe("device");
      expect(parsed.subcommand).toBe("list");
    });
  });

  describe("Command Registry Integration", () => {
    it("should properly register and execute all commands", () => {
      const {
        createCommandRegistry,
        getAvailableCommands,
      } = require("../../src/commands");

      const context = {
        logger: testUtils.createMockLogger(),
        verbose: false,
        wsHost: "192.168.1.100:3000",
      };

      const registry = createCommandRegistry(context);
      const availableCommands = getAvailableCommands();

      // Test that all commands are properly registered
      expect(availableCommands).toEqual(["driver", "device"]);

      // Test that each command can be retrieved and has proper structure
      availableCommands.forEach((commandName: string) => {
        const command = registry.get(commandName);
        expect(command).toBeDefined();
        expect(command!.name).toBe(commandName);
        expect(typeof command!.execute).toBe("function");
      });
    });
  });

  describe("Argument Validation Integration", () => {
    it("should validate all command arguments properly", () => {
      const testCases = [
        {
          args: {
            command: "device",
            subcommand: "stream",
            wsHost: "192.168.1.100:3000",
            cameraSerial: "ABC1234567890",
            port: 8080,
            verbose: false,
            help: false,
          },
          shouldPass: true,
        },
        {
          args: {
            command: "device",
            subcommand: "list",
            wsHost: "192.168.1.100:3000",
            cameraSerial: "",
            port: 0,
            verbose: false,
            help: false,
          },
          shouldPass: true,
        },
        {
          args: {
            command: "device",
            subcommand: "stream",
            wsHost: "",
            cameraSerial: "ABC1234567890",
            port: 0,
            verbose: false,
            help: false,
          },
          shouldPass: false,
          expectedError: "WebSocket host is required",
        },
        {
          args: {
            command: "device",
            subcommand: "stream",
            wsHost: "192.168.1.100:3000",
            cameraSerial: "",
            port: 0,
            verbose: false,
            help: false,
          },
          shouldPass: false,
          expectedError:
            "Camera serial is required for the device stream command",
        },
      ];

      testCases.forEach(({ args, shouldPass, expectedError }) => {
        if (shouldPass) {
          expect(() => CLIParser.validateArgs(args)).not.toThrow();
        } else {
          expect(() => CLIParser.validateArgs(args)).toThrow(expectedError);
        }
      });
    });
  });
});
