/**
 * Pure stream routing policy for native and compatibility streams.
 *
 * This module deliberately does not start streams, inspect codec metadata, or
 * request encoder admission. Its caller supplies only verified facts so the
 * selection cannot guess a source codec or silently relabel a native stream.
 */

export type CompatibilityMode = "Auto" | "Force" | "Native";

export type SourceCodec = "H264" | "H265";

export interface StreamSelectionInput {
  /** A requested Scrypted stream id. Only `p2p` and `p2p-h264` are special. */
  streamId?: string;
  /** Scrypted's intended consumer destination. Unknown values are native. */
  destination?: string;
  compatibilityMode: CompatibilityMode;
  /** Codec information supplied by the stream server, not inferred here. */
  source: {
    codec?: SourceCodec;
    verified: boolean;
  };
  /** Why a compatibility encoder cannot be admitted, if it cannot. */
  availabilityError?: string;
}

export interface NativeStreamSelection {
  kind: "stream";
  streamId: "p2p";
}

export interface CompatibilityStreamSelection {
  kind: "stream";
  streamId: "p2p-h264";
}

export type CompatibilitySelectionReason =
  | "source-codec-unverified"
  | "source-codec-not-h265"
  | "compatibility-unavailable";

export interface CompatibilityStreamSelectionError {
  kind: "error";
  /** Stable name suitable for logs and user-facing error handling. */
  name: "CompatibilityStreamSelectionError";
  mode: CompatibilityMode;
  reason: CompatibilitySelectionReason;
  source: StreamSelectionInput["source"];
  /** `available` or the supplied admission/encoder error. */
  availability: string;
  message: string;
}

export type StreamSelection =
  | NativeStreamSelection
  | CompatibilityStreamSelection
  | CompatibilityStreamSelectionError;

const NATIVE_STREAM: NativeStreamSelection = {
  kind: "stream",
  streamId: "p2p",
};
const COMPATIBILITY_STREAM: CompatibilityStreamSelection = {
  kind: "stream",
  streamId: "p2p-h264",
};
const INTERACTIVE_LIVE_DESTINATIONS = new Set(["local", "remote"]);

/**
 * Select either the truthful native P2P stream or a guaranteed compatibility
 * H.264 stream. Explicit stream ids take precedence; destination is only an
 * Auto-mode default-routing hint.
 */
export function selectStream(input: StreamSelectionInput): StreamSelection {
  if (input.streamId === "p2p") {
    return NATIVE_STREAM;
  }

  if (input.streamId === "p2p-h264") {
    return selectCompatibilityStream(input);
  }

  if (input.compatibilityMode === "Native") {
    return NATIVE_STREAM;
  }

  if (input.compatibilityMode === "Force") {
    return input.source.codec === "H264" && input.source.verified
      ? NATIVE_STREAM
      : selectCompatibilityStream(input);
  }

  if (
    input.source.verified &&
    input.source.codec === "H265" &&
    INTERACTIVE_LIVE_DESTINATIONS.has(input.destination ?? "")
  ) {
    // Auto mode may remain native when the optional compatibility path is not
    // available. Only an explicit compatibility request or Force is strict.
    return input.availabilityError ? NATIVE_STREAM : COMPATIBILITY_STREAM;
  }

  return NATIVE_STREAM;
}

function selectCompatibilityStream(
  input: StreamSelectionInput,
): CompatibilityStreamSelection | CompatibilityStreamSelectionError {
  if (!input.source.verified) {
    return selectionError(input, "source-codec-unverified");
  }

  if (input.source.codec !== "H265") {
    return selectionError(input, "source-codec-not-h265");
  }

  if (input.availabilityError) {
    return selectionError(input, "compatibility-unavailable");
  }

  return COMPATIBILITY_STREAM;
}

function selectionError(
  input: StreamSelectionInput,
  reason: CompatibilitySelectionReason,
): CompatibilityStreamSelectionError {
  const availability = input.availabilityError ?? "available";
  const codec = input.source.codec ?? "unknown";

  return {
    kind: "error",
    name: "CompatibilityStreamSelectionError",
    mode: input.compatibilityMode,
    reason,
    source: { ...input.source },
    availability,
    message:
      `Cannot select the compatibility H.264 stream: mode=${input.compatibilityMode}; ` +
      `reason=${reason}; source=${codec} (${input.source.verified ? "verified" : "unverified"}); ` +
      `availability=${availability}.`,
  };
}
