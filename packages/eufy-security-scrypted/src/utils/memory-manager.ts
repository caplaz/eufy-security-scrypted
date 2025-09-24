/**
 * Memory Manager utility for system-wide memory monitoring and cleanup
 *
 * Provides centralized memory management across all devices and streaming sessions.
 * Helps prevent memory leaks and system instability from excessive buffer usage.
 */

import { DebugLogger } from "./debug-logger";

/**
 * Memory information structure
 */
export interface MemoryInfo {
  /** RSS memory usage in bytes */
  rss: number;
  /** Heap used in bytes */
  heapUsed: number;
  /** Heap total in bytes */
  heapTotal: number;
  /** External memory in bytes */
  external: number;
}

/**
 * Cleanup levels for memory pressure situations
 */
export enum CleanupLevel {
  /** Light cleanup - drop non-essential buffers */
  LIGHT = "light",
  /** Medium cleanup - drop older buffers, keep recent */
  MEDIUM = "medium",
  /** Aggressive cleanup - drop all non-critical buffers */
  AGGRESSIVE = "aggressive",
}

/**
 * Memory Manager singleton for system-wide memory coordination
 */
export class MemoryManager {
  private static instance: MemoryManager | null = null;
  private static memoryThresholdMB = 120;
  private logger: DebugLogger | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  /**
   * Set the system-wide memory threshold
   * @param thresholdMB - Memory threshold in megabytes
   * @param logger - Logger instance for reporting
   */
  static setMemoryThreshold(thresholdMB: number, logger?: DebugLogger): void {
    MemoryManager.memoryThresholdMB = Math.max(50, thresholdMB);
    const instance = MemoryManager.getInstance();
    if (logger) {
      instance.logger = logger;
      logger.i(`Memory threshold set to ${MemoryManager.memoryThresholdMB}MB`);
    }
  }

  /**
   * Get the current memory threshold
   */
  static getMemoryThreshold(): number {
    return MemoryManager.memoryThresholdMB;
  }

  /**
   * Get current memory usage information
   */
  static getMemoryInfo(): MemoryInfo {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
    };
  }

  /**
   * Check if memory usage is above threshold
   */
  static isMemoryPressure(): boolean {
    const memInfo = MemoryManager.getMemoryInfo();
    const rssMB = memInfo.rss / 1024 / 1024;
    return rssMB > MemoryManager.memoryThresholdMB;
  }

  /**
   * Get recommended cleanup level based on memory pressure
   */
  static getCleanupLevel(): CleanupLevel {
    const memInfo = MemoryManager.getMemoryInfo();
    const rssMB = memInfo.rss / 1024 / 1024;
    const threshold = MemoryManager.memoryThresholdMB;

    if (rssMB > threshold * 1.5) {
      return CleanupLevel.AGGRESSIVE;
    } else if (rssMB > threshold * 1.2) {
      return CleanupLevel.MEDIUM;
    } else {
      return CleanupLevel.LIGHT;
    }
  }

  /**
   * Log current memory status
   */
  logMemoryStatus(context: string): void {
    const memInfo = MemoryManager.getMemoryInfo();
    const rssMB = Math.round(memInfo.rss / 1024 / 1024);
    const heapMB = Math.round(memInfo.heapUsed / 1024 / 1024);
    const threshold = MemoryManager.memoryThresholdMB;

    if (this.logger) {
      const status = rssMB > threshold ? "⚠️ HIGH" : "✅ OK";
      this.logger.d(
        `Memory Status [${context}]: RSS=${rssMB}MB, Heap=${heapMB}MB, Threshold=${threshold}MB ${status}`
      );
    }
  }

  /**
   * Force garbage collection if available
   */
  static forceGarbageCollection(): void {
    if (global.gc) {
      global.gc();
    }
  }
}

/**
 * Get the global memory manager instance
 */
export function getMemoryManager(): MemoryManager {
  return MemoryManager.getInstance();
}
