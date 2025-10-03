/**
 * Simple TCP Stream Server - Raw H.264 streaming server
 *
 * This is a simplified version of the legacy eufy-stream-server that focuses
 * exclusively on streaming raw H.264 video data over TCP connections.
 * All audio processing, MP4 fragmentation, and complex error recovery
 * have been removed for simplicity.
 */

import * as net from "net";
import { EventEmitter } from "events";
import { Logger, ILogObj } from "tslog";
import { ConnectionManager } from "./connection-manager";
import { H264Parser } from "./h264-parser";
import { ServerStats, StreamData } from "./types";
import {
  EufyWebSocketClient,
  DEVICE_EVENTS,
  VideoMetadata,
} from "@caplaz/eufy-security-client";

/**
 * Configuration options for the TCP stream server
 */
export interface StreamServerOptions {
  /** Server port number (default: 8080) */
  port?: number;
  /** Server host address (default: '0.0.0.0') */
  host?: string;
  /** Maximum number of concurrent connections (default: 10) */
  maxConnections?: number;
  /**
   * @deprecated No longer used - debug level is controlled by the logger instance.
   * If you provide a logger, it controls its own debug level.
   * If no logger is provided, the internal logger defaults to info level.
   */
  debug?: boolean;
  /** Optional external logger instance compatible with tslog Logger<ILogObj> (if not provided, uses internal tslog Logger) */
  logger?: Logger<ILogObj>;
  /** WebSocket client for receiving video data events (required for Eufy cameras) */
  wsClient: EufyWebSocketClient;
  /** Device serial number to filter events (required for Eufy cameras) */
  serialNumber: string;
}

/**
 * Simple TCP streaming server for raw H.264 video data
 *
 * This server accepts TCP connections and streams raw H.264 video data
 * to all connected clients. It provides basic connection management,
 * NAL unit parsing, and key frame detection.
 *
 * @example
 * ```typescript
 * const server = new StreamServer({
 *   port: 8080,
 *   debug: true,
 *   wsClient: eufyWebSocketClient,
 *   serialNumber: 'device123'
 * });
 *
 * server.start().then(() => {
 *   console.log('Server started and listening for video data');
 * });
 * ```
 */
export class StreamServer extends EventEmitter {
  private logger: Logger<ILogObj>;
  private options: Required<Omit<StreamServerOptions, "logger">> & {
    logger?: Logger<ILogObj>;
  };
  private server?: net.Server;
  private connectionManager: ConnectionManager;
  private h264Parser: H264Parser;
  private isActive = false;
  private startTime?: Date;
  private eventRemover?: () => boolean;

  // Stream state management
  private livestreamIntendedState = false;
  private livestreamActualState = false;
  private startStopTimeout?: ReturnType<typeof setTimeout>;

  // Video metadata from first frame
  private videoMetadata: VideoMetadata | null = null;
  private metadataReceived = false;

  // Client activity monitoring for battery optimization
  private lastClientActivity = 0;
  private activityCheckInterval?: ReturnType<typeof setInterval>;
  private readonly ACTIVITY_TIMEOUT = 30000; // 30 seconds of no activity

  // Statistics
  private stats = {
    framesProcessed: 0,
    bytesTransferred: 0,
    lastFrameTime: null as Date | null,
  };

  // Snapshot capture state
  private snapshotResolvers: Array<{
    resolve: (buffer: Buffer) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];

  constructor(options: StreamServerOptions) {
    super();

    this.options = {
      port: options.port ?? 8080,
      host: options.host ?? "0.0.0.0",
      maxConnections: options.maxConnections ?? 10,
      debug: options.debug ?? false,
      logger: options.logger,
      wsClient: options.wsClient,
      serialNumber: options.serialNumber,
    };

    // Use external logger if provided, otherwise create internal tslog Logger
    // Note: When external logger is provided, it controls its own debug level
    this.logger =
      options.logger ??
      new Logger({
        name: "StreamServer",
        minLevel: 3, // info level - external loggers control their own debug level
      });

    this.connectionManager = new ConnectionManager(this.logger);
    this.h264Parser = new H264Parser(this.logger);

    this.setupEventHandlers();
    this.setupWebSocketListener();
  }

