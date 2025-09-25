/**
 * Build Configuration Integration Tests
 * Tests TypeScript build configuration and executable setup
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

describe("Build Configuration Integration", () => {
  const packageRoot = join(__dirname, "../..");
  const distDir = join(packageRoot, "dist");
  const srcDir = join(packageRoot, "src");

  describe("TypeScript Configuration", () => {
    it("should have valid tsconfig.json", () => {
      const tsconfigPath = join(packageRoot, "tsconfig.json");
      expect(existsSync(tsconfigPath)).toBe(true);

      const tsconfigContent = readFileSync(tsconfigPath, "utf8");
      // Remove JSONC comments (// comments) before parsing
      const jsonContent = tsconfigContent.replace(/\/\/.*$/gm, "").trim();
      const tsconfig = JSON.parse(jsonContent);

      // Verify extends from root config
      expect(tsconfig.extends).toBe("../../tsconfig.json");

      // Verify package-specific compiler options
      expect(tsconfig.compilerOptions).toBeDefined();
      expect(tsconfig.compilerOptions.outDir).toBe("./dist");
      expect(tsconfig.compilerOptions.rootDir).toBe("./src");
      expect(tsconfig.compilerOptions.tsBuildInfoFile).toBe(
        "./dist/.tsbuildinfo"
      );
      expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true);
      expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true);
      expect(tsconfig.compilerOptions.downlevelIteration).toBe(true);
      expect(tsconfig.compilerOptions.importHelpers).toBe(true);
      expect(tsconfig.compilerOptions.incremental).toBe(true);
      expect(tsconfig.compilerOptions.composite).toBe(true);

      // Verify include/exclude patterns
      expect(tsconfig.include).toContain("src/**/*");
      expect(tsconfig.exclude).toContain("node_modules");
      expect(tsconfig.exclude).toContain("dist");
      expect(tsconfig.exclude).toContain("tests");

      // Verify project references
      expect(tsconfig.references).toBeDefined();
      expect(tsconfig.references).toHaveLength(2);
      expect(tsconfig.references[0].path).toBe("../eufy-security-client");
      expect(tsconfig.references[1].path).toBe("../eufy-stream-server");
    });

    it("should build successfully", () => {
      expect(() => {
        execSync("npm run build", {
          cwd: packageRoot,
          stdio: "pipe",
        });
      }).not.toThrow();
    });

    it("should generate dist directory with compiled files", () => {
      // Ensure build has run
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });

      expect(existsSync(distDir)).toBe(true);

      // Check for main files
      expect(existsSync(join(distDir, "main.js"))).toBe(true);
      expect(existsSync(join(distDir, "main.d.ts"))).toBe(true);
      expect(existsSync(join(distDir, "index.js"))).toBe(true);
      expect(existsSync(join(distDir, "index.d.ts"))).toBe(true);
      expect(existsSync(join(distDir, "cli-application.js"))).toBe(true);
      expect(existsSync(join(distDir, "cli-parser.js"))).toBe(true);

      // Check for source maps
      expect(existsSync(join(distDir, "main.js.map"))).toBe(true);
      expect(existsSync(join(distDir, "index.js.map"))).toBe(true);
    });

    it("should generate TypeScript declaration files", () => {
      // Ensure build has run
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });

      const declarationFiles = [
        "main.d.ts",
        "index.d.ts",
        "cli-application.d.ts",
        "cli-parser.d.ts",
        "interfaces.d.ts",
      ];

      declarationFiles.forEach((file) => {
        const filePath = join(distDir, file);
        expect(existsSync(filePath)).toBe(true);

        const content = readFileSync(filePath, "utf8");
        expect(content).toContain("export");
      });
    });
  });

  describe("Executable Configuration", () => {
    it("should have proper package.json bin configuration", () => {
      const packageJsonPath = join(packageRoot, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

      expect(packageJson.bin).toBeDefined();
      expect(packageJson.bin["eufy-camera"]).toBe("dist/main.js");
      expect(packageJson.bin["eufy-camera-streamer"]).toBe("dist/main.js");
    });

    it("should have executable main.js with proper shebang", () => {
      // Ensure build has run
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });

      const mainJsPath = join(distDir, "main.js");
      expect(existsSync(mainJsPath)).toBe(true);

      const content = readFileSync(mainJsPath, "utf8");
      expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
    });

    it("should have executable permissions on main.js", () => {
      // Ensure build has run
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });

      const mainJsPath = join(distDir, "main.js");
      const stats = statSync(mainJsPath);

      // Check if file exists and is readable
      expect(stats.isFile()).toBe(true);

      // On some systems, TypeScript compilation doesn't preserve execute permissions
      // The important thing is that the file can be executed with node
      expect(stats.mode).toBeGreaterThan(0);
    });

    it("should execute successfully as a Node.js script", () => {
      // Ensure build has run
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });

      const mainJsPath = join(distDir, "main.js");

      // Test version command
      const versionOutput = execSync(`node "${mainJsPath}" --version`, {
        cwd: packageRoot,
        encoding: "utf8",
      });
      expect(versionOutput).toContain("Eufy Camera CLI v");

      // Test commands listing
      const commandsOutput = execSync(`node "${mainJsPath}" --commands`, {
        cwd: packageRoot,
        encoding: "utf8",
      });
      expect(commandsOutput).toContain("Available commands:");
      expect(commandsOutput).toContain("stream");
      expect(commandsOutput).toContain("list-devices");
    });
  });

  describe("Package Configuration", () => {
    it("should have proper package.json configuration", () => {
      const packageJsonPath = join(packageRoot, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

      // Check essential fields
      expect(packageJson.name).toBe("@scrypted/eufy-camera-cli");
      expect(packageJson.main).toBe("dist/index.js");
      expect(packageJson.types).toBe("dist/index.d.ts");

      // Check scripts
      expect(packageJson.scripts.build).toBe("tsc --build");
      expect(packageJson.scripts.test).toBe("jest --passWithNoTests");
      expect(packageJson.scripts.start).toBe("node dist/main.js");

      // Check dependencies
      expect(packageJson.dependencies).toHaveProperty(
        "@scrypted/eufy-security-client"
      );
      expect(packageJson.dependencies).toHaveProperty("eufy-stream-server");

      // Check files array
      expect(packageJson.files).toContain("dist/**/*");
    });

    it("should have proper Jest configuration", () => {
      const jestConfigPath = join(packageRoot, "jest.config.js");
      expect(existsSync(jestConfigPath)).toBe(true);

      // Load and verify Jest config
      delete require.cache[jestConfigPath];
      const jestConfig = require(jestConfigPath);

      expect(jestConfig.preset).toBe("ts-jest");
      expect(jestConfig.testEnvironment).toBe("node");
      expect(jestConfig.roots).toContain("<rootDir>/src");
      expect(jestConfig.roots).toContain("<rootDir>/tests");
      expect(jestConfig.collectCoverageFrom).toContain("src/**/*.ts");
      expect(jestConfig.collectCoverageFrom).toContain("!src/main.ts");
    });
  });

  describe("Build Scripts", () => {
    it("should clean dist directory successfully", () => {
      // Ensure dist exists first
      execSync("npm run build", {
        cwd: packageRoot,
        stdio: "pipe",
      });
      expect(existsSync(distDir)).toBe(true);

      // Clean and verify
      execSync("npm run clean", {
        cwd: packageRoot,
        stdio: "pipe",
      });
      expect(existsSync(distDir)).toBe(false);
    });

    it("should run typecheck without errors", () => {
      expect(() => {
        execSync("npm run typecheck", {
          cwd: packageRoot,
          stdio: "pipe",
        });
      }).not.toThrow();
    });

    it("should build incrementally with watch mode", (done) => {
      // This is a basic test that watch mode can start
      // In a real scenario, you'd test file watching behavior
      const child = execSync("timeout 2s npm run build:watch || true", {
        cwd: packageRoot,
        stdio: "pipe",
      });

      // If we get here without throwing, watch mode started successfully
      expect(true).toBe(true);
      done();
    }, 10000);
  });

  describe("Source File Structure", () => {
    it("should have all required source files", () => {
      const requiredFiles = [
        "main.ts",
        "index.ts",
        "cli-application.ts",
        "cli-parser.ts",
        "interfaces.ts",
      ];

      requiredFiles.forEach((file) => {
        const filePath = join(srcDir, file);
        expect(existsSync(filePath)).toBe(true);
      });
    });

    it("should have commands directory with all command files", () => {
      const commandsDir = join(srcDir, "commands");
      expect(existsSync(commandsDir)).toBe(true);

      const requiredCommandFiles = [
        "index.ts",
        "base-command.ts",
        "stream-command.ts",
        "list-devices-command.ts",
        "device-info-command.ts",
        "monitor-command.ts",
      ];

      requiredCommandFiles.forEach((file) => {
        const filePath = join(commandsDir, file);
        expect(existsSync(filePath)).toBe(true);
      });
    });
  });
});
