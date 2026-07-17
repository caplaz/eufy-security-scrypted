/**
 * Station-recycle guard tests
 */

import {
  recycleSuppression,
  MAX_FAILED_RECYCLES,
} from "../../../src/utils/recycle-guard";

describe("recycleSuppression", () => {
  const base = {
    isSelfStation: false,
    signalLevel: 3,
    consecutiveFailedRecycles: 0,
  };

  it("allows the first recycle (gives a wedged session one chance)", () => {
    expect(recycleSuppression(base)).toEqual({ suppress: false });
  });

  it("suppresses after the failure cap (chronic failure)", () => {
    expect(
      recycleSuppression({ ...base, consecutiveFailedRecycles: MAX_FAILED_RECYCLES }),
    ).toEqual({ suppress: true, reason: "chronic-failure" });
  });

  it("suppresses immediately for a HomeBase camera with no signal (level 0)", () => {
    expect(recycleSuppression({ ...base, signalLevel: 0 })).toEqual({
      suppress: true,
      reason: "no-signal",
    });
  });

  it("does not no-signal-short-circuit a self-station (4G) camera", () => {
    // 4G self-station has no siblings to protect; only the failure cap applies.
    expect(
      recycleSuppression({ ...base, isSelfStation: true, signalLevel: 0 }),
    ).toEqual({ suppress: false });
  });

  it("does not suppress on decent signal before the cap", () => {
    expect(
      recycleSuppression({ ...base, signalLevel: 1, consecutiveFailedRecycles: 0 }),
    ).toEqual({ suppress: false });
  });

  it("treats unknown signal as not-no-signal", () => {
    expect(
      recycleSuppression({ ...base, signalLevel: undefined }),
    ).toEqual({ suppress: false });
  });
});
