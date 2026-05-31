/**
 * Thumbnail refresh policy
 *
 * Decides whether a battery camera's cached thumbnail should be refreshed by a
 * gentle background wake. Pure logic so it can be unit-tested without the
 * device/stream machinery.
 *
 * @module utils/thumbnail-refresh
 */

/** How old a cached thumbnail may get before a background refresh is allowed. */
export const THUMBNAIL_REFRESH_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes

export interface RefreshDecisionInput {
  /** Age of the cached keyframe in ms, or null if nothing is cached. */
  cacheAgeMs: number | null;
  /** Is another camera on this HomeBase currently holding the stream slot? */
  slotBusy: boolean;
  /**
   * ms until this camera's refresh backoff expires (0 if not backing off).
   * Set after a failed wake so a dead/asleep camera (e.g. one that delivers
   * no video) isn't hammered every cycle.
   */
  backoffRemainingMs: number;
  /** Refresh threshold (defaults to THUMBNAIL_REFRESH_THRESHOLD_MS). */
  thresholdMs?: number;
}

/**
 * Should we wake this camera now to refresh its thumbnail?
 *
 * Refresh only when ALL hold:
 *  - the cache is empty or older than the threshold,
 *  - the HomeBase slot is free (never interrupt a viewer/recorder), and
 *  - we're not in failure backoff for this camera.
 */
export function shouldRefreshThumbnail({
  cacheAgeMs,
  slotBusy,
  backoffRemainingMs,
  thresholdMs = THUMBNAIL_REFRESH_THRESHOLD_MS,
}: RefreshDecisionInput): boolean {
  if (slotBusy) return false;
  if (backoffRemainingMs > 0) return false;
  if (cacheAgeMs === null) return true; // never cached → refresh
  return cacheAgeMs >= thresholdMs;
}

/**
 * Next backoff duration (ms) after a failed refresh. Exponential from a base,
 * capped — so a camera that never streams (dead/asleep) is retried rarely
 * instead of every cycle.
 */
export function nextRefreshBackoffMs(
  consecutiveFailures: number,
  baseMs = 10 * 60 * 1000, // 10 min
  capMs = 6 * 60 * 60 * 1000, // 6 h
): number {
  const n = Math.max(1, consecutiveFailures);
  return Math.min(capMs, baseMs * Math.pow(2, n - 1));
}
