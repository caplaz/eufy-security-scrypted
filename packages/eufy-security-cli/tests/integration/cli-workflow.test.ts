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
    it("should parse stream command arguments correctly", () => {
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

      const parsed = CLIParser.parse(args);
      expect(parsed.command).toBe("stream");
      expect(parsed.wsHost).toBe("192.168.1.100:3000");
      expect(parsed.cameraSerial).toBe("ABC1234567890");
      expect(parsed.port).toBe(8080);
      expect(parsed.verbose).toBe(true);
    });

    it("should parse list-devices command arguments correctly", () => {
      const args = [
        "list-devices",
        "--ws-host",
        "192.168.1.100:3000",
        "--verbose",
      ];

      const parsed = CLIParser.parse(args);
      expect(parsed.command).toBe("list-devices");
      expect(parsed.wsHost).toBe("192.168.1.100:3000");
      expect(parsed.verbose).toBe(true);
    });

    it("should parse device-info command arguments correctly", () => {
      const args = [
        "device-info",
        "--ws-host",
        "192.168.1.100:3000",
        "--camera-serial",
        "ABC1234567890",
      ];

      const parsed = CLIParser.parse(args);
      expect(parsed.command).toBe("device-info");
      expect(parsed.wsHost).toBe("192.168.1.100:3000");
      expect(parsed.cameraSerial).toBe("ABC1234567890");
    });

    it("should parse monitor command arguments correctly", () => {
      const args = [
        "monitor",
        "--ws-host",
        "192.168.1.100:3000",
        "--camera-serial",
        "ABC1234567890",
      ];

      const parsed = CLIParser.parse(args);
      expect(parsed.command).toBe("monitor");
      expect(parsed.wsHost).toBe("192.168.1.100:3000");
      expect(parsed.cameraSerial).toBe("ABC1234567890");
    });
  });

  describe("Error Handling Workflow", () => {
    it("should handle validation errors gracefully", () => {
      const args = {
        command: "stream",
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
        "Unknown argument: unknown-command"
      );
    });

    it("should handle argument parsing errors gracefully", () => {
      const args = ["stream", "--invalid-flag"];

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
        "list-devices",
        "--ws-host",
        "192.168.1.100:3000",
        "--verbose",
      ];

      const parsed = CLIParser.parse(args);
      expect(parsed.verbose).toBe(true);
    });

    it("should create proper context for non-verbose mode", () => {
      const args = ["list-devices", "--ws-host", "192.168.1.100:3000"];

      const parsed = CLIParser.parse(args);
      expect(parsed.verbose).toBe(false);
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
      expect(availableCommands).toEqual([
        "stream",
        "list-devices",
        "device-info",
        "monitor",
        "driver",
      ]);

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
            command: "stream",
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
            command: "list-devices",
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
            command: "stream",
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
            command: "stream",
            wsHost: "192.168.1.100:3000",
            cameraSerial: "",
            port: 0,
            verbose: false,
            help: false,
          },
          shouldPass: false,
          expectedError: "Camera serial is required for the stream command",
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
