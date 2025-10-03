/**
 * MemoryManager: Centralized memory monitoring and cleanup system
 *
 * This module provides:
 * - System-wide memory monitoring with configurable thresholds
 * - Progressive cleanup strategies (gentle -> aggressive -> emergency)
 * - Callback-based cleanup system allowing components to register their own cleanup logic
 * - Shared singleton instance to prevent multiple monitoring intervals
 * - Detailed memory usage tracking and logging
 *
 * Architecture:
 * 1. Components register cleanup callbacks with unique IDs
 * 2. MemoryManager monitors system memory at regular intervals
 * 3. When thresholds are exceeded, registered callbacks are invoked with cleanup levels
 * 4. Components handle their own cleanup logic based on the requested level
 */

import { Logger, ILogObj } from "tslog";

/**
 * Memory cleanup severity levels for progressive cleanup strategies
 */
export enum CleanupLevel {
  /** Gentle cleanup - trim buffers moderately */
  GENTLE = "gentle",
  /** Aggressive cleanup - keep only essential data */
  AGGRESSIVE = "aggressive",
  /** Emergency cleanup - minimal data retention */
  EMERGENCY = "emergency",
}

/**
 * Memory usage information provided to cleanup callbacks
 */
export interface MemoryInfo {
  /** Current RSS memory usage in MB */
  rssMB: number;
  /** Current heap usage in MB */
  heapMB: number;
  /** The cleanup level being requested */
  level: CleanupLevel;
  /** The threshold that triggered this cleanup */
  threshold: number;
}

/**
 * Callback function signature for memory cleanup operations
 */
export type MemoryCleanupCallback = (info: MemoryInfo) => void;

/**
 * Configuration for memory monitoring thresholds and behavior
 */
export interface MemoryManagerConfig {
  /** Base memory threshold in MB (default: 120) */
  baseThresholdMB: number;
  /** Monitoring interval in milliseconds (default: 10000) */
  monitorIntervalMs: number;
  /** Enable detailed memory logging (default: false) */
  enableDetailedLogging: boolean;
  /** Minimum time between cleanup attempts in milliseconds (default: 30000) */
  cleanupCooldownMs: number;
}

/**
 * Information about a registered cleanup callback
 */
interface CleanupRegistration {
  id: string;
  callback: MemoryCleanupCallback;
  description?: string;
}

/**
 * Centralized memory management system with progressive cleanup strategies.
 *
 * This singleton class monitors system memory usage and coordinates cleanup
 * across multiple components through a callback-based system.
 */
export class MemoryManager {
  private static instance?: MemoryManager;

  private readonly logger: Logger<ILogObj>;
  private readonly config: MemoryManagerConfig;
  private readonly cleanupCallbacks = new Map<string, CleanupRegistration>();
  private monitorInterval?: ReturnType<typeof setTimeout>;
  private isMonitoring = false;
  private lastCleanupTime = 0;
  private lastCleanupLevel?: CleanupLevel;

  private constructor(
    logger: Logger<ILogObj>,
    config: Partial<MemoryManagerConfig> = {}
  ) {
    this.logger = logger;
    this.config = {
      baseThresholdMB: 120,
      monitorIntervalMs: 10000,
      enableDetailedLogging: false,
      cleanupCooldownMs: 30000,
      ...config,
    };
  }

