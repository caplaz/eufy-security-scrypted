/**
 * Station stream coordinator
 *
 * A Eufy HomeBase serves only ONE camera P2P stream at a time. Starting a
 * second stream starves the first, and two simultaneous starts break both.
 * This coordinator enforces a single "slot" per station so cameras never
 * stampede the shared HomeBase.
 *
 * Process-wide and keyed by station serial (4G LTE cameras are their own
 * station, so they never contend with each other). All EufyDevices in a
 * Scrypted plugin share one process, so a module-level map is sufficient.
 *
 * Priorities:
 *   - "live"       — a real viewer/recorder (HomeKit live view, HKSV).
 *   - "background" — the serial thumbnail refresh.
 *
 * Rules:
 *   - Slot free            → granted.
 *   - "live" wants a held slot → PREEMPT the holder (its onRevoke fires, it
 *                             must stop), then grant. This covers both
 *                             live-over-background and live-over-live
 *                             ("newest tap wins").
 *   - "background" wants a held slot → DENIED (returns null). Background work
 *                             never interrupts a viewer/recorder; the caller
 *                             skips that camera and tries again later.
 *
 * The grant is SYNCHRONOUS (in-memory) so callers can gate `startLivestream`
 * without introducing async races. `onRevoke` triggers the previous holder's
 * stop asynchronously; its eventual `release()` is a no-op once the slot has
 * moved on.
 *
 * @module utils/station-stream-coordinator
 */

export type StreamPriority = "live" | "background";

export interface StationSlotLease {
  /** Release the slot (idempotent). No-op if already superseded/released. */
  release(): void;
  /** True while this lease still owns the station slot. */
  readonly active: boolean;
  /**
   * Resolves when it is safe to actually start streaming: if this grant
   * preempted another camera, it resolves once that camera has released
   * (or a safety timeout), so the two don't overlap on the HomeBase. When
   * nothing was preempted it is already resolved.
   */
  readonly whenReady: Promise<void>;
  /**
   * Mark that this camera is now actually delivering video. A delivering
   * holder will NOT be preempted by another camera's live request — only a
   * stuck/warming holder can be taken over. This is what stops the Home-app
   * grid (which fires a live preview request per camera) from kicking a
   * working stream off the single HomeBase slot.
   */
  markDelivering(): void;
}

interface Holder {
  deviceSN: string;
  priority: StreamPriority;
  onRevoke: () => void;
  /** Callbacks fired when THIS holder's lease is released. */
  onReleased: Array<() => void>;
  /** When this holder acquired the slot (for the warm-up grace). */
  acquiredAt: number;
  /** Whether this holder is actually delivering video yet. */
  isDelivering: boolean;
}

// Max time a preemptor waits for the previous holder to release before
// starting anyway (the holder should stop within ~1-2s; this just prevents a
// hang if it never does).
const PREEMPT_HANDOFF_TIMEOUT_MS = 4000;

// A freshly-granted holder is protected from preemption this long, giving a
// battery camera time to wake and deliver its first frame before another
// request can take the slot. Prevents the grid's burst of live requests from
// thrashing during warm-up.
const PREEMPT_MIN_HOLD_MS = 8000;

const holders = new Map<string, Holder>();

/**
 * Attempt to acquire the single stream slot for `stationSN` on behalf of
 * `deviceSN`.
 *
 * Returns a lease, or null if DENIED:
 *  - "background" is denied whenever the slot is held.
 *  - "live" is denied only while the current live holder is within its brief
 *    warm-up window (`PREEMPT_MIN_HOLD_MS`). Past that window a live request
 *    takes over the slot — newest tap wins — via a clean handoff, even from a
 *    holder that is actively delivering. The warm-up window absorbs the
 *    Home-app grid's burst of near-simultaneous live requests (they all land
 *    within a second or two, so they hit the guard and are denied, letting one
 *    camera win without thrash); a request that arrives AFTER the window is
 *    necessarily a deliberate switch to another camera and is honored.
 *
 * @param nowMs - current time (injectable for tests)
 */
