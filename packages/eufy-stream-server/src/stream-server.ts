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
import { ServerStats, StreamData, VideoMetadata } from "./types";
import { EufyWebSocketClient, DEVICE_EVENTS } from "eufy-security-client";

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
  /** Enable debug logging (default: false) */
  debug?: boolean;
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
  private options: Required<StreamServerOptions>;
  private server?: net.Server;
  private connectionManager: ConnectionManager;
  private h264Parser: H264Parser;
  private isActive = false;
  private startTime?: Date;
  private eventRemover?: () => boolean;

  // Livestream state tracking
  private livestreamIntendedState = false; // true = should be streaming
  private livestreamActualState = false; // true = actually streaming based on events
  private startStopTimeout?: NodeJS.Timeout;

  // Statistics
  private stats = {
    framesProcessed: 0,
    bytesTransferred: 0,
    lastFrameTime: null as Date | null,
  };

  constructor(options: StreamServerOptions) {
    super();

    this.options = {
      port: options.port ?? 8080,
      host: options.host ?? "0.0.0.0",
      maxConnections: options.maxConnections ?? 10,
      debug: options.debug ?? false,
      wsClient: options.wsClient,
      serialNumber: options.serialNumber,
    };

    this.logger = new Logger({
      name: "StreamServer",
      minLevel: this.options.debug ? 2 : 3, // 2=debug, 3=info
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
        await this.ensureLivestreamState();
      }
    });
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

        // Mark livestream as actually running when we receive data
        if (!this.livestreamActualState) {
          this.livestreamActualState = true;
          this.logger.info(
            "📹 Livestream confirmed active - receiving video data"
          );
        }

        this.logger.debug(
          `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes`
        );

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
            // Ignore LivestreamNotRunningError - it's not really an error
            if (
              error.message &&
              error.message.includes("LivestreamNotRunningError")
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
    if (!this.isActive) {
      this.logger.warn("Cannot stream video: server not active");
      return false;
    }

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

      // Log NAL unit information in debug mode
      if (this.options.debug) {
        const nalUnits = this.h264Parser.extractNALUnits(data);
        const nalInfo = nalUnits
          .map(
            (nal) => `${this.h264Parser.getNALTypeName(nal.type)}(${nal.type})`
          )
          .join(", ");
        this.logger.debug(
          `Processing H.264 data: ${data.length} bytes, NALs: [${nalInfo}], keyFrame: ${isKeyFrame}`
        );
      }

      // Broadcast to all connected clients
      const success = this.connectionManager.broadcast(data);

      // Update statistics
      this.stats.framesProcessed++;
      this.stats.bytesTransferred += data.length;
      this.stats.lastFrameTime = new Date();

      if (success) {
        this.logger.debug(
          `Streamed video frame: ${data.length} bytes to ${this.connectionManager.getActiveConnectionCount()} clients`
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
   * Extract video metadata from H.264 stream
   */
  extractVideoMetadata(data: Buffer): VideoMetadata | null {
    return this.h264Parser.extractVideoMetadata(data);
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
}