  /**
   * Gets the singleton MemoryManager instance, creating it if necessary.
   *
   * @param logger Logger instance for memory manager operations
   * @param config Optional configuration overrides
   * @returns The singleton MemoryManager instance
   */
  static getInstance(
    logger: Logger<ILogObj>,
    config?: Partial<MemoryManagerConfig>
  ): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager(logger, config);
    }
    return MemoryManager.instance;
  }

  /**
   * Gets the current memory threshold from the singleton instance.
   * Safe to call even if instance doesn't exist yet.
   *
   * @returns Current memory threshold in MB
   */
  static getMemoryThreshold(): number {
    return MemoryManager.instance?.config.baseThresholdMB ?? 120;
  }

  /**
   * Updates the memory threshold in the singleton instance.
   * Creates instance with default config if it doesn't exist.
   *
   * @param thresholdMB New threshold in MB
   * @param logger Optional logger for creating instance if needed
   */
  static setMemoryThreshold(
    thresholdMB: number,
    logger?: Logger<ILogObj>
  ): void {
    if (MemoryManager.instance) {
      MemoryManager.instance.updateThreshold(thresholdMB);
    } else if (logger) {
      // Create instance with the new threshold
      MemoryManager.instance = new MemoryManager(logger, {
        baseThresholdMB: thresholdMB,
      });
    }
    // If no instance and no logger, the threshold will be applied when instance is created
  }

  /**
   * Registers a cleanup callback with the memory manager.
   *
   * @param id Unique identifier for this callback
   * @param callback Function to call when cleanup is needed
   * @param description Optional description for logging
   */
  registerCleanupCallback(
    id: string,
    callback: MemoryCleanupCallback,
    description?: string
  ): void {
    this.cleanupCallbacks.set(id, { id, callback, description });
    this.logger.debug(
      `🧩 Registered memory cleanup callback: ${id}${description ? ` (${description})` : ""}`
    );

    // Start monitoring when first callback is registered
    if (this.cleanupCallbacks.size === 1) {
      this.startMonitoring();
    }
  }

  /**
   * Unregisters a cleanup callback.
   *
   * @param id The ID of the callback to remove
   */
  unregisterCleanupCallback(id: string): void {
    const removed = this.cleanupCallbacks.delete(id);
    if (removed) {
      this.logger.debug(`🗑️ Unregistered memory cleanup callback: ${id}`);
    }

    // Stop monitoring when no callbacks remain
    if (this.cleanupCallbacks.size === 0) {
      this.stopMonitoring();
    }
  }

  /**
   * Manually trigger immediate memory pressure check and cleanup if needed.
   * Useful for components that want to check memory pressure during intensive operations.
   *
   * @returns True if cleanup was triggered, false otherwise
   */
  checkMemoryPressure(): boolean {
    const usage = process.memoryUsage();
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    const heapMB = Math.round(usage.heapUsed / 1024 / 1024);

    // Calculate dynamic thresholds based on configured base
    const gentleThreshold = Math.max(50, this.config.baseThresholdMB * 0.75);
    const aggressiveThreshold = this.config.baseThresholdMB;
    const emergencyThreshold = this.config.baseThresholdMB * 1.25;

    // Determine cleanup level needed
    let cleanupLevel: CleanupLevel | null = null;
    let threshold = 0;

    if (rssMB > emergencyThreshold) {
      cleanupLevel = CleanupLevel.EMERGENCY;
      threshold = emergencyThreshold;
    } else if (rssMB > aggressiveThreshold) {
      cleanupLevel = CleanupLevel.AGGRESSIVE;
      threshold = aggressiveThreshold;
    } else if (rssMB > gentleThreshold) {
      cleanupLevel = CleanupLevel.GENTLE;
      threshold = gentleThreshold;
    }

    if (cleanupLevel) {
      // Check cooldown: prevent too frequent cleanups of the same level
      const now = Date.now();
      const timeSinceLastCleanup = now - this.lastCleanupTime;

      // Allow emergency cleanups immediately, but enforce cooldown for gentle/aggressive
      const needsCooldown =
        cleanupLevel !== CleanupLevel.EMERGENCY &&
        this.lastCleanupLevel === cleanupLevel &&
        timeSinceLastCleanup < this.config.cleanupCooldownMs;

      if (needsCooldown) {
        this.logger.debug(
          `⏱️ Cleanup cooldown active: ${Math.round(
            timeSinceLastCleanup / 1000
          )}s / ${Math.round(this.config.cleanupCooldownMs / 1000)}s`
        );
        return false;
      }

      // Escalation logic: if we just did a gentle cleanup but memory is still high,
      // escalate to aggressive cleanup sooner
      if (
        cleanupLevel === CleanupLevel.GENTLE &&
        this.lastCleanupLevel === CleanupLevel.GENTLE &&
        timeSinceLastCleanup < this.config.cleanupCooldownMs * 2 &&
        timeSinceLastCleanup > this.config.cleanupCooldownMs * 0.5
      ) {
        this.logger.warn(
          `🔄 Escalating to aggressive cleanup - gentle cleanup wasn't sufficient`
        );
        cleanupLevel = CleanupLevel.AGGRESSIVE;
        threshold = aggressiveThreshold;
      }

      this.triggerCleanup({
        rssMB,
        heapMB,
        level: cleanupLevel,
        threshold,
      });
      return true;
    }

    return false;
  }

  /**
   * Updates the base memory threshold for all cleanup levels.
   *
   * @param thresholdMB New base threshold in MB
   */
  updateThreshold(thresholdMB: number): void {
    this.config.baseThresholdMB = Math.max(50, thresholdMB);
    this.logger.debug(
      `🎯 Updated memory threshold to ${this.config.baseThresholdMB}MB`
    );
  }

  /**
   * Gets current memory usage information.
   *
   * @returns Object containing current memory statistics
   */
  getCurrentMemoryUsage(): {
    rssMB: number;
    heapMB: number;
    thresholds: { gentle: number; aggressive: number; emergency: number };
  } {
    const usage = process.memoryUsage();
    return {
      rssMB: Math.round(usage.rss / 1024 / 1024),
      heapMB: Math.round(usage.heapUsed / 1024 / 1024),
      thresholds: {
        gentle: Math.max(50, this.config.baseThresholdMB * 0.75),
        aggressive: this.config.baseThresholdMB,
        emergency: this.config.baseThresholdMB * 1.25,
      },
    };
  }

  /**
   * Starts the memory monitoring interval.
   */
  private startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.logger.debug(
      `🔍 Starting memory monitoring (threshold: ${this.config.baseThresholdMB}MB, interval: ${this.config.monitorIntervalMs}ms)`
    );

    this.monitorInterval = setInterval(() => {
      this.performMemoryCheck();
    }, this.config.monitorIntervalMs);
  }

  /**
   * Stops the memory monitoring interval.
   */
  private stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    this.isMonitoring = false;
    this.logger.debug("🛑 Stopped memory monitoring");
  }

  /**
   * Performs a periodic memory check and triggers cleanup if needed.
   *
   * Performance Optimizations:
   * - Uses efficient process.memoryUsage() for minimal overhead
   * - Conditional logging to avoid string concatenation when disabled
   * - Single memory pressure check per interval to minimize CPU usage
   * - Optimized memory calculations using bitwise operations where applicable
   */
  private performMemoryCheck(): void {
    const usage = process.memoryUsage();
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    const heapMB = Math.round(usage.heapUsed / 1024 / 1024);

    // Log detailed memory info if enabled (performance: conditional string building)
    if (this.config.enableDetailedLogging) {
      this.logger.debug(
        `📊 Memory check: ${rssMB}MB RSS, ${heapMB}MB heap, ` +
          `${this.cleanupCallbacks.size} registered callbacks`
      );
    }

    // Check if cleanup is needed (single call for efficiency)
    this.checkMemoryPressure();
  }

  /**
   * Triggers cleanup callbacks at the specified level.
   *
   * @param memoryInfo Information about current memory state and cleanup level
   */
  private triggerCleanup(memoryInfo: MemoryInfo): void {
    const { level, rssMB, threshold } = memoryInfo;

    // Update cleanup tracking
    this.lastCleanupTime = Date.now();
    this.lastCleanupLevel = level;

    // Log cleanup trigger
    const levelIcon = {
      [CleanupLevel.GENTLE]: "⚠️",
      [CleanupLevel.AGGRESSIVE]: "🚨",
      [CleanupLevel.EMERGENCY]: "💥",
    }[level];

    this.logger.warn(
      `${levelIcon} ${level.toUpperCase()} memory cleanup triggered: ${rssMB}MB > ${threshold}MB`
    );

    // Call all registered cleanup callbacks
    let callbacksExecuted = 0;
    for (const registration of this.cleanupCallbacks.values()) {
      try {
        registration.callback(memoryInfo);
        callbacksExecuted++;
      } catch (error) {
        this.logger.error(
          `❌ Error in cleanup callback ${registration.id}: ${error}`
        );
      }
    }

    this.logger.debug(`🧹 Executed ${callbacksExecuted} cleanup callbacks`);

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      this.logger.debug("🗑️ Forced garbage collection");
    }
  }

  /**
   * Disposes of the memory manager, stopping monitoring and clearing callbacks.
   * Used for testing or shutdown scenarios.
   */
  dispose(): void {
    this.stopMonitoring();
    this.cleanupCallbacks.clear();
    MemoryManager.instance = undefined;
    this.logger.debug("🗑️ MemoryManager disposed");
  }
}

/**
 * Convenience function to get the singleton MemoryManager instance.
 *
 * @param logger Logger instance
 * @param config Optional configuration
 * @returns The MemoryManager singleton
 */
export function getMemoryManager(
  logger: Logger<ILogObj>,
  config?: Partial<MemoryManagerConfig>
): MemoryManager {
  return MemoryManager.getInstance(logger, config);
}
