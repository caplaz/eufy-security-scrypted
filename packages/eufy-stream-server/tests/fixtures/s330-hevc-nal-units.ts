/**
 * NAL units captured from a Eufy S330 (T8160, HomeBase 3) live stream:
 * H.265 Main, 3840x2160, 15 fps (raw stream-server port, 2026-10-10).
 * Parameter sets are complete; the IDR and TRAIL slices are truncated to
 * their first bytes — enough for NAL-header and codec detection tests, not
 * for decoding.
 */
const hex = (s: string) => Buffer.from(s, "hex");

export const S330_HEVC = {
  vps: hex("40010c01ffff214000000300900000030000030096250240"),
  sps: hex(
    "420101214000000300900000030000030096a001e020021c59e96e44a1737010" +
      "101040000003004000000303c2",
  ),
  pps: hex("4401c0f7c0e6d9"),
  /** IDR_W_RADL slice, truncated. */
  idrSlice: hex(
    "2601ac30c00d8ffe0a34e851ecdf28c000337690a713b11b1613933bd8e08869" +
      "94d175d5545341c0597e3bae559720b033c034fc6667eb94806981fd424e917e",
  ),
  /** TRAIL_R slice, truncated. */
  trailSlice: hex(
    "0201d00455b044c0004f9f84acd2b15d6df9b0c8000003000003001533b000ea",
  ),
};
