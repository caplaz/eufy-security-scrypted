import {
  CompatibilityEncoderCapacityError,
  CompatibilityEncoderPool,
} from "../src/compatibility-encoder-pool";

describe("CompatibilityEncoderPool", () => {
  it("uses a bounded default capacity derived from the CPU count", () => {
    expect(new CompatibilityEncoderPool({ cpuCount: 1 }).capacity).toBe(1);
    expect(new CompatibilityEncoderPool({ cpuCount: 7 }).capacity).toBe(3);
    expect(new CompatibilityEncoderPool({ cpuCount: 24 }).capacity).toBe(4);
  });

  it("shares one slot when a camera acquires more than one consumer", () => {
    const pool = new CompatibilityEncoderPool({ capacity: 1 });
    const prebuffer = pool.acquire({
      serialNumber: "camera-1",
      name: "Front door",
      consumerKind: "prebuffer",
    });
    const interactive = pool.acquire({
      serialNumber: "camera-1",
      consumerKind: "interactive",
    });

    expect(pool.diagnostics).toEqual([
      expect.objectContaining({
        serialNumber: "camera-1",
        name: "Front door",
        consumers: { interactive: 1, prebuffer: 1 },
        preemptible: false,
      }),
    ]);

    prebuffer.release();
    interactive.release();
  });

  it("denies capacity with actionable holder diagnostics", () => {
    const pool = new CompatibilityEncoderPool({ capacity: 1 });
    pool.acquire({
      serialNumber: "camera-1",
      name: "Driveway",
      consumerKind: "interactive",
    });

    let error: unknown;
    try {
      pool.acquire({ serialNumber: "camera-2", consumerKind: "prebuffer" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CompatibilityEncoderCapacityError);
    expect(error).toMatchObject({
      code: "COMPATIBILITY_ENCODER_CAPACITY",
      requestedSerialNumber: "camera-2",
      holders: [expect.objectContaining({ serialNumber: "camera-1", name: "Driveway" })],
    });
  });

  it("makes a prebuffer holder non-preemptible while an interactive consumer is attached", () => {
    const pool = new CompatibilityEncoderPool({ capacity: 1 });
    pool.acquire({ serialNumber: "camera-1", consumerKind: "prebuffer" });
    pool.acquire({ serialNumber: "camera-1", consumerKind: "interactive" });

    expect(() =>
      pool.acquire({ serialNumber: "camera-2", consumerKind: "interactive" }),
    ).toThrow(CompatibilityEncoderCapacityError);
    expect(pool.diagnostics[0]).toMatchObject({ serialNumber: "camera-1", preemptible: false });
  });

  it("preempts the oldest all-prebuffer holder for an interactive request", () => {
    let clock = 100;
    const pool = new CompatibilityEncoderPool({ capacity: 2, now: () => clock });
    const evictOldest = jest.fn(() => {
      throw new Error("eviction cleanup must not block capacity release");
    });
    pool.acquire({
      serialNumber: "camera-1",
      consumerKind: "prebuffer",
      onPreempt: evictOldest,
    });
    clock++;
    pool.acquire({ serialNumber: "camera-2", consumerKind: "prebuffer" });

    pool.acquire({ serialNumber: "camera-3", consumerKind: "interactive" });

    expect(evictOldest).toHaveBeenCalledTimes(1);
    expect(pool.diagnostics.map((holder) => holder.serialNumber)).toEqual([
      "camera-2",
      "camera-3",
    ]);
  });

  it("never preempts an interactive holder", () => {
    const pool = new CompatibilityEncoderPool({ capacity: 2 });
    pool.acquire({ serialNumber: "camera-1", consumerKind: "interactive" });
    pool.acquire({ serialNumber: "camera-2", consumerKind: "interactive" });

    expect(() =>
      pool.acquire({ serialNumber: "camera-3", consumerKind: "interactive" }),
    ).toThrow(CompatibilityEncoderCapacityError);
  });

  it("does not let a displaced prebuffer cascade by evicting another holder during cooldown", () => {
    let clock = 100;
    const pool = new CompatibilityEncoderPool({
      capacity: 1,
      now: () => clock,
      preemptionCooldownMs: 1000,
    });
    pool.acquire({ serialNumber: "camera-1", consumerKind: "prebuffer" });
    const interactive = pool.acquire({
      serialNumber: "camera-2",
      consumerKind: "interactive",
    });

    expect(() =>
      pool.acquire({ serialNumber: "camera-1", consumerKind: "prebuffer" }),
    ).toThrow(CompatibilityEncoderCapacityError);
    expect(pool.diagnostics).toEqual([
      expect.objectContaining({ serialNumber: "camera-2", preemptible: false }),
    ]);

    clock += 1001;
    interactive.release();
    const reAdmitted = pool.acquire({
      serialNumber: "camera-1",
      consumerKind: "prebuffer",
    });
    expect(pool.diagnostics[0]).toMatchObject({ serialNumber: "camera-1", preemptible: true });
    reAdmitted.release();
  });

  it("does not let a displaced camera evict another prebuffer holder during cooldown", () => {
    const pool = new CompatibilityEncoderPool({
      capacity: 1,
      now: () => 100,
      preemptionCooldownMs: 1000,
    });
    pool.acquire({ serialNumber: "camera-a", consumerKind: "prebuffer" });
    const cameraBInteractive = pool.acquire({
      serialNumber: "camera-b",
      consumerKind: "interactive",
    });

    // Free the interactive slot, then let B occupy it with a prebuffer. A's
    // retry is interactive, so this proves cooldown—not consumer kind—blocks
    // a cascade eviction of B.
    cameraBInteractive.release();
    pool.acquire({ serialNumber: "camera-b", consumerKind: "prebuffer" });
    expect(() =>
      pool.acquire({ serialNumber: "camera-a", consumerKind: "interactive" }),
    ).toThrow(CompatibilityEncoderCapacityError);
    expect(pool.diagnostics).toEqual([
      expect.objectContaining({ serialNumber: "camera-b", preemptible: true }),
    ]);
  });

  it("releases leases idempotently and updates consumer composition on detach", () => {
    const pool = new CompatibilityEncoderPool({ capacity: 1 });
    const prebuffer = pool.acquire({ serialNumber: "camera-1", consumerKind: "prebuffer" });
    const interactive = pool.acquire({ serialNumber: "camera-1", consumerKind: "interactive" });

    interactive.release();
    interactive.release();
    expect(pool.diagnostics[0]).toMatchObject({
      consumers: { interactive: 0, prebuffer: 1 },
      preemptible: true,
    });

    prebuffer.release();
    prebuffer.release();
    expect(pool.diagnostics).toEqual([]);
  });
});
