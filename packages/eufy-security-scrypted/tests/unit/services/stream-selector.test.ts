import {
  selectStream,
  StreamSelectionInput,
} from "../../../src/services/device/stream-selector";

const select = (input: Partial<StreamSelectionInput> = {}) =>
  selectStream({
    compatibilityMode: "Auto",
    source: { codec: "H265", verified: true },
    ...input,
  });

describe("selectStream", () => {
  it("keeps an explicitly requested native stream native", () => {
    expect(
      select({
        streamId: "p2p",
        compatibilityMode: "Force",
        source: { codec: undefined, verified: false },
        availabilityError: "encoder capacity is exhausted",
      }),
    ).toEqual({ kind: "stream", streamId: "p2p" });
  });

  it("honors an explicit compatibility stream only when verified H265 is available", () => {
    expect(select({ streamId: "p2p-h264" })).toEqual({
      kind: "stream",
      streamId: "p2p-h264",
    });
  });

  it("does not fall an explicit compatibility stream back to native when the codec is unverified", () => {
    expect(
      select({
        streamId: "p2p-h264",
        source: { codec: "H265", verified: false },
      }),
    ).toMatchObject({
      kind: "error",
      name: "CompatibilityStreamSelectionError",
      mode: "Auto",
      reason: "source-codec-unverified",
      source: { codec: "H265", verified: false },
      availability: "available",
    });
  });

  it("returns a complete H264-source error for an explicit compatibility stream", () => {
    expect(
      select({
        streamId: "p2p-h264",
        source: { codec: "H264", verified: true },
      }),
    ).toEqual({
      kind: "error",
      name: "CompatibilityStreamSelectionError",
      mode: "Auto",
      reason: "source-codec-not-h265",
      source: { codec: "H264", verified: true },
      availability: "available",
      message:
        "Cannot select the compatibility H.264 stream: mode=Auto; " +
        "reason=source-codec-not-h265; source=H264 (verified); " +
        "availability=available.",
    });
  });

  it("does not fall an explicit compatibility stream back to native when admission is unavailable", () => {
    expect(
      select({
        streamId: "p2p-h264",
        availabilityError: "thermal admission denied",
      }),
    ).toMatchObject({
      kind: "error",
      name: "CompatibilityStreamSelectionError",
      mode: "Auto",
      reason: "compatibility-unavailable",
      source: { codec: "H265", verified: true },
      availability: "thermal admission denied",
    });
  });

  it("keeps Auto selection native for absent, unknown, and recorder destinations", () => {
    for (const destination of [
      undefined,
      "future-destination",
      "local-recorder",
      "remote-recorder",
    ]) {
      expect(select({ destination })).toEqual({
        kind: "stream",
        streamId: "p2p",
      });
    }
  });

  it("uses compatibility for verified H265 interactive live destinations in Auto mode", () => {
    for (const destination of ["local", "remote"]) {
      expect(select({ destination })).toEqual({
        kind: "stream",
        streamId: "p2p-h264",
      });
    }
  });

  it("keeps H264 native in Auto mode", () => {
    expect(
      select({
        destination: "local",
        source: { codec: "H264", verified: true },
      }),
    ).toEqual({ kind: "stream", streamId: "p2p" });
  });

  it("does not guess an unverified interactive source codec in Auto mode", () => {
    expect(
      select({
        destination: "local",
        source: { codec: "H265", verified: false },
      }),
    ).toEqual({ kind: "stream", streamId: "p2p" });
  });

  it("keeps Native mode native regardless of destination", () => {
    expect(
      select({ destination: "local", compatibilityMode: "Native" }),
    ).toEqual({ kind: "stream", streamId: "p2p" });
  });

  it("uses compatibility in Force mode for verified H265", () => {
    expect(select({ compatibilityMode: "Force" })).toEqual({
      kind: "stream",
      streamId: "p2p-h264",
    });
  });

  it("keeps verified native H264 native in Force mode", () => {
    expect(
      select({
        compatibilityMode: "Force",
        source: { codec: "H264", verified: true },
      }),
    ).toEqual({ kind: "stream", streamId: "p2p" });
  });

  it("returns a named, actionable error when Force mode has no verified source codec", () => {
    expect(
      select({
        compatibilityMode: "Force",
        source: { codec: undefined, verified: false },
      }),
    ).toMatchObject({
      kind: "error",
      name: "CompatibilityStreamSelectionError",
      mode: "Force",
      reason: "source-codec-unverified",
      source: { codec: undefined, verified: false },
      availability: "available",
    });
  });

  it("returns a named, actionable error when Force mode cannot admit compatibility", () => {
    expect(
      select({
        compatibilityMode: "Force",
        availabilityError: "thermal admission denied",
      }),
    ).toMatchObject({
      kind: "error",
      name: "CompatibilityStreamSelectionError",
      mode: "Force",
      reason: "compatibility-unavailable",
      source: { codec: "H265", verified: true },
      availability: "thermal admission denied",
    });
  });
});
