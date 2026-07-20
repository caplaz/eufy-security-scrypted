/**
 * A temperature source used to protect the host from admitting more
 * compatibility encoders while it is too hot. Returning `undefined` means
 * the platform does not expose a usable temperature reading.
 */
export type TemperatureReader = () =>
  | number
  | undefined
  | null
  | Promise<number | undefined | null>;

export type ThermalGovernorReason =
  | "not-sampled"
  | "unsupported"
  | "read-error"
  | "normal-temperature"
  | "critical-temperature"
  | "above-recovery-temperature"
  | "recovered";

export interface ThermalGovernorStatus {
  /** Whether new compatibility encoder admissions should be denied. */
  throttled: boolean;
  /** Why the governor is allowing or denying a new admission. */
  reason: ThermalGovernorReason;
  /** Most recent usable temperature reading, in degrees Celsius. */
  temperatureC?: number;
}

export interface ThermalGovernorOptions {
  /** Optional host temperature source. Without one the governor is inert. */
  temperatureReader?: TemperatureReader;
  /** Temperature at which new compatibility encoders are denied. */
  criticalTemperatureC?: number;
  /** Temperature at which compatibility encoder admission resumes. */
  recoveryTemperatureC?: number;
  /** Minimum time between admission-triggered temperature samples. */
  samplingIntervalMs?: number;
  /** Injectable clock for deterministic sampling tests. */
  now?: () => number;
}

const DEFAULT_CRITICAL_TEMPERATURE_C = 85;
const DEFAULT_RECOVERY_TEMPERATURE_C = 75;
const DEFAULT_SAMPLING_INTERVAL_MS = 30_000;

/**
 * Applies a hysteresis-based thermal admission gate to compatibility encoders.
 *
 * It only decides whether a *new* compatibility encoder may be admitted. It
 * deliberately has no reference to existing encoders and therefore can never
 * terminate an encoder that is already running.
 */
export class ThermalGovernor {
  private readonly temperatureReader?: TemperatureReader;
  private readonly criticalTemperatureC: number;
  private readonly recoveryTemperatureC: number;
  private readonly samplingIntervalMs: number;
  private readonly now: () => number;
  private status: ThermalGovernorStatus = {
    throttled: false,
    reason: "not-sampled",
  };
  private lastSampleAt?: number;
  private sampleInFlight?: Promise<ThermalGovernorStatus>;

  constructor(options: ThermalGovernorOptions = {}) {
    this.temperatureReader = options.temperatureReader;
    this.criticalTemperatureC =
      options.criticalTemperatureC ?? DEFAULT_CRITICAL_TEMPERATURE_C;
    this.recoveryTemperatureC =
      options.recoveryTemperatureC ?? DEFAULT_RECOVERY_TEMPERATURE_C;
    this.samplingIntervalMs =
      options.samplingIntervalMs ?? DEFAULT_SAMPLING_INTERVAL_MS;
    this.now = options.now ?? Date.now;

    this.validateConfiguration();
  }

  /** Force an immediate sample, irrespective of the sampling interval. */
  public refresh(): Promise<ThermalGovernorStatus> {
    return this.sample();
  }

  /**
   * Sample if due and return whether a new compatibility encoder may start.
   * Concurrent callers share one temperature read and observe the same state.
   */
  public async checkCompatibilityEncoderAdmission(): Promise<boolean> {
    if (this.sampleInFlight || this.isSamplingDue()) {
      await this.sample();
    }

    return this.canAdmitCompatibilityEncoder();
  }

  /** Return the admission decision from the latest sampled state. */
  public canAdmitCompatibilityEncoder(): boolean {
    return !this.status.throttled;
  }

  /** Return a copy so callers cannot mutate the governor's state. */
  public getStatus(): ThermalGovernorStatus {
    return { ...this.status };
  }

  private isSamplingDue(): boolean {
    return (
      this.lastSampleAt === undefined ||
      this.now() - this.lastSampleAt >= this.samplingIntervalMs
    );
  }

  private sample(): Promise<ThermalGovernorStatus> {
    if (this.sampleInFlight) {
      return this.sampleInFlight;
    }

    this.sampleInFlight = this.readTemperature().finally(() => {
      this.sampleInFlight = undefined;
    });
    return this.sampleInFlight;
  }

  private async readTemperature(): Promise<ThermalGovernorStatus> {
    this.lastSampleAt = this.now();

    if (!this.temperatureReader) {
      return this.setInertStatus("unsupported");
    }

    try {
      const temperatureC = await this.temperatureReader();
      if (temperatureC === undefined || temperatureC === null) {
        return this.setInertStatus("unsupported");
      }
      if (!Number.isFinite(temperatureC)) {
        return this.setInertStatus("read-error");
      }

      if (this.status.throttled) {
        this.status =
          temperatureC <= this.recoveryTemperatureC
            ? { throttled: false, reason: "recovered", temperatureC }
            : {
                throttled: true,
                reason: "above-recovery-temperature",
                temperatureC,
              };
      } else {
        this.status =
          temperatureC >= this.criticalTemperatureC
            ? { throttled: true, reason: "critical-temperature", temperatureC }
            : { throttled: false, reason: "normal-temperature", temperatureC };
      }
    } catch {
      return this.setInertStatus("read-error");
    }

    return this.getStatus();
  }

  private setInertStatus(
    reason: Extract<ThermalGovernorReason, "unsupported" | "read-error">,
  ): ThermalGovernorStatus {
    this.status = { throttled: false, reason };
    return this.getStatus();
  }

  private validateConfiguration(): void {
    if (!Number.isFinite(this.criticalTemperatureC)) {
      throw new Error("criticalTemperatureC must be a finite number");
    }
    if (!Number.isFinite(this.recoveryTemperatureC)) {
      throw new Error("recoveryTemperatureC must be a finite number");
    }
    if (this.recoveryTemperatureC >= this.criticalTemperatureC) {
      throw new Error(
        "recoveryTemperatureC must be lower than criticalTemperatureC",
      );
    }
    if (
      !Number.isFinite(this.samplingIntervalMs) ||
      this.samplingIntervalMs < 0
    ) {
      throw new Error(
        "samplingIntervalMs must be a non-negative finite number",
      );
    }
  }
}
