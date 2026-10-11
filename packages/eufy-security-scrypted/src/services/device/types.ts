/**
 * Device Service Types
 *
 * Shared type definitions for device services.
 *
 * @module services/device
 */

import { VideoMetadata } from "@caplaz/eufy-security-client";

export interface MetadataBootstrapWaiter {
  promise: Promise<VideoMetadata>;
  release(): void;
  cancel(): void;
}

/**
 * StreamServer interface (from @caplaz/eufy-stream-server)
 *
 * Defines the contract for stream server operations.
 * This interface allows services to interact with the stream server
 * without tight coupling to the implementation.
 */
export interface IStreamServer {
  /**
   * Start the stream server
   */
  start(): Promise<void>;

  /**
   * Stop the stream server
   */
  stop(): Promise<void>;

  /**
   * Get the TCP port the server is listening on
   * @returns Port number or undefined if not started
   */
  getPort(): number | undefined;

  /**
   * Check if the stream server is currently running
   */
  isRunning(): boolean;

  /**
   * Capture a snapshot from the stream
   * @param timeout - Timeout in milliseconds
   * @returns Keyframe data (H.264 or H.265 depending on camera)
   */
  captureSnapshot(timeout?: number): Promise<Buffer>;

  /**
   * Return the most recently seen keyframe if no older than `maxAgeMs`,
   * otherwise null. Lets the snapshot service serve a thumbnail without
   * waking the camera. The buffer is self-contained (parameter sets
   * prepended) and decodes to a JPEG on its own.
   * @param maxAgeMs - Maximum acceptable age of the cached keyframe, in ms
   */
  getCachedKeyframe(
    maxAgeMs: number,
  ): { data: Buffer; codec: "H264" | "H265"; ageMs: number } | null;

  /**
   * Get the last received video metadata (codec, resolution, FPS).
   * Returns null if no stream has been received yet.
   */
  getVideoMetadata(): VideoMetadata | null;

  /** Whether the metadata was observed from the current P2P session. */
  isMetadataVerifiedForCurrentSession(): boolean;

  /**
   * Keep the upstream live while waiting for fresh session metadata.
   * `viewer: true` marks a new viewer request, which may re-take a HomeBase
   * slot that another camera revoked.
   */
  acquireMetadataWaiter(
    timeoutMs?: number,
    options?: { viewer?: boolean },
  ): MetadataBootstrapWaiter;

  /** Runs once when a raw or muxed downstream consumer attaches. */
  onNextConsumerAttached(callback: () => void): () => void;

  /** Audio observed on the current stream, rather than an assumed capability. */
  getAudioStatus(): "unknown" | "aac" | "none";

  /**
   * Get the TCP port the MPEG-TS muxed server is listening on.
   * Returns undefined if not started.
   */
  getMuxedPort(): number | undefined;

  /**
   * Resolve the session codec once it has settled (see StreamServer), or
   * undefined on timeout.
   */
  waitForSettledCodec?(timeoutMs: number): Promise<"H264" | "H265" | undefined>;

  /** Open a cold-start timing timeline (`⏱️ [timing]` log lines). */
  beginTiming?(label: string): void;

  /** Log a stage of the open timing timeline. */
  markTiming?(stage: string, detail?: string, repeat?: boolean): void;
}
