/**
 * Thumbnail refresh policy tests
 */

import {
  shouldRefreshThumbnail,
  nextRefreshBackoffMs,
  THUMBNAIL_REFRESH_THRESHOLD_MS,
  resolveRefreshChoice,
} from "../../../src/utils/thumbnail-refresh";

describe("shouldRefreshThumbnail", () => {
  const base = { cacheAgeMs: null, slotBusy: false, backoffRemainingMs: 0 };

  it("does NOT proactively wake a camera that has never streamed (empty cache)", () => {
    // Empty cache is the post-reload state for the whole fleet; waking on it
    // would stampede every camera (incl. disabled/dead) on every restart.
    expect(shouldRefreshThumbnail(base)).toBe(false);
  });

  it("refreshes when the cache is older than the threshold", () => {
    expect(
      shouldRefreshThumbnail({
        ...base,
        cacheAgeMs: THUMBNAIL_REFRESH_THRESHOLD_MS + 1,
      }),
    ).toBe(true);
  });

  it("does NOT refresh a fresh cache", () => {
    expect(shouldRefreshThumbnail({ ...base, cacheAgeMs: 60_000 })).toBe(false);
  });

  it("never refreshes while the HomeBase slot is busy (yields to live)", () => {
    expect(
      shouldRefreshThumbnail({ ...base, cacheAgeMs: null, slotBusy: true }),
    ).toBe(false);
  });

  it("never refreshes while in failure backoff (dead/asleep camera)", () => {
    expect(
      shouldRefreshThumbnail({
        ...base,
        cacheAgeMs: null,
        backoffRemainingMs: 5000,
      }),
    ).toBe(false);
  });
});

describe("resolveRefreshChoice", () => {
  it("defaults to 2 hours when unset or unknown", () => {
    expect(resolveRefreshChoice(undefined)).toBe(2 * 60 * 60 * 1000);
    expect(resolveRefreshChoice("nonsense")).toBe(2 * 60 * 60 * 1000);
    expect(resolveRefreshChoice(undefined)).toBe(
      THUMBNAIL_REFRESH_THRESHOLD_MS,
    );
  });

  it("maps named choices to durations", () => {
    expect(resolveRefreshChoice("30 minutes")).toBe(30 * 60 * 1000);
    expect(resolveRefreshChoice("1 hour")).toBe(60 * 60 * 1000);
    expect(resolveRefreshChoice("4 hours")).toBe(4 * 60 * 60 * 1000);
  });

  it("returns null for Off (disabled)", () => {
    expect(resolveRefreshChoice("Off")).toBeNull();
  });
});

describe("nextRefreshBackoffMs", () => {
  it("grows exponentially from the base", () => {
    expect(nextRefreshBackoffMs(1, 10, 10000)).toBe(10);
    expect(nextRefreshBackoffMs(2, 10, 10000)).toBe(20);
    expect(nextRefreshBackoffMs(3, 10, 10000)).toBe(40);
  });

  it("caps the backoff", () => {
    expect(nextRefreshBackoffMs(100, 10, 1000)).toBe(1000);
  });

  it("treats zero/negative failures as one", () => {
    expect(nextRefreshBackoffMs(0, 10, 10000)).toBe(10);
  });
});
