import { Logger as TsLogger, ILogObj } from "tslog";
import { EufySecurityClient } from "@caplaz/eufy-security-client";
import {
  CommandHandler,
  ParsedArgs,
  Logger,
  CommandContext,
} from "../interfaces";

/**
 * Base command class that provides common functionality for all CLI commands
 *
 * This abstract class serves as the foundation for all CLI commands, providing:
 * - WebSocket client creation and connection management
 * - Common error handling and timeout utilities
 * - Logging configuration and context management
 * - Graceful shutdown handling
 * - Argument validation helpers
 * - Utility methods for formatting and display
 *
 * All concrete command classes should extend this base class to inherit
 * the common functionality and maintain consistency across commands.
 *
 * @abstract
 * @public
 */
export abstract class BaseCommand implements CommandHandler {
  abstract readonly name: string;
  abstract readonly description: string;

  protected logger: Logger;
  protected tsLogger: TsLogger<ILogObj>;
  protected context: CommandContext;

  /**
   * Creates a new base command instance
   *
   * @param context - Command execution context containing logger, configuration, and shared state
   */
  constructor(context: CommandContext) {
    this.context = context;
    this.logger = context.logger;

    // Create TypeScript logger for more detailed logging
    this.tsLogger = new TsLogger<ILogObj>({
      name: `CLI-Command`,
      minLevel: context.verbose ? 1 : 3, // Debug level if verbose, Info level otherwise
      prettyLogTemplate:
        "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}} {{logLevelName}} [{{name}}] ",
    });
  }

  /**
   * Execute the command with the provided arguments
   *
   * This abstract method must be implemented by all concrete command classes
   * to define their specific behavior and functionality.
   *
   * @param args - Parsed and validated command-line arguments
   * @throws {Error} If command execution fails
   *
   * @abstract
   */
  abstract execute(args: ParsedArgs): Promise<void>;

  /**
   * Create and connect to the Eufy Security WebSocket client
   *
   * Establishes a connection to the eufy-security-ws server with proper
   * error handling and timeout management. Provides enhanced error messages
   * for common connection issues.
   *
   * @param wsHost - WebSocket server host URL
   * @returns Connected EufySecurityClient instance
   * @throws {Error} If connection fails with detailed error information
   *
   * @protected
   */
  protected async createClient(wsHost: string): Promise<EufySecurityClient> {
    // Ensure WebSocket URL has protocol
    let wsUrl = wsHost;
    if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
      wsUrl = `ws://${wsUrl}`;
    }

    this.logger.info(`Connecting to WebSocket server: ${wsUrl}`);

    try {
      // Create the actual Eufy Security client
      const client = new EufySecurityClient({
        wsUrl,
        logger: this.logger,
      });

      // Connect to the WebSocket server with timeout
      await this.withTimeout(
        client.connect(),
        10000,
        `Connection to WebSocket server ${wsUrl} timed out after 10 seconds`
      );

      this.logger.info("✅ Connected to WebSocket server");
      return client;
    } catch (error) {
      // Provide more specific error messages based on error type
      if (error instanceof Error) {
        if (error.message.includes("ECONNREFUSED")) {
          throw new Error(
            `❌ Connection refused: Unable to connect to WebSocket server at ${wsUrl}. ` +
              `Please ensure the eufy-security-ws server is running and accessible.`
          );
        } else if (error.message.includes("ENOTFOUND")) {
          throw new Error(
            `❌ Host not found: Unable to resolve hostname in ${wsUrl}. ` +
              `Please check the hostname and network connectivity.`
          );
        } else if (error.message.includes("timeout")) {
          throw new Error(
            `❌ Connection timeout: Unable to connect to ${wsUrl} within 10 seconds. ` +
              `Please check if the server is running and network connectivity.`
          );
        }
      }

      // Re-throw with enhanced context
      throw new Error(
        `❌ Failed to connect to WebSocket server at ${wsUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validate required arguments for the command
   */
  protected validateRequiredArgs(args: ParsedArgs, required: string[]): void {
    for (const field of required) {
      if (!args[field as keyof ParsedArgs]) {
        throw new Error(`${field} is required for the ${this.name} command`);
      }
    }
  }

  /**
   * Format duration in human-readable format
   */
  protected formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  /**
   * Format bytes in human-readable format
   */
  protected formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    const value = bytes / Math.pow(k, i);
    return `${value.toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Execute a promise with a timeout
   */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Handle graceful shutdown
   */
  protected setupGracefulShutdown(cleanup: () => Promise<void>): void {
    const handleShutdown = (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      cleanup()
        .then(() => {
          this.logger.info("✅ Shutdown completed");
          process.exit(0);
        })
        .catch((error) => {
          this.logger.error("❌ Error during shutdown:", error);
          process.exit(1);
        });
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  }
}
