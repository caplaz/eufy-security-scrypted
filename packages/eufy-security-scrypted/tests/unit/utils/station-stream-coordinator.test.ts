/**
 * Station stream coordinator tests
 */

import {
  acquireStationSlot,
  isStationSlotHeldByOther,
  otherDeviceDeliveringOnStation,
  stationSlotHolder,
  _resetStationStreamCoordinator,
} from "../../../src/utils/station-stream-coordinator";

const ST = "T8030HOMEBASE";
const A = "CAM_A";
const B = "CAM_B";
const C = "CAM_C";

describe("station-stream-coordinator", () => {
  beforeEach(() => _resetStationStreamCoordinator());

  it("grants the slot when free", () => {
    const lease = acquireStationSlot(ST, A, "live", () => {});
    expect(lease).not.toBeNull();
    expect(lease!.active).toBe(true);
    expect(stationSlotHolder(ST)).toBe(A);
  });

  it("denies a background request when the slot is held", () => {
    acquireStationSlot(ST, A, "live", () => {});
    const bg = acquireStationSlot(ST, B, "background", () => {});
    expect(bg).toBeNull();
    expect(stationSlotHolder(ST)).toBe(A);
  });

  it("grants a background request when the slot is free", () => {
    const bg = acquireStationSlot(ST, A, "background", () => {});
    expect(bg).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(A);
  });

  it("live PREEMPTS a background holder (revoke fires) and takes the slot", () => {
    const revokeA = jest.fn();
    const leaseA = acquireStationSlot(ST, A, "background", revokeA);
    const leaseB = acquireStationSlot(ST, B, "live", () => {});
    expect(revokeA).toHaveBeenCalledTimes(1);
    expect(leaseB).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(B);
    // A's lease is no longer active and its release is a harmless no-op.
    expect(leaseA!.active).toBe(false);
    leaseA!.release();
    expect(stationSlotHolder(ST)).toBe(B); // not clobbered
  });

  it("live preempts a STUCK older live holder (past warm-up, not delivering)", () => {
    const revokeA = jest.fn();
    acquireStationSlot(ST, A, "live", revokeA, 0);
    // B requests past A's warm-up grace; A never started delivering → take over.
    const leaseB = acquireStationSlot(ST, B, "live", () => {}, 9000);
    expect(revokeA).toHaveBeenCalledTimes(1);
    expect(leaseB).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(B);
  });

  it("live does NOT preempt a live holder still in its warm-up grace", () => {
    const revokeA = jest.fn();
    acquireStationSlot(ST, A, "live", revokeA, 0);
    const leaseB = acquireStationSlot(ST, B, "live", () => {}, 1000); // within 8s
    expect(revokeA).not.toHaveBeenCalled();
    expect(leaseB).toBeNull();
    expect(stationSlotHolder(ST)).toBe(A);
  });

  it("live preempts a DELIVERING live holder once past the warm-up window (deliberate switch wins)", () => {
    const revokeA = jest.fn();
    const leaseA = acquireStationSlot(ST, A, "live", revokeA, 0);
    leaseA!.markDelivering();
    // A request that arrives after the warm-up window is a deliberate switch to
    // another camera — it takes over even though A is delivering.
    const leaseB = acquireStationSlot(ST, B, "live", () => {}, 100000);
    expect(revokeA).toHaveBeenCalledTimes(1);
    expect(leaseB).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(B);
  });

  it("a DELIVERING live holder is still protected DURING its warm-up window", () => {
    const revokeA = jest.fn();
    const leaseA = acquireStationSlot(ST, A, "live", revokeA, 0);
    leaseA!.markDelivering();
    // Within warm-up (the grid-burst window) even a delivering holder is not
    // kicked off, so the stampede of near-simultaneous requests can't thrash.
    const leaseB = acquireStationSlot(ST, B, "live", () => {}, 1000);
    expect(revokeA).not.toHaveBeenCalled();
    expect(leaseB).toBeNull();
    expect(stationSlotHolder(ST)).toBe(A);
  });

  it("does not preempt or revoke when the same device re-acquires", () => {
    const revokeA = jest.fn();
    acquireStationSlot(ST, A, "live", revokeA);
    const again = acquireStationSlot(ST, A, "live", revokeA);
    expect(revokeA).not.toHaveBeenCalled();
    expect(again).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(A);
  });

  it("frees the slot on release so the next camera can take it", () => {
    const lease = acquireStationSlot(ST, A, "live", () => {});
    lease!.release();
    expect(stationSlotHolder(ST)).toBeUndefined();
    const bg = acquireStationSlot(ST, B, "background", () => {});
    expect(bg).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(B);
  });

  it("keeps stations independent (4G self-stations never contend)", () => {
    acquireStationSlot("STATION_1", A, "live", () => {});
    const other = acquireStationSlot("STATION_2", B, "background", () => {});
    expect(other).not.toBeNull(); // different station → free
  });

  it("isStationSlotHeldByOther reflects ownership", () => {
    acquireStationSlot(ST, A, "live", () => {});
    expect(isStationSlotHeldByOther(ST, B)).toBe(true);
    expect(isStationSlotHeldByOther(ST, A)).toBe(false);
  });

  it("otherDeviceDeliveringOnStation only reports a DELIVERING sibling", () => {
    const leaseA = acquireStationSlot(ST, A, "live", () => {});
    // Holds the slot but not delivering yet → not reported.
    expect(otherDeviceDeliveringOnStation(ST, B)).toBeUndefined();
    leaseA!.markDelivering();
    expect(otherDeviceDeliveringOnStation(ST, B)).toBe(A);
    // Never reports the querying device itself.
    expect(otherDeviceDeliveringOnStation(ST, A)).toBeUndefined();
    leaseA!.release();
    expect(otherDeviceDeliveringOnStation(ST, B)).toBeUndefined();
  });

  it("whenReady resolves immediately when the slot was free", async () => {
    const lease = acquireStationSlot(ST, A, "live", () => {});
    await expect(
      Promise.race([
        lease!.whenReady.then(() => "ready"),
        new Promise((r) => setTimeout(() => r("timeout"), 100)),
      ]),
    ).resolves.toBe("ready");
  });

  it("whenReady waits for the preempted holder to release before resolving", async () => {
    const leaseA = acquireStationSlot(ST, A, "live", () => {}, 0);
    const leaseB = acquireStationSlot(ST, B, "live", () => {}, 9000); // preempts stuck A

    // Before A releases, B is not yet ready.
    const early = await Promise.race([
      leaseB!.whenReady.then(() => "ready"),
      new Promise((r) => setTimeout(() => r("pending"), 60)),
    ]);
    expect(early).toBe("pending");

    // Once A releases, B becomes ready.
    leaseA!.release();
    await expect(leaseB!.whenReady.then(() => "ready")).resolves.toBe("ready");
  });

  it("a revoked holder releasing does not delete a newer holder's slot", () => {
    const leaseA = acquireStationSlot(ST, A, "live", () => {}, 0);
    acquireStationSlot(ST, B, "live", () => {}, 9000); // preempts stuck A
    leaseA!.release(); // A finally tears down
    expect(stationSlotHolder(ST)).toBe(B);
    expect(isStationSlotHeldByOther(ST, B)).toBe(false);
  });
});