export function acquireStationSlot(
  stationSN: string,
  deviceSN: string,
  priority: StreamPriority,
  onRevoke: () => void,
  nowMs: number = Date.now(),
): StationSlotLease | null {
  const current = holders.get(stationSN);

  let whenReady: Promise<void> = Promise.resolve();

  if (current && current.deviceSN !== deviceSN) {
    if (priority === "background") {
      // Background never interrupts a holder.
      return null;
    }
    // "live" always beats a background holder (a thumbnail refresh). Against
    // another LIVE holder, protect it ONLY during its warm-up window: that
    // absorbs the Home-app grid's stampede of near-simultaneous live requests
    // (all within a second or two → denied → one camera wins, no thrash).
    // After the window, a live request is necessarily a deliberate switch to
    // another camera, so it preempts and takes over — newest tap wins — even
    // from a delivering holder. Switches are therefore spaced at least one
    // warm-up apart, which keeps the takeover from churning the HomeBase.
    if (current.priority === "live") {
      const withinWarmup = nowMs - current.acquiredAt < PREEMPT_MIN_HOLD_MS;
      if (withinWarmup) {
        return null;
      }
    }
    // Wait for the preempted holder to release before we start, so the two
    // don't overlap on the single HomeBase slot.
    whenReady = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      current.onReleased.push(finish);
      setTimeout(finish, PREEMPT_HANDOFF_TIMEOUT_MS);
    });
    try {
      current.onRevoke();
    } catch {
      // A misbehaving revoke handler must not block the new grant.
    }
  }

  const holder: Holder = {
    deviceSN,
    priority,
    onRevoke,
    onReleased: [],
    acquiredAt: nowMs,
    isDelivering: false,
  };
  holders.set(stationSN, holder);

  let released = false;
  return {
    whenReady,
    markDelivering() {
      holder.isDelivering = true;
    },
    get active() {
      return !released && holders.get(stationSN) === holder;
    },
    release() {
      if (released) return;
      released = true;
      // Notify any preemptor waiting for us to step off the slot.
      const callbacks = holder.onReleased;
      holder.onReleased = [];
      for (const cb of callbacks) {
        try {
          cb();
        } catch {
          // ignore
        }
      }
      // Only clear the map if WE still own it (a later acquire may have
      // already replaced us — don't clobber the new holder).
      if (holders.get(stationSN) === holder) holders.delete(stationSN);
    },
  };
}

/**
 * Is the station slot currently held by a device OTHER than `deviceSN`?
 * Used to decide whether a "no video" condition is a real upstream wedge
 * (we hold the slot and still get nothing) versus expected contention
 * (someone else holds it), so we don't recycle the HomeBase needlessly.
 */
export function isStationSlotHeldByOther(
  stationSN: string,
  deviceSN: string,
): boolean {
  const h = holders.get(stationSN);
  return !!h && h.deviceSN !== deviceSN;
}

/** The device currently holding the slot, or undefined. */
export function stationSlotHolder(stationSN: string): string | undefined {
  return holders.get(stationSN)?.deviceSN;
}

/**
 * If another device on `stationSN` currently holds the slot AND is actually
 * delivering video, return its serial; otherwise undefined. Used to decide
 * whether to defer a station P2P recycle (don't tear down a sibling's working
 * stream). Replaces the old separate "stream registry".
 */
export function otherDeviceDeliveringOnStation(
  stationSN: string,
  deviceSN: string,
): string | undefined {
  const h = holders.get(stationSN);
  return h && h.deviceSN !== deviceSN && h.isDelivering
    ? h.deviceSN
    : undefined;
}

/** Test-only: clear all slot state. */
export function _resetStationStreamCoordinator(): void {
  holders.clear();
}
