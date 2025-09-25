/**
 * Global Debug Logger Utility for Eufy Security Plugin
 *
 * Provides centralized debug logging control using Scrypted's console interface.
 * Supports global debug toggling, structured logging, and memory-efficient log output.
 */

/**
 * Global Debug Logger Utility for Eufy Security Plugin
 *
 * This utility provides centralized debug logging control using Scrypted's console interface.
 * It wraps the console with debug toggles and provides structured logging at appropriate levels.
 *
 * Features:
 * - Global debug toggle that can be controlled from the UI
 * - Works with Scrypted's console interface (log, warn, error methods)
 * - Immediate propagation of debug setting changes
 * - Structured logging with appropriate log levels
 * - Memory efficient - no string formatting when debug is disabled
 */

// Console interface that matches Scrypted's console object
interface ScryptedConsole {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface DebugLoggerConfig {
  console: ScryptedConsole;
  debugEnabled: boolean;
}

let globalConfig: DebugLoggerConfig | null = null;

/**
 * Initialize the global debug logger with a Scrypted console instance
 * This should be called early in the provider constructor
 */
export function initializeDebugLogger(
  console: ScryptedConsole,
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
 * Debug logger class that wraps Scrypted's console interface
 * with debug toggles and structured logging
 */
export class DebugLogger {
  private readonly prefix: string;

  constructor(prefix: string = "") {
    this.prefix = prefix;
  }

  /**
   * Verbose logging - lowest level, very detailed information
   * Only logs when debug is enabled (maps to console.log)
   */
  v(message: string, ...args: any[]): void {
    if (globalConfig?.debugEnabled) {
      const msg = this.prefix
        ? `[${this.prefix}] 🔍 ${message}`
        : `🔍 ${message}`;
      const formattedMsg =
        args.length > 0
          ? `${msg} ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : msg;
      globalConfig.console.log(formattedMsg);
    }
  }

  /**
   * Debug logging - detailed information for debugging
   * Only logs when debug is enabled (maps to console.log)
   */
  d(message: string, ...args: any[]): void {
    if (globalConfig?.debugEnabled) {
      const msg = this.prefix
        ? `[${this.prefix}] 🐛 ${message}`
        : `🐛 ${message}`;
      const formattedMsg =
        args.length > 0
          ? `${msg} ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : msg;
      globalConfig.console.log(formattedMsg);
    }
  }

  /**
   * Info logging - general information, always logged
   * This is for important operational information (maps to console.log)
   */
  i(message: string, ...args: any[]): void {
    if (globalConfig) {
      const msg = this.prefix ? `[${this.prefix}] ${message}` : message;
      const formattedMsg =
        args.length > 0
          ? `${msg} ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : msg;
      globalConfig.console.log(formattedMsg);
    }
  }

  /**
   * Warning logging - warnings and potential issues, always logged
   * Maps to console.warn
   */
  w(message: string, ...args: any[]): void {
    if (globalConfig) {
      const msg = this.prefix ? `[${this.prefix}] ${message}` : message;
      const formattedMsg =
        args.length > 0
          ? `${msg} ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : msg;
      globalConfig.console.warn(formattedMsg);
    }
  }

  /**
   * Error logging - errors and failures, always logged
   * Maps to console.error
   */
  e(message: string, ...args: any[]): void {
    if (globalConfig) {
      const msg = this.prefix ? `[${this.prefix}] ${message}` : message;
      const formattedMsg =
        args.length > 0
          ? `${msg} ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : msg;
      globalConfig.console.error(formattedMsg);
    }
  }

  /**
   * Alert logging - critical alerts, always logged
   * Maps to console.error with alert emoji
   */
  a(message: string, ...args: any[]): void {
    if (globalConfig) {
      const msg = this.prefix
        ? `[${this.prefix}] 🚨 ${message}`
        : `🚨 ${message}`;
      const formattedMsg =
        args.length > 0
          ? `${msg} ${args
              .map((arg) =>
                typeof arg === "object" ? JSON.stringify(arg) : String(arg)
              )
              .join(" ")}`
          : msg;
      globalConfig.console.error(formattedMsg);
    }
  }

  /**
   * Convenience method for logging at different levels based on debug state
   * When debug is enabled, logs at debug level
   * When debug is disabled, logs at info level
   */
  log(message: string, ...args: any[]): void {
    if (globalConfig?.debugEnabled) {
      this.d(message, ...args);
    } else {
      this.i(message, ...args);
    }
  }
}

/**
 * Create a new DebugLogger instance with an optional prefix
 * The prefix will be added to all log messages from this instance
 */
export function createDebugLogger(prefix?: string): DebugLogger {
  return new DebugLogger(prefix);
}

/**
 * Convenience function for quick debug logging without creating an instance
 */
export function debugLog(message: string, ...args: any[]): void {
  if (globalConfig?.debugEnabled) {
    const formattedMsg =
      args.length > 0
        ? `🐛 ${message} ${args
            .map((arg) =>
              typeof arg === "object" ? JSON.stringify(arg) : String(arg)
            )
            .join(" ")}`
        : `🐛 ${message}`;
    globalConfig.console.log(formattedMsg);
  }
}

/**
 * Convenience function for quick info logging without creating an instance
 */
export function infoLog(message: string, ...args: any[]): void {
  if (globalConfig) {
    const formattedMsg =
      args.length > 0
        ? `${message} ${args
            .map((arg) =>
              typeof arg === "object" ? JSON.stringify(arg) : String(arg)
            )
            .join(" ")}`
        : message;
    globalConfig.console.log(formattedMsg);
  }
}

/**
 * Convenience function for quick warning logging without creating an instance
 */
export function warnLog(message: string, ...args: any[]): void {
  if (globalConfig) {
    const formattedMsg =
      args.length > 0
        ? `${message} ${args
            .map((arg) =>
              typeof arg === "object" ? JSON.stringify(arg) : String(arg)
            )
            .join(" ")}`
        : message;
    globalConfig.console.warn(formattedMsg);
  }
}

/**
 * Convenience function for quick error logging without creating an instance
 */
export function errorLog(message: string, ...args: any[]): void {
  if (globalConfig) {
    const formattedMsg =
      args.length > 0
        ? `${message} ${args
            .map((arg) =>
              typeof arg === "object" ? JSON.stringify(arg) : String(arg)
            )
            .join(" ")}`
        : message;
    globalConfig.console.error(formattedMsg);
  }
}
