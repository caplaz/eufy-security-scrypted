/**
 * Device Service Types
 *
 * Shared type definitions for device services.
 *
 * @module services/device
 */

import { VideoMetadata } from "@caplaz/eufy-security-client";

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

  /**
   * Get the TCP port the MPEG-TS muxed server is listening on.
   * Returns undefined if not started.
   */
  getMuxedPort(): number | undefined;
}
