/**
 * Debug Logger utility for consistent logging across the Eufy Security plugin
 *
 * Provides a centralized logging system with configurable debug levels.
 * Integrates with Scrypted's console system for proper log display.
 */

// Global debug state
let debugEnabled = false;
let globalConsole: any | null = null;

/**
 * Initialize the global debug logger system
 * @param console - Scrypted console instance
 * @param enabled - Whether debug logging is enabled
 */
export function initializeDebugLogger(console: any, enabled: boolean): void {
  globalConsole = console;
  debugEnabled = enabled;
}

/**
 * Set debug enabled state
 * @param enabled - Whether debug logging should be enabled
 */
export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Debug logger interface
 */
export interface DebugLogger {
  /** Debug level logging */
  d(message: string, ...args: any[]): void;
  /** Info level logging */
  i(message: string, ...args: any[]): void;
  /** Warn level logging */
  w(message: string, ...args: any[]): void;
  /** Error level logging */
  e(message: string, ...args: any[]): void;
}

/**
 * Create a debug logger for a specific component
 * @param component - Component name for log prefixing
 * @returns DebugLogger instance
 */
export function createDebugLogger(component: string): DebugLogger {
  const prefix = `[${component}]`;

  return {
    d(message: string, ...args: any[]): void {
      if (debugEnabled && globalConsole) {
        globalConsole.log(`${prefix} ${message}`, ...args);
      }
    },
    i(message: string, ...args: any[]): void {
      if (globalConsole) {
        globalConsole.log(`${prefix} ${message}`, ...args);
      }
    },
    w(message: string, ...args: any[]): void {
      if (globalConsole) {
        globalConsole.warn(`${prefix} ${message}`, ...args);
      }
    },
    e(message: string, ...args: any[]): void {
      if (globalConsole) {
        globalConsole.error(`${prefix} ${message}`, ...args);
      }
    },
  };
}