  /**
   * Setup event handlers for connection manager
   */
  private setupEventHandlers(): void {
    this.connectionManager.on(
      "clientConnected",
      async (connectionId, connectionInfo) => {
        const previousCount =
          this.connectionManager.getActiveConnectionCount() - 1;

        this.logger.info(
          `Client connected: ${connectionId} from ${connectionInfo.remoteAddress}:${connectionInfo.remotePort}`
        );
        this.emit("clientConnected", connectionId, connectionInfo);

        // Start livestream when first client connects
        if (previousCount === 0) {
          this.livestreamIntendedState = true;
          this.lastClientActivity = Date.now();
          this.startActivityMonitoring();
          await this.ensureLivestreamState();
        }
      }
    );

    this.connectionManager.on("clientDisconnected", async (connectionId) => {
      const previousCount =
        this.connectionManager.getActiveConnectionCount() + 1;

      this.logger.info(`Client disconnected: ${connectionId}`);
      this.emit("clientDisconnected", connectionId);

      // Stop livestream when last client disconnects
      if (previousCount === 1) {
        this.livestreamIntendedState = false;
        this.stopActivityMonitoring();
        await this.ensureLivestreamState();
      }
    });
  }

  /**
   * Start monitoring client activity to detect idle connections
   */
  private startActivityMonitoring(): void {
    this.stopActivityMonitoring(); // Clear any existing interval

    this.activityCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - this.lastClientActivity;

      // Clean up any stale connections first
      this.cleanupStaleConnections();

      const activeClients = this.connectionManager.getActiveConnectionCount();

      if (timeSinceActivity > this.ACTIVITY_TIMEOUT && activeClients === 0) {
        this.logger.info(
          `🕒 No client activity for ${Math.round(timeSinceActivity / 1000)}s and no active clients, stopping camera stream`
        );
        this.livestreamIntendedState = false;
        this.stopActivityMonitoring();
        this.ensureLivestreamState();
      } else if (activeClients === 0 && this.livestreamIntendedState) {
        this.logger.debug(
          `No active clients but stream is intended to run - waiting for connections`
        );
      }
    }, 5000); // Check every 5 seconds

    this.logger.debug("Started client activity monitoring");
  }

  /**
   * Stop monitoring client activity
   */
  private stopActivityMonitoring(): void {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = undefined;
      this.logger.debug("Stopped client activity monitoring");
    }
  }

  /**
   * Clean up stale TCP connections that may not be actively used
   */
  private cleanupStaleConnections(): void {
    const connectionStats = this.connectionManager.getConnectionStats();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [connectionId, info] of Object.entries(connectionStats)) {
      const connectionAge = now - info.connectedAt.getTime();

      // Clean up connections that are older than 5 minutes and have no recent activity
      if (connectionAge > 5 * 60 * 1000) {
        // 5 minutes
        this.logger.info(
          `Cleaning up stale connection: ${connectionId} (age: ${Math.round(connectionAge / 1000)}s)`
        );
        // Note: The connection manager will handle the actual cleanup when we emit the disconnect event
        // For now, we'll just log this - the connection manager handles cleanup on actual disconnects
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(
        `Identified ${cleanedCount} stale connections for cleanup`
      );
    }
  }

  /**
   * Setup WebSocket event listener for video data
   */
  private setupWebSocketListener(): void {
    this.logger.info(
      `Setting up WebSocket listener for device: ${this.options.serialNumber}`
    );

    // Listen for livestream video data events
    this.eventRemover = this.options.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA,
      (event) => {
        // Filter events by device serial number
        if (event.serialNumber !== this.options.serialNumber) {
          return;
        }

        // Log that we received a video data event (first few only to avoid spam)
        if (this.stats.framesProcessed < 3) {
          this.logger.debug(
            `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes, metadata present: ${!!event.metadata}`
          );
          if (event.metadata) {
            this.logger.debug(
              `Video metadata: codec=${event.metadata.videoCodec}, ${event.metadata.videoWidth}x${event.metadata.videoHeight} @ ${event.metadata.videoFPS}fps`
            );
          }
        }

        // Capture video metadata from first frame
        if (!this.metadataReceived && event.metadata) {
          this.videoMetadata = {
            videoCodec: event.metadata.videoCodec,
            videoFPS: event.metadata.videoFPS,
            videoWidth: event.metadata.videoWidth,
            videoHeight: event.metadata.videoHeight,
          };
          this.metadataReceived = true;
          this.logger.info(
            `📐 Captured video metadata: ${this.videoMetadata.videoWidth}x${this.videoMetadata.videoHeight} @ ${this.videoMetadata.videoFPS}fps, codec: ${this.videoMetadata.videoCodec}`
          );
          this.emit("metadataReceived", this.videoMetadata);
        }

        // Mark livestream as actually running when we receive data
        if (!this.livestreamActualState) {
          this.livestreamActualState = true;
          this.logger.info(
            "📹 Livestream confirmed active - receiving video data"
          );
        }

        // Log video data events based on client activity
        const activeClients = this.connectionManager.getActiveConnectionCount();
        if (activeClients > 0) {
          this.logger.debug(
            `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes (${activeClients} active clients)`
          );
        } else {
          // Log less frequently when no clients - only every 10th frame
          if (this.stats.framesProcessed % 10 === 0) {
            this.logger.debug(
              `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes (no active clients, frame ${this.stats.framesProcessed})`
            );
          }
        }

        // Convert JSONBuffer to Buffer if needed
        const videoBuffer = Buffer.isBuffer(event.buffer.data)
          ? event.buffer.data
          : Buffer.from(event.buffer.data);

        // Stream the video data
        this.streamVideo(videoBuffer, Date.now(), undefined);
      },
      {
        source: "device",
        serialNumber: this.options.serialNumber,
      }
    );

    this.logger.info(
      `WebSocket listener setup complete for device: ${this.options.serialNumber}`
    );
  }

  /**
   * Ensure the livestream is in the correct state with retry logic
   */
  private async ensureLivestreamState(): Promise<void> {
    // Clear any existing timeout
    if (this.startStopTimeout) {
      clearTimeout(this.startStopTimeout);
      this.startStopTimeout = undefined;
    }

    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (this.livestreamIntendedState && !this.livestreamActualState) {
          // Need to start livestream
          this.logger.info(
            `🎥 Attempting to start livestream (attempt ${attempt}/${maxRetries})`
          );
          await this.options.wsClient.commands
            .device(this.options.serialNumber)
            .startLivestream();
          this.logger.info("✅ Livestream start command sent successfully");

          // Set timeout to check if it actually started
          this.startStopTimeout = setTimeout(() => {
            if (this.livestreamIntendedState && !this.livestreamActualState) {
              this.logger.warn(
                "⚠️ Livestream start timeout - no video data received, will retry"
              );
              this.ensureLivestreamState();
            }
          }, 30000); // 30 seconds to receive first video data
        } else if (
          !this.livestreamIntendedState &&
          this.livestreamActualState
        ) {
          // Need to stop livestream
          this.logger.info(
            `🛑 Attempting to stop livestream (attempt ${attempt}/${maxRetries})`
          );
          try {
            await this.options.wsClient.commands
              .device(this.options.serialNumber)
              .stopLivestream();
            this.logger.info("✅ Livestream stop command sent successfully");
            this.livestreamActualState = false;
          } catch (error: any) {
            // Ignore "livestream not running" errors - it's not really an error
            // Error can be in format: "Command failed: device_livestream_not_running"
            if (
              error.message &&
              (error.message.includes("livestream_not_running") ||
                error.message.includes("LivestreamNotRunningError"))
            ) {
              this.logger.debug(
                "Livestream was already stopped (not an error)"
              );
              this.livestreamActualState = false;
            } else {
              throw error;
            }
          }
        }

        // Success - break out of retry loop
        break;
      } catch (error: any) {
        this.logger.warn(
          `❌ Livestream command failed (attempt ${attempt}/${maxRetries}):`,
          error.message || error
        );

        if (attempt === maxRetries) {
          this.logger.error(
            `❌ Failed to set livestream state after ${maxRetries} attempts`
          );
          this.emit("streamError", error);
        } else {
          // Wait before retrying
          this.logger.info(`⏳ Retrying in ${retryDelay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }
  }

  /**
   * Start the TCP server
   */
  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error("Server is already running");
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer();

      this.server.on("connection", (socket) => {
        this.connectionManager.handleConnection(socket);
      });

      this.server.on("error", (error) => {
        this.logger.error("Server error:", error);
        this.emit("error", error);
        reject(error);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        this.isActive = true;
        this.startTime = new Date();
        this.logger.info(
          `🚀 Stream server started on ${this.options.host}:${this.options.port}`
        );
        this.emit("started");
        resolve();
      });
    });
  }

  /**
   * Stop the TCP server
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    // Clear any pending timeouts
    if (this.startStopTimeout) {
      clearTimeout(this.startStopTimeout);
      this.startStopTimeout = undefined;
    }

    // Stop activity monitoring
    this.stopActivityMonitoring();

    // Stop livestream if there are active clients
    const activeClients = this.connectionManager.getActiveConnectionCount();
    if (activeClients > 0) {
      this.livestreamIntendedState = false;
      await this.ensureLivestreamState();
    }

    // Clean up WebSocket event listener
    if (this.eventRemover) {
      this.eventRemover();
      this.eventRemover = undefined;
      this.logger.debug("WebSocket event listener removed");
    }

    return new Promise((resolve) => {
      this.connectionManager.close();

      if (this.server) {
        this.server.close(() => {
          this.isActive = false;
          this.logger.info("🛑 Stream server stopped");
          this.emit("stopped");
          resolve();
        });
      } else {
        this.isActive = false;
        resolve();
      }
    });
  }

  /**
   * Stream raw H.264 video data to all connected clients
   *
   * @param data - Raw H.264 video data buffer
   * @param timestamp - Optional timestamp in milliseconds
   * @param isKeyFrame - Optional flag indicating if this is a key frame
   * @returns Promise<boolean> - True if data was successfully processed
   */
  async streamVideo(
    data: Buffer,
    timestamp?: number,
    isKeyFrame?: boolean
  ): Promise<boolean> {
    if (!data || data.length === 0) {
      this.logger.warn("Cannot stream empty video data");
      return false;
    }

    try {
      // Validate H.264 data structure
      if (!this.h264Parser.validateH264Data(data)) {
        this.logger.warn("Invalid H.264 data structure");
        return false;
      }

      // Detect key frame if not explicitly provided
      if (isKeyFrame === undefined) {
        isKeyFrame = this.h264Parser.isKeyFrame(data);
      }

      // Log NAL unit information for debugging
      const nalUnits = this.h264Parser.extractNALUnits(data);
      const nalInfo = nalUnits
        .map(
          (nal) => `${this.h264Parser.getNALTypeName(nal.type)}(${nal.type})`
        )
        .join(", ");
      this.logger.debug(
        `Processing H.264 data: ${data.length} bytes, NALs: [${nalInfo}], keyFrame: ${isKeyFrame}`
      );

      // Resolve any pending snapshot requests with keyframe data
      // This happens BEFORE checking if server is active, so snapshots work without TCP server
      if (isKeyFrame && this.snapshotResolvers.length > 0) {
        this.logger.debug(
          `Resolving ${this.snapshotResolvers.length} snapshot request(s) with keyframe data`
        );
        const resolvers = [...this.snapshotResolvers];
        this.snapshotResolvers = [];
        resolvers.forEach(({ resolve }) => resolve(data));
      }

      // If server is not active, we've already handled snapshot resolution above
      // so we can just return success without broadcasting to TCP clients
      if (!this.isActive) {
        // Only update stats if we're handling snapshots
        if (this.snapshotResolvers.length > 0 || isKeyFrame) {
          this.stats.framesProcessed++;
        }
        return true; // Return true because snapshot was handled successfully
      }

      // Broadcast to all connected clients
      const success = this.connectionManager.broadcast(data);

      // Update client activity timestamp when data is successfully sent
      if (success) {
        this.lastClientActivity = Date.now();
      }

      // Update statistics
      this.stats.framesProcessed++;
      this.stats.bytesTransferred += data.length;
      this.stats.lastFrameTime = new Date();

      // Log frame streaming activity
      const activeClients = this.connectionManager.getActiveConnectionCount();
      if (activeClients > 0) {
        this.logger.debug(
          `Streamed video frame: ${data.length} bytes to ${activeClients} clients`
        );
      } else {
        this.logger.debug(
          `Processed video frame: ${data.length} bytes (no active clients)`
        );
      }

      // Emit event
      this.emit("videoStreamed", {
        data,
        timestamp,
        isKeyFrame,
      } as StreamData);

      return true;
    } catch (error) {
      this.logger.error("Failed to stream video data:", error);
      this.emit("streamError", error);
      return false;
    }
  }

  /**
   * Get video metadata from the first received frame
   */
  getVideoMetadata(): VideoMetadata | null {
    return this.videoMetadata;
  }

  /**
   * Wait for video metadata to be received
   */
  async waitForVideoMetadata(
    timeoutMs: number = 10000
  ): Promise<VideoMetadata> {
    if (this.videoMetadata) {
      this.logger.debug("Video metadata already available");
      return this.videoMetadata;
    }

    this.logger.debug(
      `Waiting for video metadata (timeout: ${timeoutMs}ms)...`
    );

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger.warn(
          `Timeout waiting for video metadata (${timeoutMs}ms). Livestream state: ${this.livestreamActualState}, intended: ${this.livestreamIntendedState}`
        );
        reject(
          new Error(`Timeout waiting for video metadata (${timeoutMs}ms)`)
        );
      }, timeoutMs);

      this.once("metadataReceived", (metadata) => {
        clearTimeout(timeout);
        this.logger.debug("Video metadata received successfully");
        resolve(metadata);
      });
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get server statistics
   */
  getStats(): ServerStats {
    const connectionStats = this.connectionManager.getConnectionStats();

    return {
      isActive: this.isActive,
      port: this.options.port,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      connections: {
        active: this.connectionManager.getActiveConnectionCount(),
        total: Object.keys(connectionStats).length,
        connections: connectionStats,
      },
      streaming: {
        framesProcessed: this.stats.framesProcessed,
        bytesTransferred: this.stats.bytesTransferred,
        lastFrameTime: this.stats.lastFrameTime,
      },
    };
  }

  /**
   * Get the actual port the server is listening on
   */
  getPort(): number | undefined {
    if (this.server) {
      const address = this.server.address();
      if (address && typeof address === "object") {
        return address.port;
      }
    }
    return undefined;
  }

  /**
   * Get number of active connections
   */
  getActiveConnectionCount(): number {
    return this.connectionManager.getActiveConnectionCount();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      framesProcessed: 0,
      bytesTransferred: 0,
      lastFrameTime: null,
    };
  }

  /**
   * Capture a single snapshot frame from the stream.
   * Starts the livestream if not already running, waits for a keyframe,
   * captures the frame, and stops the stream.
   *
   * @param timeoutMs - Maximum time to wait for a snapshot (default: 15000ms)
   * @returns Promise<Buffer> - Raw H.264 keyframe data
   */
  async captureSnapshot(timeoutMs: number = 15000): Promise<Buffer> {
    this.logger.info("📸 Capturing snapshot...");

    const wasStreamRunning = this.livestreamActualState;

    try {
      // Start livestream if not already running
      if (!this.livestreamActualState) {
        this.logger.debug("Starting livestream for snapshot capture");
        this.livestreamIntendedState = true;
        await this.ensureLivestreamState();
      }

      // Wait for a keyframe
      const snapshotBuffer = await new Promise<Buffer>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          // Remove this resolver from the list
          this.snapshotResolvers = this.snapshotResolvers.filter(
            (r) => r.resolve !== resolve
          );
          reject(
            new Error(
              `Snapshot capture timed out after ${timeoutMs}ms - no keyframe received`
            )
          );
        }, timeoutMs);

        // Add resolver to the queue
        this.snapshotResolvers.push({
          resolve: (buffer: Buffer) => {
            clearTimeout(timeoutHandle);
            resolve(buffer);
          },
          reject: (error: Error) => {
            clearTimeout(timeoutHandle);
            reject(error);
          },
          timestamp: Date.now(),
        });

        this.logger.debug(
          `Waiting for next keyframe (timeout: ${timeoutMs}ms)...`
        );
      });

      this.logger.info(
        `✅ Snapshot captured: ${snapshotBuffer.length} bytes (keyframe)`
      );

      return snapshotBuffer;
    } finally {
      // Stop livestream if it wasn't running before
      if (!wasStreamRunning) {
        this.logger.debug(
          "Stopping livestream after snapshot capture (was not running before)"
        );
        this.livestreamIntendedState = false;
        // Don't await here to avoid blocking the snapshot return
        this.ensureLivestreamState().catch((error) => {
          this.logger.warn(
            `Failed to stop livestream after snapshot: ${error}`
          );
        });
      }
    }
  }
}
