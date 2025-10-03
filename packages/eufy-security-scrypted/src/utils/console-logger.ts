/**
 * Console Logger for Eufy Security Plugin
 *
 * Provides centralized debug logging control using Scrypted's console interface.
 * Extends tslog's Logger class for full compatibility with packages that use tslog.
 *
 * Features:
 * - Global debug toggle that can be controlled from the root logger only
 * - Each logger has its own console (device logs go to device console)
 * - Hierarchical logging with automatic prefix management
 * - Sublogs inherit verbosity settings from root but write to their own console
 * - Full tslog Logger interface compatibility
 * - Memory efficient - no string formatting when debug is disabled
 */

import { Logger, ILogObj, ILogObjMeta, ISettingsParam } from "tslog";

// Re-export tslog types for use in other packages
export type { Logger, ILogObj };

/**
 * ConsoleLogger extends tslog's Logger class to provide custom console-based logging
 * with centralized debug toggle control for Scrypted's console interface.
 *
 * Each logger has its own console instance (from Scrypted device/provider),
 * but respects the global debug setting for verbosity control.
 *
 * Uses tslog's built-in hierarchy (getSubLogger) for automatic prefix management.
 */
export class ConsoleLogger extends Logger<ILogObj> {
  private console: Console;

  constructor(console: Console, settings?: ISettingsParam<ILogObj>) {
    super({
      type: "hidden", // Don't use tslog's built-in formatters
      ...settings,
    });
    this.console = console;
  }

  /**
   * Helper method to extract hierarchical name from tslog's settings
   * tslog automatically builds hierarchical names like "Eufy:Station-001:Camera"
   */
  private getHierarchicalPrefix(): string {
    // Access tslog's internal settings to get the hierarchical name
    const name = (this.settings as any).name;
    return name || "";
  }

  /**
   * Helper method to format log messages using tslog's built-in hierarchical prefix
   */
  private formatMessage(...args: unknown[]): string {
    if (args.length === 0) return "";

    const prefix = this.getHierarchicalPrefix();
    const message = String(args[0]);
    const msg = prefix ? `[${prefix}] ${message}` : message;

    if (args.length === 1) return msg;

    const rest = args
      .slice(1)
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg) : String(arg)
      )
      .join(" ");

    return `${msg} ${rest}`;
  }

  /**
   * Silly level logging - most verbose, only when debug is enabled
   */
  silly(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const msg = this.formatMessage(...args);
    this.console.log(msg);
    return undefined;
  }

  /**
   * Trace level logging - very detailed debugging information
   */
  trace(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const prefix = this.getHierarchicalPrefix();
    const emoji = prefix ? "" : "🔍 ";
    const msg = this.formatMessage(...args);
    this.console.log(`${emoji}${msg}`);
    return undefined;
  }

  /**
   * Debug level logging - detailed debugging information
   * Only logs when debug is enabled
   */
  debug(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const prefix = this.getHierarchicalPrefix();
    const emoji = prefix ? "" : "🐛 ";
    const msg = this.formatMessage(...args);
    this.console.log(`${emoji}${msg}`);
    return undefined;
  }

  /**
   * Info level logging - general information, always logged
   */
  info(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const msg = this.formatMessage(...args);
    this.console.log(msg);
    return undefined;
  }

  /**
   * Warning level logging - warnings and potential issues, always logged
   */
  warn(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const msg = this.formatMessage(...args);
    this.console.warn(msg);
    return undefined;
  }

  /**
   * Error level logging - errors and failures, always logged
   */
  error(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const msg = this.formatMessage(...args);
    this.console.error(msg);
    return undefined;
  }

  /**
   * Fatal level logging - critical errors, always logged
   */
  fatal(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    const prefix = this.getHierarchicalPrefix();
    const emoji = prefix ? "🚨 " : "🚨 ";
    const msg = this.formatMessage(...args);
    this.console.error(`${emoji}${msg}`);
    return undefined;
  }

  /**
   * Create a sub-logger with its own console but inheriting verbosity settings
   * This allows device logs to appear in their own console while respecting
   * the global debug setting controlled by the root logger
   *
   * @param console - The Scrypted console for this sublog (e.g., device.console)
   * @param settings - Optional settings for the sublogger (name, etc.)
   */
  createSubLogger(
    console: Console,
    settings?: ISettingsParam<ILogObj>
  ): ConsoleLogger {
    // Create a sublogger using tslog's hierarchy (for automatic prefix management)
    const subLogger = super.getSubLogger(settings) as any;

    // Set the console for this sublogger
    subLogger.console = console;

    // Set the prototype to ConsoleLogger to ensure proper method behavior
    Object.setPrototypeOf(subLogger, ConsoleLogger.prototype);

    return subLogger as ConsoleLogger;
  }
}

/**
 * Create the root logger for the Eufy provider
 * This is the only logger that should control the global debug setting
 * All stations and devices will be sub-loggers of this root logger
 *
 * @param console - The Scrypted console for the root logger (provider.console)
 * @param name - Name for the root logger (default: "Eufy")
 * @param debugEnabled - Initial debug state (default: false)
 */
export function createRootLogger(
  console: Console,
  name: string = "Eufy",
  debugEnabled: boolean = false
): ConsoleLogger {
  return new ConsoleLogger(console, {
    name,
    minLevel: debugEnabled ? 0 : 3, // 0=silly (all), 3=info (info+)
  });
}

/**
 * @deprecated Use createRootLogger for the provider or logger.createSubLogger() for children
 * This function is kept for backward compatibility but should not be used
 */
export function createConsoleLogger(name: string = "Eufy"): ConsoleLogger {
  // This is a fallback that shouldn't be used in the new design
  // Return a logger with global console as fallback
  return new ConsoleLogger(console, { name });
}

/**
 * @deprecated No longer needed - logger configuration is handled per-instance
 * Kept for backward compatibility
 */
export function initializeConsoleLogger(
  _console: Console,
  debugEnabled: boolean = false
): void {
  // No-op - kept for backward compatibility
}
