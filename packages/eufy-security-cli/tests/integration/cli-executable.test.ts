/**
 * CLI Executable Integration Tests
 * Tests the actual executable functionality and command execution
 */

import { spawn } from "child_process";
import { join } from "path";
import { execSync } from "child_process";

describe("CLI Executable Integration", () => {
  const packageRoot = join(__dirname, "../..");
  const cliPath = join(packageRoot, "dist/main.js");

  beforeAll(() => {
    // Ensure the CLI is built before running tests
    execSync("npm run build", {
      cwd: packageRoot,
      stdio: "pipe",
    });
  });

  const runCLI = (
    args: string[],
    timeout = 3000
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> => {
    return new Promise((resolve, reject) => {
      const child = spawn("node", [cliPath, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          stdout,
          stderr,
          exitCode: 1, // Timeout is considered failure
        });
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  };

  describe("Version and Help Commands", () => {
    it("should display help with --help flag", async () => {
      const result = await runCLI(["--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("USAGE:");
      expect(result.stdout).toContain("eufy-security-cli");
    });
  });

  describe("Command Validation", () => {
    it("should show error for missing required arguments", async () => {
      const result = await runCLI(["stream"]);

      expect(result.exitCode).toBe(1);
      // The error should be logged (either to stderr or stdout)
      const hasError = result.stderr.length > 0 || result.stdout.length > 0;
      expect(hasError).toBe(true);
    });

    it("should show error for invalid argument", async () => {
      const result = await runCLI(["--invalid-flag"]);

      expect(result.exitCode).toBe(1);
      // The error should be logged (either to stderr or stdout)
      const hasError = result.stderr.length > 0 || result.stdout.length > 0;
      expect(hasError).toBe(true);
    });
  });

  describe("Command Execution", () => {
    it("should handle device list command with valid arguments", async () => {
      // This test will fail with connection error, but we're testing argument parsing
      const result = await runCLI(
        ["device", "list", "--ws-host", "192.168.1.100:3000"],
        2000
      );

      // Should fail with connection error, not argument validation error
      expect(result.exitCode).toBe(1);
      // Should not contain argument validation errors
      expect(result.stderr).not.toContain("WebSocket host is required");
    });

    it("should handle device info command with valid arguments", async () => {
      // This test will fail with connection error, but we're testing argument parsing
      const result = await runCLI(
        [
          "device",
          "info",
          "--ws-host",
          "192.168.1.100:3000",
          "--camera-serial",
          "ABC1234567890",
        ],
        2000
      );

      // Should fail with connection error, not argument validation error
      expect(result.exitCode).toBe(1);
      // Should not contain argument validation errors
      expect(result.stderr).not.toContain("Camera serial is required");
    });

    it("should handle device monitor command with valid arguments", async () => {
      // This test will fail with connection error, but we're testing argument parsing
      const result = await runCLI(
        [
          "device",
          "monitor",
          "--ws-host",
          "192.168.1.100:3000",
          "--camera-serial",
          "ABC1234567890",
        ],
        2000
      );

      // Should fail with connection error, not argument validation error
      expect(result.exitCode).toBe(1);
      // Should not contain argument validation errors
      expect(result.stderr).not.toContain("Camera serial is required");
    });
  });

  describe("Executable Properties", () => {
    beforeEach(() => {
      // Ensure the CLI is built before each test
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });
    });

    it("should be executable as a Node.js script", async () => {
      // Test that the file can be executed directly with node
      const result = await runCLI(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("USAGE:");
    });

    it("should have proper shebang line", () => {
      const fs = require("fs");
      const content = fs.readFileSync(cliPath, "utf8");
      expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
    });
  });
});
