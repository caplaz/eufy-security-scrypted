/**
 * Simple Types - Basic type definitions for raw H.264 streaming
 */

/**
 * Stream data packet containing video data
 */
export interface StreamData {
  /** Raw H.264 data buffer */
  data: Buffer;
  /** Presentation timestamp in milliseconds */
  timestamp?: number;
  /** Whether this packet contains a key frame (I-frame) */
  isKeyFrame?: boolean;
}

/**
 * Information about a client connection
 */
export interface ConnectionInfo {
  /** Unique connection identifier */
  id: string;
  /** Client's remote IP address */
  remoteAddress: string;
  /** Client's remote port number */
  remotePort: number;
  /** Timestamp when connection was established */
  connectedAt: Date;
  /** Total bytes written to client */
  bytesWritten: number;
  /** Whether connection is active */
  isActive: boolean;
}

/**
 * Server statistics and metrics
 */
export interface ServerStats {
  /** Whether the server is currently active */
  isActive: boolean;
  /** Server port number */
  port?: number;
  /** Server uptime in milliseconds */
  uptime: number;
  /** Connection statistics */
  connections: {
    /** Number of active connections */
    active: number;
    /** Total connections since server start */
    total: number;
    /** Connection information by ID */
    connections: Record<string, ConnectionInfo>;
  };
  /** Streaming performance statistics */
  streaming: {
    /** Total frames processed */
    framesProcessed: number;
    /** Total bytes transferred */
    bytesTransferred: number;
    /** Last frame timestamp */
    lastFrameTime: Date | null;
  };
}

/**
 * NAL unit information parsed from H.264 stream
 */
export interface NALUnit {
  /** NAL unit type (0-31) */
  type: number;
  /** NAL unit data */
  data: Buffer;
  /** Whether this is a key frame NAL unit */
  isKeyFrame: boolean;
}
