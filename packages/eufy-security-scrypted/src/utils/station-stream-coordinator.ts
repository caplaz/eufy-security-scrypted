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
}

interface Holder {
  deviceSN: string;
  priority: StreamPriority;
  onRevoke: () => void;
  /** Callbacks fired when THIS holder's lease is released. */
  onReleased: Array<() => void>;
}

// Max time a preemptor waits for the previous holder to release before
// starting anyway (the holder should stop within ~1-2s; this just prevents a
// hang if it never does).
const PREEMPT_HANDOFF_TIMEOUT_MS = 4000;

const holders = new Map<string, Holder>();

/**
 * Attempt to acquire the single stream slot for `stationSN` on behalf of
 * `deviceSN`. Returns a lease, or null if denied (background and the slot is
 * busy). For "live" this always succeeds, preempting any current holder.
 */
export function acquireStationSlot(
  stationSN: string,
  deviceSN: string,
  priority: StreamPriority,
  onRevoke: () => void,
): StationSlotLease | null {
  const current = holders.get(stationSN);

  let whenReady: Promise<void> = Promise.resolve();

  if (current && current.deviceSN !== deviceSN) {
    if (priority === "background") {
      // Background never interrupts a holder.
      return null;
    }
    // "live": preempt whoever holds it (background OR an older live session).
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

  const holder: Holder = { deviceSN, priority, onRevoke, onReleased: [] };
  holders.set(stationSN, holder);

  let released = false;
  return {
    whenReady,
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

/** Test-only: clear all slot state. */
export function _resetStationStreamCoordinator(): void {
  holders.clear();
}
