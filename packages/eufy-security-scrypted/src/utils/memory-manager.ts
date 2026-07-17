/**
 * Memory usage helper
 *
 * Reports the plugin process's current memory usage for display in the
 * provider's settings/README pages.
 *
 * (This file previously housed a 400-line MemoryManager singleton with a
 * cleanup-callback registry, a monitoring interval, and tiered cleanup
 * levels — none of which was ever wired up: no cleanup callback was
 * registered anywhere, so the machinery could never do anything. The
 * associated "memory threshold" setting configured that inert machinery
 * and has been removed along with it.)
 *
 * @module utils/memory-manager
 */

/** Current process memory usage, rounded to whole megabytes. */
export function getCurrentMemoryUsageMB(): { rssMB: number; heapMB: number } {
  const usage = process.memoryUsage();
  return {
    rssMB: Math.round(usage.rss / 1024 / 1024),
    heapMB: Math.round(usage.heapUsed / 1024 / 1024),
  };
}
