/**
 * Unit tests for CLIParser
 */

import { CLIParser } from "../../src/cli-parser";

describe("CLIParser", () => {
  describe("parse", () => {
    it("should parse stream command with all options", () => {
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

      const result = CLIParser.parse(args);

      expect(result).toEqual({
        command: "stream",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "ABC1234567890",
        port: 8080,
        verbose: true,
        help: false,
      });
    });

    it("should parse with short flags", () => {
      const args = [
        "stream",
        "-w",
        "192.168.1.100:3000",
        "-c",
        "ABC1234567890",
        "-p",
        "8080",
        "-v",
      ];

      const result = CLIParser.parse(args);

      expect(result).toEqual({
        command: "stream",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "ABC1234567890",
        port: 8080,
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

      const result = CLIParser.parse(args);

      expect(result.command).toBe("stream");
    });

    it("should parse list-devices command", () => {
      const args = ["list-devices", "--ws-host", "192.168.1.100:3000"];

      const result = CLIParser.parse(args);

      expect(result.command).toBe("list-devices");
      expect(result.wsHost).toBe("192.168.1.100:3000");
    });

    it("should parse help flag", () => {
      const args = ["--help"];

      const result = CLIParser.parse(args);

      expect(result.help).toBe(true);
    });

    it("should throw error for unknown argument", () => {
      const args = ["--unknown-flag"];

      expect(() => CLIParser.parse(args)).toThrow(
        "Unknown argument: --unknown-flag"
      );
    });

    it("should throw error for missing value after flag", () => {
      const args = ["--ws-host"];

      expect(() => CLIParser.parse(args)).toThrow(
        "WebSocket host is required after --ws-host"
      );
    });

    it("should throw error for invalid port", () => {
      const args = ["--port", "invalid"];

      expect(() => CLIParser.parse(args)).toThrow(
        "Port must be a valid number"
      );
    });

    it("should throw error for port out of range", () => {
      const args = ["--port", "70000"];

      expect(() => CLIParser.parse(args)).toThrow(
        "Port must be a valid number between 0 and 65535"
      );
    });
  });

  describe("validateArgs", () => {
    it("should skip validation when help is requested", () => {
      const args = {
        command: "stream",
        wsHost: "",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: true,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
    });

    it("should require ws-host", () => {
      const args = {
        command: "list-devices",
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

    it("should require camera-serial for stream command", () => {
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

    it("should not require camera-serial for list-devices command", () => {
      const args = {
        command: "list-devices",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
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

    it("should accept valid IP address", () => {
      const args = {
        command: "list-devices",
        wsHost: "192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
    });

    it("should accept valid hostname", () => {
      const args = {
        command: "list-devices",
        wsHost: "eufy-server.local:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
    });

    it("should accept WebSocket URL with protocol", () => {
      const args = {
        command: "list-devices",
        wsHost: "ws://192.168.1.100:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
    });

    it("should accept secure WebSocket URL", () => {
      const args = {
        command: "list-devices",
        wsHost: "wss://eufy-server.com:3000",
        cameraSerial: "",
        port: 0,
        verbose: false,
        help: false,
      };

      expect(() => CLIParser.validateArgs(args)).not.toThrow();
    });
  });

  describe("printUsage", () => {
    it("should print usage information", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      CLIParser.printUsage();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Eufy Camera CLI Streamer")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("COMMANDS:")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("stream")
      );

      consoleSpy.mockRestore();
    });
  });
});
