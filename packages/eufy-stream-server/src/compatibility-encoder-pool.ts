import { cpus } from "os";

export type CompatibilityEncoderConsumerKind = "prebuffer" | "interactive";

export interface CompatibilityEncoderAcquireRequest {
  serialNumber: string;
  name?: string;
  consumerKind: CompatibilityEncoderConsumerKind;
  onPreempt?: () => void | Promise<void>;
}

export interface CompatibilityEncoderPoolOptions {
  capacity?: number;
  cpuCount?: number;
  preemptionCooldownMs?: number;
  now?: () => number;
}

export interface CompatibilityEncoderHolder {
  serialNumber: string;
  name?: string;
  consumers: Record<CompatibilityEncoderConsumerKind, number>;
  totalConsumers: number;
  preemptible: boolean;
  acquiredAt: number;
}

export interface CompatibilityEncoderLease {
  readonly serialNumber: string;
  readonly consumerKind: CompatibilityEncoderConsumerKind;
  release(): void;
}

interface LeaseRecord {
  consumerKind: CompatibilityEncoderConsumerKind;
  onPreempt?: () => void | Promise<void>;
}

interface EncoderSlot {
  serialNumber: string;
  name?: string;
  acquiredAt: number;
  sequence: number;
  leases: Map<number, LeaseRecord>;
}

const DEFAULT_PREEMPTION_COOLDOWN_MS = 30_000;

/**
 * Signals that the process-wide H.264 compatibility encoder limit has been
 * reached. The holder snapshot identifies sessions which can be released.
 */
export class CompatibilityEncoderCapacityError extends Error {
  public readonly code = "COMPATIBILITY_ENCODER_CAPACITY";

  public constructor(
    public readonly requestedSerialNumber: string,
    public readonly holders: CompatibilityEncoderHolder[],
    public readonly capacity: number,
  ) {
    super(
      `Compatibility encoder capacity (${capacity}) is exhausted for camera ${requestedSerialNumber}. ` +
        "Release an active compatibility stream or wait for a prebuffer slot to become available.",
    );
    this.name = "CompatibilityEncoderCapacityError";
  }
}

/**
 * Process-wide capacity manager for H.265-to-H.264 compatibility encoders.
 * A camera owns at most one encoder slot, even when several consumers share it.
 */
export class CompatibilityEncoderPool {
  private _capacity: number;

  private readonly slots = new Map<string, EncoderSlot>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly now: () => number;
  private readonly preemptionCooldownMs: number;
  private nextLeaseId = 0;
  private nextSequence = 0;

  public constructor(options: CompatibilityEncoderPoolOptions = {}) {
    const cpuCount = options.cpuCount ?? cpus().length;
    this._capacity = options.capacity ?? defaultCapacity(cpuCount);
    this.assertCapacity(this._capacity);

    this.preemptionCooldownMs =
      options.preemptionCooldownMs ?? DEFAULT_PREEMPTION_COOLDOWN_MS;
    if (this.preemptionCooldownMs < 0) {
      throw new RangeError("Compatibility encoder pool cooldown must not be negative");
    }
    this.now = options.now ?? Date.now;
  }

  public get capacity(): number {
    return this._capacity;
  }

  /**
   * Update the admission limit without dropping existing leases. Lowering the
   * limit below the active holder count blocks all new admissions until enough
   * existing relays release themselves.
   */
  public setCapacity(capacity: number): void {
    this.assertCapacity(capacity);
    this._capacity = capacity;
  }

