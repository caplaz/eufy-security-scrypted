/**
 * CLI-specific interfaces and types for the Eufy Camera CLI application
 *
 * This module defines all the core interfaces used throughout the CLI application,
 * including command-line argument parsing, device information, and command handling.
 *
 * @public
 */

/**
 * Parsed command-line arguments structure
 *
 * Represents the result of parsing command-line arguments, with all options
 * converted to their appropriate types and validated.
 *
 * @interface ParsedArgs
 * @public
 */
export interface ParsedArgs {
  /** WebSocket server host URL (e.g., "192.168.1.100:3000") */
  wsHost: string;
  /** Camera device serial number */
  cameraSerial: string;
  /** TCP server port number (0 for automatic assignment) */
  port: number;
  /** Enable verbose logging output */
  verbose: boolean;
  /** Show help information */
  help: boolean;
  /** Main command to execute (stream, list-devices, device-info, monitor, driver) */
  command?: string;
  /** Subcommand for hierarchical commands (status, connect for driver command) */
  subcommand?: string;
  /** Captcha code for 2FA verification */
  captcha?: string;
  /** Captcha ID for 2FA verification */
  captchaId?: string;
  /** Verification code for 2FA */
  verifyCode?: string;
  /** Captcha ID for verification code (same as captchaId) */
  verifyCodeId?: string;
}

/**
 * CLI options for the application
 *
 * Simplified interface containing the core options needed for CLI operation.
 * Used internally by commands that need basic configuration.
 *
 * @interface CLIOptions
 * @public
 */
export interface CLIOptions {
  /** WebSocket server host URL */
  wsHost: string;
  /** Camera device serial number */
  cameraSerial: string;
  /** TCP server port number */
  port: number;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Logger interface for consistent logging across the CLI application
 *
 * Provides a standardized logging interface that can be implemented by
 * different logging libraries (tslog, console, custom loggers, etc.).
 *
 * @interface Logger
 * @public
 */
export interface Logger {
  /** Log informational messages */
  info(message: string, ...args: any[]): void;
  /** Log warning messages */
  warn(message: string, ...args: any[]): void;
  /** Log error messages */
  error(message: string, ...args: any[]): void;
  /** Log debug messages (only shown in verbose mode) */
  debug(message: string, ...args: any[]): void;
}

/**
 * Device information structure
 *
 * Contains essential information about a Eufy security device,
 * including identification, capabilities, and version details.
 *
 * @interface DeviceInfo
 * @public
 */
export interface DeviceInfo {
  /** Human-readable device name */
  name: string;
  /** Unique device serial number */
  serialNumber: string;
  /** Device type (e.g., "Camera", "Doorbell") */
  type: string;
  /** Serial number of the associated base station (optional) */
  stationSerial?: string;
  /** Device model identifier (optional) */
  model?: string;
  /** Hardware version string (optional) */
  hardwareVersion?: string;
  /** Software/firmware version string (optional) */
  softwareVersion?: string;
}

/**
 * Connection statistics for monitoring and debugging
 *
 * Tracks connection metrics and streaming status for performance monitoring
 * and troubleshooting purposes.
 *
 * @interface ConnectionStats
 * @public
 */
export interface ConnectionStats {
  /** Number of currently active client connections */
  activeConnections: number;
  /** Total number of connections since startup */
  totalConnections: number;
  /** Whether streaming is currently active */
  streamingActive: boolean;
  /** Application uptime in milliseconds */
  uptime: number;
}

/**
 * Stream lifecycle configuration options
 *
 * Controls how the streaming lifecycle behaves, including automatic
 * stop delays and restart behavior.
 *
 * @interface StreamLifecycleOptions
 * @public
 */
export interface StreamLifecycleOptions {
  /** Delay in milliseconds before stopping stream after last client disconnects */
  stopDelayMs: number;
  /** Whether to automatically restart streaming on connection loss */
  autoRestart: boolean;
}

/**
 * Command handler interface for CLI commands
 *
 * Defines the contract that all CLI commands must implement,
 * providing consistent command execution and metadata.
 *
 * @interface CommandHandler
 * @public
 */
export interface CommandHandler {
  /** Unique command name (e.g., "stream", "list-devices") */
  name: string;
  /** Human-readable command description */
  description: string;
  /** Execute the command with parsed arguments */
  execute(args: ParsedArgs): Promise<void>;
}

/**
 * CLI command execution context
 *
 * Provides shared context and dependencies to all commands,
 * including logging, configuration, and common utilities.
 *
 * @interface CommandContext
 * @public
 */
export interface CommandContext {
  /** Logger instance for command output */
  logger: Logger;
  /** Whether verbose logging is enabled */
  verbose: boolean;
  /** WebSocket server host URL */
  wsHost: string;
}
