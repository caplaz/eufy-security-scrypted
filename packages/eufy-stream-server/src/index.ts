/**
 * Eufy Stream Server - Simplified TCP streaming server for raw H.264 video
 *
 * This package provides a simple TCP streaming server specifically designed
 * for streaming raw H.264 video data from Eufy security cameras. It removes
 * all the complexity of audio processing, MP4 fragmentation, and advanced
 * error recovery from the original implementation.
 *
 * @example
 * ```typescript
 * import { StreamServer } from 'eufy-stream-server';
 *
 * const server = new StreamServer({
 *   port: 8080,
 *   debug: true
 * });
 *
 * await server.start();
 *
 * // Stream H.264 video data
 * server.streamVideo(h264Buffer, timestamp, isKeyFrame);
 * ```
 */

export { StreamServer } from "./stream-server";
export { ConnectionManager } from "./connection-manager";
export { H264Parser } from "./h264-parser";

export type { StreamServerOptions } from "./stream-server";

export type {
  VideoMetadata,
  StreamData,
  ConnectionInfo,
  ServerStats,
  NALUnit,
} from "./types";
