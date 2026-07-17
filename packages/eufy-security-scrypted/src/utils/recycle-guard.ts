/**
 * Station-recycle guard
 *
 * A wedged camera recovers by recycling its HomeBase's P2P session, which
 * briefly disrupts EVERY camera on that HomeBase. That's worth it when the
 * recycle actually recovers the camera — but a camera that can't stream at all
 * (no WiFi signal, dead/unreachable) just keeps wedging, and recycling for it
 * repeatedly punishes its healthy siblings for nothing.
 *
 * This decides when to STOP recycling for such a camera. Pure logic so it can
 * be unit-tested without the device machinery.
 *
 * @module utils/recycle-guard
 */

/**
 * How many recycles that fail to recover the camera we tolerate before
 * suppressing. 1 = give it a single recycle (which genuinely fixes a wedged
 * session, e.g. Front Door), then stop if it still won't stream.
 */
export const MAX_FAILED_RECYCLES = 1;

/** How long to suppress recycles for a chronically-failing camera. */
export const RECYCLE_SUPPRESS_MS = 30 * 60 * 1000; // 30 minutes

export interface RecycleSuppressionInput {
  /** Is this camera its own station (4G LTE)? Self-stations have no siblings. */
  isSelfStation: boolean;
  /** Camera's reported WiFi signal level (0 = no usable signal), if known. */
  signalLevel: number | undefined;
  /** Recycles so far that did NOT recover the camera (reset when video flows). */
  consecutiveFailedRecycles: number;
}

export interface RecycleSuppressionResult {
  suppress: boolean;
  reason?: "no-signal" | "chronic-failure";
}

/**
 * Should we suppress the station recycle (to protect sibling cameras)?
 *
 * - HomeBase camera reporting signal level 0 → it physically can't stream; a
 *   recycle won't help and only disrupts siblings. Suppress.
 * - Already failed `MAX_FAILED_RECYCLES` recycles without recovering → stop.
 *
 * Self-station (4G) cameras have no siblings to protect, so the no-signal
 * short-circuit doesn't apply to them (they may still hit the failure cap).
 */
export function recycleSuppression(
  input: RecycleSuppressionInput,
): RecycleSuppressionResult {
  if (!input.isSelfStation && input.signalLevel === 0) {
    return { suppress: true, reason: "no-signal" };
  }
  if (input.consecutiveFailedRecycles + 1 > MAX_FAILED_RECYCLES) {
    return { suppress: true, reason: "chronic-failure" };
  }
  return { suppress: false };
}
