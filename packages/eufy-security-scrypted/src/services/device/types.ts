/**
 * Device Service Types
 *
 * Shared type definitions for device services.
 *
 * @module services/device
 */

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
   * @returns Port number or null if not started
   */
  getPort(): number | null;

  /**
   * Check if the stream server is currently running
   */
  isRunning(): boolean;

  /**
   * Capture a snapshot from the stream
   * @param timeout - Timeout in milliseconds
   * @returns H.264 keyframe data
   */
  captureSnapshot(timeout?: number): Promise<Buffer>;
}
