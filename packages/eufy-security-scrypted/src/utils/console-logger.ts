/**
 * Console Logger for Eufy Security Plugin
 *
 * Provides centralized debug logging control using Scrypted's console interface.
 * Extends tslog's Logger class for full compatibility with packages that use tslog.
 *
 * Features:
 * - Global debug toggle that can be controlled from the UI
 * - Works with Scrypted's console interface (log, warn, error methods)
 * - Immediate propagation of debug setting changes
 * - Full tslog Logger interface compatibility
 * - Memory efficient - no string formatting when debug is disabled
 */

import { Logger, ILogObj, ILogObjMeta } from "tslog";

// Re-export tslog types for use in other packages
export type { Logger, ILogObj };

interface ConsoleLoggerConfig {
  console: Console;
  debugEnabled: boolean;
}

let globalConfig: ConsoleLoggerConfig | null = null;

/**
 * Initialize the global console logger with a Scrypted console instance
 * This should be called early in the provider constructor
 */
export function initializeConsoleLogger(
  console: Console,
  debugEnabled: boolean = false
): void {
  globalConfig = {
    console,
    debugEnabled,
  };
}

/**
 * Update the global debug setting
 * This will immediately affect all subsequent debug log calls
 */
export function setDebugEnabled(enabled: boolean): void {
  if (globalConfig) {
    globalConfig.debugEnabled = enabled;
  }
}

/**
 * Get the current debug enabled state
 */
export function isDebugEnabled(): boolean {
  return globalConfig?.debugEnabled ?? false;
}

/**
 * ConsoleLogger extends tslog's Logger class to provide custom console-based logging
 * with centralized debug toggle control for Scrypted's console interface.
 */
export class ConsoleLogger extends Logger<ILogObj> {
  private readonly prefix: string;

  constructor(prefix: string = "") {
    // Initialize parent Logger with minimal settings - we'll override the logging methods
    super({
      name: prefix,
      type: "hidden", // Don't use tslog's built-in formatters
    });
    this.prefix = prefix;
  }

  /**
   * Helper method to format log messages with prefix and arguments
   */
  private formatMessage(...args: unknown[]): string {
    if (args.length === 0) return "";

    const message = String(args[0]);
    const msg = this.prefix ? `[${this.prefix}] ${message}` : message;

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
    if (globalConfig?.debugEnabled) {
      const msg = this.formatMessage(...args);
      globalConfig.console.log(msg);
    }
    return undefined;
  }

  /**
   * Trace level logging - very detailed information
   * Only logs when debug is enabled
   */
  trace(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig?.debugEnabled) {
      const emoji = this.prefix ? "" : "🔍 ";
      const msg = this.formatMessage(...args);
      globalConfig.console.log(`${emoji}${msg}`);
    }
    return undefined;
  }

  /**
   * Debug level logging - detailed debugging information
   * Only logs when debug is enabled
   */
  debug(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig?.debugEnabled) {
      const emoji = this.prefix ? "" : "🐛 ";
      const msg = this.formatMessage(...args);
      globalConfig.console.log(`${emoji}${msg}`);
    }
    return undefined;
  }

  /**
   * Info level logging - general information, always logged
   */
  info(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig) {
      const msg = this.formatMessage(...args);
      globalConfig.console.log(msg);
    }
    return undefined;
  }

  /**
   * Warning level logging - warnings and potential issues, always logged
   */
  warn(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig) {
      const msg = this.formatMessage(...args);
      globalConfig.console.warn(msg);
    }
    return undefined;
  }

  /**
   * Error level logging - errors and failures, always logged
   */
  error(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig) {
      const msg = this.formatMessage(...args);
      globalConfig.console.error(msg);
    }
    return undefined;
  }

  /**
   * Fatal level logging - critical errors, always logged
   */
  fatal(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig) {
      const emoji = this.prefix ? "🚨 " : "🚨 ";
      const msg = this.formatMessage(...args);
      globalConfig.console.error(`${emoji}${msg}`);
    }
    return undefined;
  }
}

/**
 * Create a new ConsoleLogger instance with an optional prefix
 * The prefix will be added to all log messages from this instance
 */
export function createConsoleLogger(prefix?: string): ConsoleLogger {
  return new ConsoleLogger(prefix);
}
