import { Logger as TsLogger, ILogObj } from "tslog";
import { CLIParser } from "./cli-parser";
import { createCommandRegistry, getAvailableCommands } from "./commands";
import { ParsedArgs, Logger, CommandContext } from "./interfaces";

/**
 * Main CLI application class that handles command routing and execution
 *
 * This class serves as the entry point for the CLI application, managing:
 * - Command-line argument parsing and validation
 * - Logger configuration based on verbosity settings
 * - Command registry creation and execution
 * - Error handling and user feedback
 * - Help and version information display
 *
 * @public
 */
export class CLIApplication {
  private logger: Logger;
  private tsLogger: TsLogger<ILogObj>;

  /**
   * Creates a new CLI application instance
   *
   * Initializes the logging system with default settings. The log level
   * will be adjusted based on the verbose flag during execution.
   */
  constructor() {
    // Create default logger (will be updated based on verbose flag)
    this.tsLogger = new TsLogger<ILogObj>({
      name: "EufyCameraCLI",
      minLevel: 3, // Info level by default
      prettyLogTemplate:
        "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}} {{logLevelName}} [{{name}}] ",
    });

    this.logger = {
      info: (message: string, ...args: any[]) =>
        this.tsLogger.info(message, ...args),
      warn: (message: string, ...args: any[]) =>
        this.tsLogger.warn(message, ...args),
      error: (message: string, ...args: any[]) =>
        this.tsLogger.error(message, ...args),
      debug: (message: string, ...args: any[]) =>
        this.tsLogger.debug(message, ...args),
    };
  }

  /**
   * Run the CLI application with the provided arguments
   *
   * This is the main entry point that orchestrates the entire CLI execution:
   * 1. Parses and validates command-line arguments
   * 2. Configures logging based on verbosity settings
   * 3. Creates command context and registry
   * 4. Executes the requested command
   * 5. Handles errors with appropriate user feedback
   *
   * @param args - Command-line arguments (excluding node and script name)
   * @throws {Error} If command execution fails or arguments are invalid
   *
   * @example
   * ```typescript
   * const app = new CLIApplication();
   * await app.run(['stream', '--ws-host', 'localhost:3000', '--camera-serial', 'ABC123']);
   * ```
   */
  async run(args: string[]): Promise<void> {
    try {
      // Parse command-line arguments
      const parsedArgs = CLIParser.parse(args);

      // Show help if requested
      if (parsedArgs.help) {
        CLIParser.printUsage();
        return;
      }

      // Update logger level based on verbose flag
      if (parsedArgs.verbose) {
        this.tsLogger.settings.minLevel = 1; // Debug level
      }

      // Validate arguments
      CLIParser.validateArgs(parsedArgs);

      // Create command context
      const context: CommandContext = {
        logger: this.logger,
        verbose: parsedArgs.verbose,
        wsHost: parsedArgs.wsHost,
      };

      // Create command registry
      const commandRegistry = createCommandRegistry(context);

      // Get the command to execute
      const commandName = parsedArgs.command || "stream";
      const command = commandRegistry.get(commandName);

      if (!command) {
        throw new Error(
          `Unknown command: ${commandName}. Available commands: ${getAvailableCommands().join(
            ", "
          )}`
        );
      }

      const displayCommand = parsedArgs.subcommand
        ? `${commandName} ${parsedArgs.subcommand}`
        : commandName;
      this.logger.info(`🚀 Executing command: ${displayCommand}`);

      // Execute the command
      await command.execute(parsedArgs);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error("❌ CLI Error:", error.message);

        // Show stack trace in verbose mode
        if (args.includes("--verbose") || args.includes("-v")) {
          console.error(error.stack);
        }
      } else {
        this.logger.error("❌ Unknown error:", error);
      }

      process.exit(1);
    }
  }

  /**
   * Display version information from package.json
   *
   * Shows the current version of the CLI application.
   * Called when --version or -V flags are used.
   *
   * @static
   */
  static displayVersion(): void {
    const packageJson = require("../package.json");
    console.log(`Eufy Camera CLI v${packageJson.version}`);
  }

  /**
   * Display available commands and their descriptions
   *
   * Shows a summary of all available CLI commands with brief descriptions.
   * Called when --commands flag is used.
   *
   * @static
   */
  static displayCommands(): void {
    console.log("\nAvailable commands:");
    console.log(
      "  driver status     Check the connection status of the driver"
    );
    console.log(
      "  driver connect    Establish connection to the Eufy Security driver"
    );
    console.log("  device list       List all available camera devices");
    console.log("  device info       Show detailed information about a device");
    console.log("  device stream     Start streaming from a camera device");
    console.log(
      "  device monitor    Monitor camera connection status and events"
    );
    console.log(
      "\nUse 'eufy-security-cli <command> --help' for command-specific help."
    );
  }
}