  public acquire(request: CompatibilityEncoderAcquireRequest): CompatibilityEncoderLease {
    const existing = this.slots.get(request.serialNumber);
    if (existing) {
      if (request.name && !existing.name) {
        existing.name = request.name;
      }
      return this.addLease(existing, request);
    }

    const now = this.now();
    const inCooldown = (this.cooldownUntil.get(request.serialNumber) ?? 0) > now;
    if (!inCooldown) {
      this.cooldownUntil.delete(request.serialNumber);
    }

    // Never replace a holder while the pool is already over a newly lowered
    // capacity. Existing relays are allowed to drain, but new callers cannot
    // use preemption to slip into the over-capacity set.
    if (this.slots.size > this.capacity) {
      throw new CompatibilityEncoderCapacityError(
        request.serialNumber,
        this.getDiagnostics(),
        this.capacity,
      );
    }

    if (this.slots.size >= this.capacity) {
      const victim =
        request.consumerKind === "interactive" && !inCooldown
          ? this.findOldestPreemptibleSlot()
          : undefined;
      if (victim) {
        const slot = this.createSlot(request, now);
        // Attach the requesting interactive lease before notifying the victim.
        // A synchronous callback can now reenter acquire, but it sees this
        // protected slot and cannot take the capacity we just made available.
        const lease = this.addLease(slot, request);
        this.preempt(victim, now, slot);
        return lease;
      }
    }

    if (this.slots.size >= this.capacity) {
      throw new CompatibilityEncoderCapacityError(
        request.serialNumber,
        this.getDiagnostics(),
        this.capacity,
      );
    }

    const slot = this.createSlot(request, now);
    this.slots.set(slot.serialNumber, slot);
    return this.addLease(slot, request);
  }

  public get diagnostics(): CompatibilityEncoderHolder[] {
    return this.getDiagnostics();
  }

  public getDiagnostics(): CompatibilityEncoderHolder[] {
    return [...this.slots.values()].map((slot) => this.toHolder(slot));
  }

  private addLease(
    slot: EncoderSlot,
    request: CompatibilityEncoderAcquireRequest,
  ): CompatibilityEncoderLease {
    const leaseId = this.nextLeaseId++;
    slot.leases.set(leaseId, {
      consumerKind: request.consumerKind,
      onPreempt: request.onPreempt,
    });
    let released = false;

    return {
      serialNumber: slot.serialNumber,
      consumerKind: request.consumerKind,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.release(slot, leaseId);
      },
    };
  }

  private release(slot: EncoderSlot, leaseId: number): void {
    if (this.slots.get(slot.serialNumber) !== slot) {
      return;
    }
    slot.leases.delete(leaseId);
    if (slot.leases.size === 0) {
      this.slots.delete(slot.serialNumber);
    }
  }

  private findOldestPreemptibleSlot(): EncoderSlot | undefined {
    return [...this.slots.values()]
      .filter((slot) => this.isPreemptible(slot))
      .sort(
        (left, right) =>
          left.acquiredAt - right.acquiredAt || left.sequence - right.sequence,
      )[0];
  }

  private createSlot(
    request: CompatibilityEncoderAcquireRequest,
    acquiredAt: number,
  ): EncoderSlot {
    return {
      serialNumber: request.serialNumber,
      name: request.name,
      acquiredAt,
      sequence: this.nextSequence++,
      leases: new Map(),
    };
  }

  private preempt(
    slot: EncoderSlot,
    now: number,
    replacement: EncoderSlot,
  ): void {
    this.slots.delete(slot.serialNumber);
    this.cooldownUntil.set(slot.serialNumber, now + this.preemptionCooldownMs);
    this.slots.set(replacement.serialNumber, replacement);

    for (const lease of slot.leases.values()) {
      try {
        const result = lease.onPreempt?.();
        if (result) {
          void result.catch(() => undefined);
        }
      } catch {
        // An eviction callback is cleanup work; it must not prevent capacity release.
      }
    }
    slot.leases.clear();
  }

  private isPreemptible(slot: EncoderSlot): boolean {
    return slot.leases.size > 0 &&
      [...slot.leases.values()].every((lease) => lease.consumerKind === "prebuffer");
  }

  private toHolder(slot: EncoderSlot): CompatibilityEncoderHolder {
    const consumers: Record<CompatibilityEncoderConsumerKind, number> = {
      prebuffer: 0,
      interactive: 0,
    };
    for (const lease of slot.leases.values()) {
      consumers[lease.consumerKind]++;
    }
    return {
      serialNumber: slot.serialNumber,
      name: slot.name,
      consumers,
      totalConsumers: slot.leases.size,
      preemptible: this.isPreemptible(slot),
      acquiredAt: slot.acquiredAt,
    };
  }

  private assertCapacity(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        "Compatibility encoder pool capacity must be a positive integer",
      );
    }
  }
}

function defaultCapacity(cpuCount: number): number {
  return Math.max(1, Math.min(4, Math.floor(cpuCount / 2)));
}
