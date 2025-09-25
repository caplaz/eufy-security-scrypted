/**
 * Unit tests for BaseCommand
 */

import { BaseCommand } from "../../../src/commands/base-command";
import { ParsedArgs, CommandContext } from "../../../src/interfaces";
import { testUtils } from "../../test-utils";

// Create a concrete implementation for testing
class TestCommand extends BaseCommand {
  readonly name = "test";
  readonly description = "Test command";

  async execute(args: ParsedArgs): Promise<void> {
    // Test implementation
    return Promise.resolve();
  }
}

describe("BaseCommand", () => {
  let mockContext: CommandContext;
  let command: TestCommand;

  beforeEach(() => {
    mockContext = {
      logger: testUtils.createMockLogger(),
      verbose: false,
      wsHost: "192.168.1.100:3000",
    };

    command = new TestCommand(mockContext);
  });

  describe("constructor", () => {
    it("should initialize with context", () => {
      expect(command.name).toBe("test");
      expect(command.description).toBe("Test command");
    });

    it("should create logger instances", () => {
      expect(command["logger"]).toBeDefined();
      expect(command["tsLogger"]).toBeDefined();
    });
  });

  describe("validateRequiredArgs", () => {
    it("should not throw for valid required arguments", () => {
      const args: ParsedArgs = {
        wsHost: "192.168.1.100:3000",
        cameraSerial: "ABC1234567890",
        port: 8080,
        verbose: false,
        help: false,
      };

      expect(() => {
        command["validateRequiredArgs"](args, ["wsHost", "cameraSerial"]);
      }).not.toThrow();
    });

    it("should throw for missing required arguments", () => {
      const args: ParsedArgs = {
        wsHost: "",
        cameraSerial: "ABC1234567890",
        port: 8080,
        verbose: false,
        help: false,
      };

      expect(() => {
        command["validateRequiredArgs"](args, ["wsHost", "cameraSerial"]);
      }).toThrow("wsHost is required for the test command");
    });
  });

  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      expect(command["formatDuration"](500)).toBe("500ms");
    });

    it("should format seconds", () => {
      expect(command["formatDuration"](5000)).toBe("5s");
    });

    it("should format minutes and seconds", () => {
      expect(command["formatDuration"](65000)).toBe("1m 5s");
    });

    it("should format hours, minutes and seconds", () => {
      expect(command["formatDuration"](3665000)).toBe("1h 1m 5s");
    });
  });

  describe("formatBytes", () => {
    it("should format zero bytes", () => {
      expect(command["formatBytes"](0)).toBe("0 B");
    });

    it("should format bytes", () => {
      expect(command["formatBytes"](512)).toBe("512.00 B");
    });

    it("should format kilobytes", () => {
      expect(command["formatBytes"](1536)).toBe("1.50 KB");
    });

    it("should format megabytes", () => {
      expect(command["formatBytes"](1572864)).toBe("1.50 MB");
    });

    it("should format gigabytes", () => {
      expect(command["formatBytes"](1610612736)).toBe("1.50 GB");
    });
  });

  describe("setupGracefulShutdown", () => {
    it("should setup signal handlers", () => {
      const mockCleanup = jest.fn().mockResolvedValue(undefined);
      const processOnSpy = jest.spyOn(process, "on");

      command["setupGracefulShutdown"](mockCleanup);

      expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith(
        "SIGTERM",
        expect.any(Function)
      );

      processOnSpy.mockRestore();
    });
  });
});
