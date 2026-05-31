/**
 * Thermal governor
 *
 * The in-plugin H.264 transcode ([[in-plugin-h264-transcode]]) is a software
 * (libx264) encode per active stream, which can heat a small host (the Pi) under
 * concurrent streams. This governor periodically reads the host CPU temperature,
 * warns when it gets hot, and auto-throttles new transcodes when it gets
 * critically hot so the host can't cook itself.
 *
 * Process-wide singleton (one host, one temperature). The transcode path checks
 * `isTranscodeThermallyThrottled()`; when true, new streams fall back to H.265
 * passthrough (no encode) until the host cools. Existing encodes are left to
 * finish on their own — short live-view sessions — rather than killed mid-frame.
 *
 * If the temperature source is unreadable (non-Pi host, sandbox without sysfs),
 * the governor stays inert and NEVER throttles — it can only ever make the
 * transcode path more conservative, never break it on a host it can't measure.
 *
 * @module utils/thermal-governor
 */

import * as fs from "fs";
import { Logger, ILogObj } from "tslog";

export type ThermalLevel = "normal" | "warn" | "critical";

/**
 * Read the host CPU temperature in °C from the standard Linux thermal sysfs
 * node, or null if it can't be read or looks bogus. sysfs reports milli-°C.
 */
export function readCpuTempC(): number | null {
  try {
    const raw = fs
      .readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8")
      .trim();
    const milli = parseInt(raw, 10);
    if (!Number.isFinite(milli)) return null;
    const c = milli / 1000;
    // sysfs is milli-°C; reject absurd values (bad node, different unit).
    if (c < 0 || c > 150) return null;
    return c;
  } catch {
    return null;
  }
}

export interface ThermalGovernorOptions {
  /** Temperature source (injectable for tests). Defaults to the sysfs reader. */
  readTempC?: () => number | null;
  logger?: Logger<ILogObj>;
  /** Surface a user-visible alert on a level change (e.g. Scrypted `log.a`). */
  onAlert?: (level: ThermalLevel, tempC: number, message: string) => void;
  /** Enter WARN at/above this (°C). */
  warnC?: number;
  /** Enter CRITICAL at/above this (°C); throttling begins here. */
  criticalC?: number;
  /** Drop out of CRITICAL once below this (°C) — hysteresis. */
  clearCriticalC?: number;
  /** Drop out of WARN once below this (°C) — hysteresis. */
  clearWarnC?: number;
}

export class ThermalGovernor {
  private level: ThermalLevel = "normal";
  private lastTempC: number | null = null;
  private timer?: ReturnType<typeof setInterval>;

  private readonly readTempC: () => number | null;
  private readonly logger?: Logger<ILogObj>;
  private readonly onAlert?: ThermalGovernorOptions["onAlert"];
  private readonly warnC: number;
  private readonly criticalC: number;
  private readonly clearCriticalC: number;
  private readonly clearWarnC: number;

  constructor(opts: ThermalGovernorOptions = {}) {
    this.readTempC = opts.readTempC ?? readCpuTempC;
    this.logger = opts.logger;
    this.onAlert = opts.onAlert;
    // Pi 4/5 hardware-throttle around 80–85°C; warn/critical sit below that
    // with hysteresis so we act before the kernel does, without flapping.
    this.warnC = opts.warnC ?? 70;
    this.criticalC = opts.criticalC ?? 78;
    this.clearCriticalC = opts.clearCriticalC ?? 72;
    this.clearWarnC = opts.clearWarnC ?? 66;
  }

  /** Sample the temperature once and apply any level transition. */
  tick(): void {
    const t = this.readTempC();
    this.lastTempC = t;
    // Unreadable → never throttle; relax back to normal silently.
    if (t === null) {
      this.level = "normal";
      return;
    }
    const next = this.computeLevel(t);
    if (next !== this.level) this.transition(next, t);
  }

  /** Next level given the current level, applying hysteresis on the way down. */
  private computeLevel(t: number): ThermalLevel {
    switch (this.level) {
      case "critical":
        if (t >= this.clearCriticalC) return "critical";
        return t < this.clearWarnC ? "normal" : "warn";
      case "warn":
        if (t >= this.criticalC) return "critical";
        return t < this.clearWarnC ? "normal" : "warn";
      default: // normal
        if (t >= this.criticalC) return "critical";
        return t >= this.warnC ? "warn" : "normal";
    }
  }

  private transition(next: ThermalLevel, t: number): void {
    const prev = this.level;
    this.level = next;
    const temp = `${t.toFixed(1)}°C`;
    if (next === "critical") {
      const msg = `🌡️ CPU critically hot (${temp}) — throttling new H.264 transcodes (serving H.265 passthrough) until it cools`;
      this.logger?.error(msg);
      this.onAlert?.(next, t, msg);
    } else if (next === "warn") {
      const msg = `🌡️ CPU warm (${temp}) — watch concurrent transcodes; will throttle above ${this.criticalC}°C`;
      this.logger?.warn(msg);
      this.onAlert?.(next, t, msg);
    } else if (prev !== "normal") {
      const msg = `🌡️ CPU back to normal (${temp}) — transcoding unthrottled`;
      this.logger?.info(msg);
      this.onAlert?.(next, t, msg);
    }
  }

  /** True only while critically hot — new transcodes should be skipped. */
  shouldThrottleTranscode(): boolean {
    return this.level === "critical";
  }

  get temperatureC(): number | null {
    return this.lastTempC;
  }

  get thermalLevel(): ThermalLevel {
    return this.level;
  }

  /** Begin periodic sampling. Idempotent. */
  start(intervalMs = 10000): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    // Don't keep the event loop alive just for the thermometer.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

// ---- Process-wide singleton ------------------------------------------------

let governor: ThermalGovernor | undefined;

/** Start (once) the shared thermal governor. Returns the singleton. */
export function startThermalGovernor(
  opts: ThermalGovernorOptions = {},
): ThermalGovernor {
  if (!governor) governor = new ThermalGovernor(opts);
  governor.start();
  return governor;
}

/** Whether new H.264 transcodes should be skipped to protect the host. */
export function isTranscodeThermallyThrottled(): boolean {
  return governor?.shouldThrottleTranscode() ?? false;
}

/** Current thermal snapshot for diagnostics/settings display. */
export function getThermalState(): {
  level: ThermalLevel;
  tempC: number | null;
} {
  return {
    level: governor?.thermalLevel ?? "normal",
    tempC: governor?.temperatureC ?? null,
  };
}

/** Test-only: tear down the singleton. */
export function _resetThermalGovernor(): void {
  governor?.stop();
  governor = undefined;
}
