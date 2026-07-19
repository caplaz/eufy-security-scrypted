import { ThermalGovernor } from "../src/thermal-governor";

describe("ThermalGovernor", () => {
  it("throttles new compatibility encoder admissions at and above the critical temperature", async () => {
    const governor = new ThermalGovernor({
      temperatureReader: async () => 80,
      criticalTemperatureC: 80,
      recoveryTemperatureC: 70,
    });

    await governor.refresh();

    expect(governor.canAdmitCompatibilityEncoder()).toBe(false);
    expect(governor.getStatus()).toMatchObject({
      throttled: true,
      reason: "critical-temperature",
      temperatureC: 80,
    });
  });

  it("keeps throttling until the temperature reaches the recovery threshold", async () => {
    const temperatures = [80, 75, 70];
    const governor = new ThermalGovernor({
      temperatureReader: async () => temperatures.shift(),
      criticalTemperatureC: 80,
      recoveryTemperatureC: 70,
    });

    await governor.refresh();
    expect(governor.canAdmitCompatibilityEncoder()).toBe(false);

    await governor.refresh();
    expect(governor.canAdmitCompatibilityEncoder()).toBe(false);
    expect(governor.getStatus().reason).toBe("above-recovery-temperature");

    await governor.refresh();
    expect(governor.canAdmitCompatibilityEncoder()).toBe(true);
    expect(governor.getStatus()).toMatchObject({
      throttled: false,
      reason: "recovered",
      temperatureC: 70,
    });
  });

  it("is inert when temperature readings are unsupported", async () => {
    const governor = new ThermalGovernor({
      temperatureReader: async () => undefined,
    });

    await governor.refresh();

    expect(governor.canAdmitCompatibilityEncoder()).toBe(true);
    expect(governor.getStatus()).toEqual({
      throttled: false,
      reason: "unsupported",
    });
  });

  it("is inert when the temperature reader errors", async () => {
    const governor = new ThermalGovernor({
      temperatureReader: async () => {
        throw new Error("sensor unavailable");
      },
    });

    await governor.refresh();

    expect(governor.canAdmitCompatibilityEncoder()).toBe(true);
    expect(governor.getStatus()).toEqual({
      throttled: false,
      reason: "read-error",
    });
  });

  it("shares an in-flight sampled admission check", async () => {
    let reads = 0;
    let releaseReading: (temperature: number) => void = () => undefined;
    const reading = new Promise<number>((resolve) => {
      releaseReading = resolve;
    });
    const governor = new ThermalGovernor({
      temperatureReader: () => {
        reads += 1;
        return reading;
      },
    });

    const first = governor.refresh();
    const second = governor.refresh();
    releaseReading(65);
    await Promise.all([first, second]);

    expect(reads).toBe(1);
  });

  it("samples on compatibility admissions only after the configured interval", async () => {
    let now = 1_000;
    const temperatures = [75, 80];
    const reader = jest.fn(async () => temperatures.shift());
    const governor = new ThermalGovernor({
      temperatureReader: reader,
      criticalTemperatureC: 80,
      recoveryTemperatureC: 70,
      samplingIntervalMs: 100,
      now: () => now,
    });

    await expect(governor.checkCompatibilityEncoderAdmission()).resolves.toBe(
      true,
    );
    now += 99;
    await expect(governor.checkCompatibilityEncoderAdmission()).resolves.toBe(
      true,
    );
    now += 1;
    await expect(governor.checkCompatibilityEncoderAdmission()).resolves.toBe(
      false,
    );

    expect(reader).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ criticalTemperatureC: 70, recoveryTemperatureC: 70 }],
    [{ criticalTemperatureC: 70, recoveryTemperatureC: 71 }],
    [{ criticalTemperatureC: Number.NaN }],
    [{ recoveryTemperatureC: Number.POSITIVE_INFINITY }],
    [{ samplingIntervalMs: -1 }],
  ])("rejects invalid configuration: %o", (options) => {
    expect(() => new ThermalGovernor(options)).toThrow();
  });
});
