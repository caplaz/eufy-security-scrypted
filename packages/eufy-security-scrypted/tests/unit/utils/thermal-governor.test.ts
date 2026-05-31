/**
 * Thermal governor tests
 */

import {
  ThermalGovernor,
  ThermalLevel,
  startThermalGovernor,
  isTranscodeThermallyThrottled,
  getThermalState,
  _resetThermalGovernor,
} from "../../../src/utils/thermal-governor";

describe("ThermalGovernor", () => {
  let temp: number | null;
  const make = (onAlert?: any) =>
    new ThermalGovernor({ readTempC: () => temp, onAlert });

  beforeEach(() => {
    temp = 50;
  });

  it("starts normal and does not throttle when cool", () => {
    const g = make();
    temp = 55;
    g.tick();
    expect(g.thermalLevel).toBe("normal");
    expect(g.shouldThrottleTranscode()).toBe(false);
    expect(g.temperatureC).toBe(55);
  });

  it("enters warn at the warn threshold, critical at the critical threshold", () => {
    const g = make();
    temp = 70;
    g.tick();
    expect(g.thermalLevel).toBe("warn");
    expect(g.shouldThrottleTranscode()).toBe(false);

    temp = 78;
    g.tick();
    expect(g.thermalLevel).toBe("critical");
    expect(g.shouldThrottleTranscode()).toBe(true);
  });

  it("uses hysteresis: stays critical until well below the critical threshold", () => {
    const g = make();
    temp = 80;
    g.tick();
    expect(g.thermalLevel).toBe("critical");

    // Just below criticalC (78) but above clearCriticalC (72) → still critical.
    temp = 75;
    g.tick();
    expect(g.thermalLevel).toBe("critical");
    expect(g.shouldThrottleTranscode()).toBe(true);

    // Below clearCriticalC but above clearWarnC (66) → warn (no throttle).
    temp = 71;
    g.tick();
    expect(g.thermalLevel).toBe("warn");
    expect(g.shouldThrottleTranscode()).toBe(false);

    // Below clearWarnC → normal.
    temp = 60;
    g.tick();
    expect(g.thermalLevel).toBe("normal");
  });

  it("never throttles when the temperature is unreadable, even after being hot", () => {
    const g = make();
    temp = 85;
    g.tick();
    expect(g.shouldThrottleTranscode()).toBe(true);

    temp = null;
    g.tick();
    expect(g.thermalLevel).toBe("normal");
    expect(g.shouldThrottleTranscode()).toBe(false);
    expect(g.temperatureC).toBeNull();
  });

  it("fires an alert on each level transition", () => {
    const alerts: ThermalLevel[] = [];
    const g = make((level: ThermalLevel) => alerts.push(level));

    temp = 60;
    g.tick(); // normal → normal: no alert
    temp = 72;
    g.tick(); // → warn
    temp = 80;
    g.tick(); // → critical
    temp = 50;
    g.tick(); // → normal

    expect(alerts).toEqual(["warn", "critical", "normal"]);
  });

  it("respects custom thresholds", () => {
    temp = 60;
    const g = new ThermalGovernor({
      readTempC: () => temp,
      warnC: 55,
      criticalC: 58,
    });
    g.tick();
    expect(g.thermalLevel).toBe("critical");
  });

  describe("singleton helpers", () => {
    afterEach(() => _resetThermalGovernor());

    it("isTranscodeThermallyThrottled reflects the running governor", () => {
      let t = 50;
      const g = startThermalGovernor({ readTempC: () => t });
      expect(isTranscodeThermallyThrottled()).toBe(false);

      t = 90;
      g.tick();
      expect(isTranscodeThermallyThrottled()).toBe(true);
      expect(getThermalState()).toEqual({ level: "critical", tempC: 90 });
    });

    it("isTranscodeThermallyThrottled is false when no governor is running", () => {
      _resetThermalGovernor();
      expect(isTranscodeThermallyThrottled()).toBe(false);
      expect(getThermalState()).toEqual({ level: "normal", tempC: null });
    });
  });
});
