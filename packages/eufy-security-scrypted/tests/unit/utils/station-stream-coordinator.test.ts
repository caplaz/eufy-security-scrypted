/**
 * Station stream coordinator tests
 */

import {
  acquireStationSlot,
  isStationSlotHeldByOther,
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

  it("live PREEMPTS an older live holder (newest tap wins)", () => {
    const revokeA = jest.fn();
    acquireStationSlot(ST, A, "live", revokeA);
    const leaseB = acquireStationSlot(ST, B, "live", () => {});
    expect(revokeA).toHaveBeenCalledTimes(1);
    expect(leaseB).not.toBeNull();
    expect(stationSlotHolder(ST)).toBe(B);
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
    const leaseA = acquireStationSlot(ST, A, "live", () => {});
    const leaseB = acquireStationSlot(ST, B, "live", () => {});

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
    const leaseA = acquireStationSlot(ST, A, "live", () => {});
    acquireStationSlot(ST, B, "live", () => {}); // preempts A
    leaseA!.release(); // A finally tears down
    expect(stationSlotHolder(ST)).toBe(B);
    expect(isStationSlotHeldByOther(ST, B)).toBe(false);
  });
});
