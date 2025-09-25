/**
 * Basic CLI integration tests
 */

import { CLIParser } from "../../src/cli-parser";
import { CLIApplication } from "../../src/cli-application";
import { testUtils } from "../test-utils";

describe("CLI Basic Integration", () => {
  describe("CLIParser", () => {
    it("should parse basic stream command arguments", () => {
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

      expect(parsed).toEqual({
        command: "stream",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "ABC1234567890",
        port: 8080,
        verbose: true,
        help: false,
      });
    });

    it("should parse list-devices command", () => {
      const args = [
        "list-devices",
        "--ws-host",
        "192.168.1.100:3000",
        "--verbose",
      ];

      const parsed = CLIParser.parse(args);

      expect(parsed).toEqual({
        command: "list-devices",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: true,
        help: false,
      });
    });

    it("should default to stream command when no command specified", () => {
      const args = [
        "--ws-host",
        "192.168.1.100:3000",
        "--camera-serial",
        "ABC1234567890",
      ];

      const parsed = CLIParser.parse(args);

      expect(parsed.command).toBe("stream");
    });

    it("should handle help flag", () => {
      const args = ["--help"];

      const parsed = CLIParser.parse(args);

      expect(parsed.help).toBe(true);
    });

    it("should validate required arguments for stream command", () => {
      const args = {
        command: "stream",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "ABC1234567890",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
    });

    it("should throw error for missing camera serial in stream command", () => {
      const args = {
        command: "stream",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).toThrow(
        "Camera serial is required for the stream command"
      );
    });

    it("should validate WebSocket URL format", () => {
      const args = {
        command: "list-devices",
        wsHost: "://invalid",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).toThrow(
        "Invalid WebSocket host format"
      );
    });

    it("should validate camera serial format", () => {
      const args = {
        command: "stream",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "invalid",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).toThrow(
        "Invalid camera serial format"
      );
    });
  });

  describe("CLIApplication", () => {
    it("should create CLI application instance", () => {
      const app = new CLIApplication();
      expect(app).toBeInstanceOf(CLIApplication);
    });

    it("should display version information", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      CLIApplication.displayVersion();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Eufy Camera CLI v")
      );

      consoleSpy.mockRestore();
    });

    it("should display available commands", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      CLIApplication.displayCommands();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Available commands:")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("stream")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("list-devices")
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Command Registry", () => {
    it("should create command registry with all commands", () => {
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

      expect(registry.size).toBe(4);
      expect(availableCommands).toEqual([
        "stream",
        "list-devices",
        "device-info",
        "monitor",
      ]);

      // Verify all commands are registered
      availableCommands.forEach((commandName: string) => {
        expect(registry.has(commandName)).toBe(true);
        const command = registry.get(commandName);
        expect(command).toBeDefined();
        expect(command!.name).toBe(commandName);
      });
    });
  });
});
