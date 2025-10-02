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
 * - Full tslog Logger interface compatibility with hierarchical logging
 * - Memory efficient - no string formatting when debug is disabled
 */

import { Logger, ILogObj, ILogObjMeta, ISettingsParam } from "tslog";

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
 *
 * Uses tslog's built-in hierarchy (getSubLogger) for automatic prefix management.
 */
export class ConsoleLogger extends Logger<ILogObj> {
  constructor(settings?: ISettingsParam<ILogObj>) {
    super({
      type: "hidden", // Don't use tslog's built-in formatters
      ...settings,
    });
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
    if (globalConfig?.debugEnabled) {
      const msg = this.formatMessage(...args);
      globalConfig.console.log(msg);
    }
    return undefined;
  }

  /**
   * Trace level logging - very detailed debugging information
   */
  trace(...args: unknown[]): (ILogObj & ILogObjMeta) | undefined {
    if (globalConfig?.debugEnabled) {
      const prefix = this.getHierarchicalPrefix();
      const emoji = prefix ? "" : "🔍 ";
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
      const prefix = this.getHierarchicalPrefix();
      const emoji = prefix ? "" : "🐛 ";
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
      const prefix = this.getHierarchicalPrefix();
      const emoji = prefix ? "🚨 " : "🚨 ";
      const msg = this.formatMessage(...args);
      globalConfig.console.error(`${emoji}${msg}`);
    }
    return undefined;
  }

  /**
   * Override getSubLogger to return ConsoleLogger type (instead of base Logger)
   * This maintains type consistency throughout the hierarchy
   */
  getSubLogger(settings?: ISettingsParam<ILogObj>): ConsoleLogger {
    const subLogger = super.getSubLogger(settings) as any;
    // Set the prototype to ConsoleLogger to ensure proper method behavior
    Object.setPrototypeOf(subLogger, ConsoleLogger.prototype);
    return subLogger as ConsoleLogger;
  }
}

/**
 * Create the root logger for the Eufy provider
 * All stations and devices will be sub-loggers of this root logger
 */
export function createConsoleLogger(name: string = "Eufy"): ConsoleLogger {
  return new ConsoleLogger({ name });
}
