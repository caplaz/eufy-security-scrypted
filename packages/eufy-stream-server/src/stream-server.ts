/**
 * Simple TCP Stream Server - Raw H.264 streaming server
 *
 * This is a simplified version of the legacy eufy-stream-server that focuses
 * exclusively on streaming raw H.264 video data over TCP connections.
 * All audio processing, MP4 fragmentation, and complex error recovery
 * have been removed for simplicity.
 */

import * as net from "node:net";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import JMuxer from "jmuxer";
import { Logger, ILogObj } from "tslog";
import { ConnectionManager } from "./connection-manager";
import { H264Parser } from "./h264-parser";
import { ServerStats, StreamData } from "./types";
import {
  EufyWebSocketClient,
  DEVICE_EVENTS,
  VideoMetadata,
  AudioMetadata,
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
  private muxedServer?: net.Server;
  /**
   * Map of muxed-client socket → its dedicated JMuxer instance. Each
   * connection gets its own muxer so every consumer receives a complete
   * fMP4 init segment at the start of its stream.
   */
  private muxerStreams = new Map<
    net.Socket,
    { muxer: any; duplex: Duplex }
  >();
  private connectionManager: ConnectionManager;
  private h264Parser: H264Parser;
  private isActive = false;
  private startTime?: Date;
  private eventRemover?: () => boolean;
  private audioEventRemover?: () => boolean;

  // Stream state management
  private livestreamIntendedState = false;
  private livestreamActualState = false;
  private startStopTimeout?: ReturnType<typeof setTimeout>;

  // Video metadata from first frame
  private videoMetadata: VideoMetadata | null = null;
  private metadataReceived = false;

  // Audio metadata from first audio frame
  private audioMetadata: AudioMetadata | null = null;

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

  // Parameter-set cache for new client initialization.
  // H.264 uses SPS (type 7) + PPS (type 8).
  // H.265 uses VPS (type 32) + SPS (type 33) + PPS (type 34).
  private cachedSPS: Buffer | null = null;
  private cachedPPS: Buffer | null = null;
  private cachedVPS: Buffer | null = null; // H.265 Video Parameter Set

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
        this.logger.info(
          `Client connected: ${connectionId} from ${connectionInfo.remoteAddress}:${connectionInfo.remotePort}`
        );
        this.emit("clientConnected", connectionId, connectionInfo);

        // Send cached SPS/PPS headers immediately so FFmpeg can parse the stream
        this.sendCachedHeaders(connectionId);

        // Start livestream if this is the first consumer overall
        // (TCP clients + muxer clients combined).
        await this.updateLivestreamStateForMuxerClients();
      }
    );

    this.connectionManager.on("clientDisconnected", async (connectionId) => {
      this.logger.info(`Client disconnected: ${connectionId}`);
      this.emit("clientDisconnected", connectionId);

      // Stop livestream only if no consumers remain.
      await this.updateLivestreamStateForMuxerClients();
    });
  }

  /**
   * Send cached SPS/PPS headers to a specific client
   * This ensures new clients can immediately decode the stream
   * @param connectionId - The connection ID to send headers to
   */
  private sendCachedHeaders(connectionId: string): void {
    const hasHeaders = this.cachedVPS || this.cachedSPS || this.cachedPPS;
    if (!hasHeaders) {
      this.logger.debug(
        `No cached parameter-set headers available for client ${connectionId}`
      );
      return;
    }

    // H.265: send VPS → SPS → PPS (order matters for decoder initialisation)
    if (this.cachedVPS) {
      this.logger.debug(
        `Sending cached VPS header (${this.cachedVPS.length} bytes) to ${connectionId}`
      );
      this.connectionManager.sendToClient(connectionId, this.cachedVPS);
    }

    if (this.cachedSPS) {
      this.logger.debug(
        `Sending cached SPS header (${this.cachedSPS.length} bytes) to ${connectionId}`
      );
      this.connectionManager.sendToClient(connectionId, this.cachedSPS);
    }

    if (this.cachedPPS) {
      this.logger.debug(
        `Sending cached PPS header (${this.cachedPPS.length} bytes) to ${connectionId}`
      );
      this.connectionManager.sendToClient(connectionId, this.cachedPPS);
    }
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

      // Total consumer count = TCP video clients (snapshot, raw video) +
      // in-process muxer clients (fMP4 over the muxed port). Without
      // counting the muxers here the activity timer was killing the
      // livestream whenever the muxer was the only consumer, which broke
      // long-lived downstream rebroadcast sessions.
      const totalConsumers =
        this.connectionManager.getActiveConnectionCount() +
        this.muxerStreams.size;

      if (timeSinceActivity > this.ACTIVITY_TIMEOUT && totalConsumers === 0) {
        this.logger.info(
          `🕒 No client activity for ${Math.round(timeSinceActivity / 1000)}s and no consumers, stopping camera stream`
        );
        this.livestreamIntendedState = false;
        this.stopActivityMonitoring();
        this.ensureLivestreamState();
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
   * Destroy TCP connections older than 5 minutes. Previously this just
   * logged; it now actually force-disconnects the socket. Necessary because
   * when a peer ffmpeg gets SIGKILL-ed the OS sometimes never surfaces a
   * `close` event on our side, leaving a zombie connection that would keep
   * the activity-monitor interval alive forever (and spam the logs every
   * 5 seconds with "Cleaning up stale connection").
   */
  private cleanupStaleConnections(): void {
    const connectionStats = this.connectionManager.getConnectionStats();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [connectionId, info] of Object.entries(connectionStats)) {
      const connectionAge = now - info.connectedAt.getTime();
      if (connectionAge > 5 * 60 * 1000) {
        this.logger.info(
          `Destroying stale connection: ${connectionId} (age: ${Math.round(connectionAge / 1000)}s)`
        );
        this.connectionManager.disconnectClient(connectionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info(`Reaped ${cleanedCount} stale connections`);
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

        // Fan-out to muxer clients (fMP4 via in-process JMuxer). Update
        // the activity clock so the inactivity timer doesn't kill the
        // livestream while muxer clients are actively consuming it.
        if (this.muxerStreams.size > 0) {
          this.lastClientActivity = Date.now();
          for (const { muxer } of this.muxerStreams.values()) {
            try {
              muxer.feed({ video: videoBuffer });
            } catch (e) {
              this.logger.warn(`Muxer video feed error: ${e}`);
            }
          }
        }

        // Stream the video data to raw TCP clients (snapshot service,
        // direct-video stream consumers).
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

    // Listen for livestream audio data events
    let audioFrameCount = 0;
    this.audioEventRemover = this.options.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA,
      (event) => {
        if (event.serialNumber !== this.options.serialNumber) {
          return;
        }

        if (!this.audioMetadata && event.metadata) {
          this.audioMetadata = event.metadata;
          this.logger.info(
            `🔊 Captured audio metadata: codec=${event.metadata.audioCodec}`
          );
        }

        const audioBuffer = Buffer.isBuffer(event.buffer.data)
          ? event.buffer.data
          : Buffer.from(event.buffer.data);

        // Log the first few audio packets so we can tell whether the Eufy
        // stream is ADTS (starts with 0xFFF sync word) or raw AAC.
        if (audioFrameCount < 3) {
          const hex = audioBuffer.subarray(0, Math.min(16, audioBuffer.length)).toString("hex");
          this.logger.info(
            `🔊 Audio frame #${audioFrameCount}: ${audioBuffer.length} bytes, first bytes: ${hex}`
          );
          audioFrameCount++;
        }

        if (this.muxerStreams.size === 0) {
          return;
        }

        // AAC is already in ADTS format from Eufy. JMuxer consumes ADTS.
        const adtsFrame = this.wrapAacInAdtsIfNeeded(audioBuffer);
        if (adtsFrame.length === 0) return;

        for (const { muxer } of this.muxerStreams.values()) {
          try {
            muxer.feed({ audio: adtsFrame });
          } catch (e) {
            this.logger.warn(`Muxer audio feed error: ${e}`);
          }
        }
      },
      {
        source: "device",
        serialNumber: this.options.serialNumber,
      }
    );
  }

  /**
   * Prepend an ADTS header to a raw AAC frame if it doesn't already have one.
   * Assumes AAC-LC, 16 kHz, mono (typical Eufy configuration).
   */
  private wrapAacInAdtsIfNeeded(data: Buffer): Buffer {
    // Already ADTS? (sync word 0xFFF in bytes [0..1])
    if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xf0) === 0xf0) {
      return data;
    }

    // Skip tiny packets (likely AAC Specific Config — 2 bytes — not a frame).
    if (data.length < 7) {
      return Buffer.alloc(0);
    }

    const profile = 2; // AAC-LC
    const freqIndex = 8; // 16000 Hz
    const channels = 1;
    const frameLength = data.length + 7;

    const header = Buffer.alloc(7);
    header[0] = 0xff;
    header[1] = 0xf1; // MPEG-4, Layer 0, protection absent
    header[2] =
      ((profile - 1) << 6) | (freqIndex << 2) | ((channels >> 2) & 0x01);
    header[3] = ((channels & 0x03) << 6) | ((frameLength >> 11) & 0x03);
    header[4] = (frameLength >> 3) & 0xff;
    header[5] = ((frameLength & 0x07) << 5) | 0x1f;
    header[6] = 0xfc;

    return Buffer.concat([header, data]);
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
        // First, check the actual livestream status from the device
        let actualStreamingStatus = false;
        try {
          const statusResponse = await this.options.wsClient.commands
            .device(this.options.serialNumber)
            .isLivestreaming();
          actualStreamingStatus = statusResponse.livestreaming;
          this.logger.debug(
            `Current device livestream status: ${actualStreamingStatus}`
          );
        } catch (error: any) {
          this.logger.warn(
            "Failed to check livestream status, continuing with command:",
            error.message || error
          );
        }

        if (this.livestreamIntendedState && !actualStreamingStatus) {
          // Need to start livestream
          this.logger.info(
            `🎥 Starting livestream (attempt ${attempt}/${maxRetries})`
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
        } else if (this.livestreamIntendedState && actualStreamingStatus) {
          // Stream is already running and we want it running - all good
          this.logger.debug("Livestream already running as desired");
        } else if (!this.livestreamIntendedState && actualStreamingStatus) {
          // Need to stop livestream
          this.logger.info(
            `🛑 Stopping livestream (attempt ${attempt}/${maxRetries})`
          );
          await this.options.wsClient.commands
            .device(this.options.serialNumber)
            .stopLivestream();
          this.logger.info("✅ Livestream stop command sent successfully");
          this.livestreamActualState = false;
        } else {
          // Stream is not running and we don't want it running - all good
          this.logger.debug("Livestream already stopped as desired");
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

    await new Promise<void>((resolve, reject) => {
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

    // Start muxed server — each client connection gets its own in-process
    // JMuxer that produces fragmented MP4 directly from the camera's raw
    // H.264 + ADTS AAC frames. No ffmpeg subprocess, no audio re-encoding.
    await new Promise<void>((resolve, reject) => {
      this.muxedServer = net.createServer((socket) => {
        this.handleMuxedClient(socket);
      });

      this.muxedServer.on("error", (error) => {
        this.logger.warn("Muxed server error:", error);
        reject(error);
      });

      this.muxedServer.listen(0, "127.0.0.1", () => {
        const address = this.muxedServer!.address();
        const port =
          address && typeof address === "object" ? address.port : "?";
        this.logger.info(`🔀 Muxed (fMP4) server started on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Handle a new connection to the muxed TCP server. Each client gets its
   * own in-process JMuxer instance that consumes raw H.264 NAL units and
   * ADTS AAC frames directly from the WebSocket events (no TCP detour,
   * no ffmpeg subprocess) and emits fragmented MP4 on the socket. This is
   * meaningfully faster than the previous ffmpeg-subprocess approach and
   * matches what the Eufy cameras actually deliver byte-for-byte.
   */
  private handleMuxedClient(socket: net.Socket): void {
    const videoFps = this.videoMetadata?.videoFPS ?? 15;
    // Always declare both tracks. The muxed client connects BEFORE the
    // first audio frame arrives from Eufy, so `audioMetadata` is null at
    // this point on a cold start; if we picked mode based on it we'd lock
    // in video-only and silently drop every audio frame thereafter.
    // JMuxer's `both` mode correctly holds audio until the video track is
    // ready, then emits both tracks into the fMP4 moov.
    const mode = "both";

    const muxer = new JMuxer({
      mode,
      fps: videoFps,
      flushingTime: 0,
      clearBuffer: false,
      debug: false,
    });

    const duplex: Duplex = muxer.createStream();
    let firstChunkLogged = false;
    duplex.on("data", (chunk: Buffer) => {
      if (!firstChunkLogged) {
        this.logger.info(
          `🔀 JMuxer emitting fMP4 (first chunk: ${chunk.length} bytes, mode=${mode}, fps=${videoFps})`
        );
        firstChunkLogged = true;
      }
      if (!socket.destroyed) socket.write(chunk);
    });
    duplex.on("error", (err) => {
      this.logger.warn(`JMuxer duplex error: ${err.message}`);
    });

    this.muxerStreams.set(socket, { muxer, duplex });
    this.logger.info(
      `🔀 Muxed client attached (total active muxers: ${this.muxerStreams.size})`
    );

    // This is the first consumer of the stream — bring up the livestream
    // if the stream server's TCP video clients haven't already started it.
    this.updateLivestreamStateForMuxerClients();

    const cleanup = () => {
      if (!this.muxerStreams.has(socket)) return;
      this.muxerStreams.delete(socket);
      try {
        muxer.destroy?.();
      } catch (e) {
        /* ignore */
      }
      this.logger.info(
        `🔀 Muxed client detached (total active muxers: ${this.muxerStreams.size})`
      );
      this.updateLivestreamStateForMuxerClients();
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  /**
   * Start or stop the upstream livestream based on total consumer count
   * (TCP video clients + in-process muxer clients). Called on every
   * muxer-client attach/detach.
   */
  private async updateLivestreamStateForMuxerClients(): Promise<void> {
    const totalConsumers =
      this.connectionManager.getActiveConnectionCount() +
      this.muxerStreams.size;

    if (totalConsumers > 0 && !this.livestreamIntendedState) {
      this.livestreamIntendedState = true;
      this.lastClientActivity = Date.now();
      this.startActivityMonitoring();
      await this.ensureLivestreamState();
    }
    // Intentionally *not* stopping the livestream the moment consumer
    // count drops to 0. Scrypted's Rebroadcast plugin cycles its muxer
    // connection constantly — closes the old one, immediately opens a
    // new one for the next session. Tearing down the Eufy livestream on
    // every disconnect meant the new muxer connected to a cold pipeline,
    // and the downstream FFmpeg would hit "Unable to find sync frame in
    // rtsp prebuffer" until the next camera keyframe (2-4s).
    //
    // The activity monitor handles the genuine "everyone left" case: if
    // no data flows for ACTIVITY_TIMEOUT ms it stops the livestream
    // (lastClientActivity only advances while a consumer is reading).
  }

  /**
   * Get the port the muxed (MPEG-TS) server is listening on.
   */
  getMuxedPort(): number | undefined {
    if (this.muxedServer) {
      const address = this.muxedServer.address();
      if (address && typeof address === "object") {
        return address.port;
      }
    }
    return undefined;
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

    // Clean up WebSocket event listeners
    if (this.eventRemover) {
      this.eventRemover();
      this.eventRemover = undefined;
      this.logger.debug("WebSocket video event listener removed");
    }

    if (this.audioEventRemover) {
      this.audioEventRemover();
      this.audioEventRemover = undefined;
      this.logger.debug("WebSocket audio event listener removed");
    }

    // Tear down all in-process muxers and disconnect their clients
    for (const [socket, { muxer }] of this.muxerStreams) {
      try {
        muxer.destroy?.();
      } catch (e) {
        /* ignore */
      }
      if (!socket.destroyed) socket.destroy();
    }
    this.muxerStreams.clear();

    // Close muxed server
    if (this.muxedServer) {
      this.muxedServer.close();
      this.muxedServer = undefined;
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

    const isHevc =
      this.videoMetadata?.videoCodec.toUpperCase() === "H265" ||
      this.videoMetadata?.videoCodec.toUpperCase() === "HEVC";

    try {
      // Validate bitstream structure (start-code rules are identical for H.264 and H.265)
      const isValid = isHevc
        ? this.h264Parser.validateHevcData(data)
        : this.h264Parser.validateH264Data(data);

      if (!isValid) {
        this.logger.warn(
          `Invalid ${isHevc ? "H.265" : "H.264"} data structure`
        );
        return false;
      }

      // Extract NAL units and detect keyframe using codec-appropriate logic
      const nalUnits = isHevc
        ? this.h264Parser.extractNALUnitsHevc(data)
        : this.h264Parser.extractNALUnits(data);

      if (isKeyFrame === undefined) {
        isKeyFrame = nalUnits.some((nal) => nal.isKeyFrame);
      }

      // Log NAL unit information for debugging
      const nalInfo = nalUnits
        .map((nal) =>
          isHevc
            ? `${this.h264Parser.getNALTypeNameHevc(nal.type)}(${nal.type})`
            : `${this.h264Parser.getNALTypeName(nal.type)}(${nal.type})`
        )
        .join(", ");
      this.logger.debug(
        `Processing ${isHevc ? "H.265" : "H.264"} data: ${data.length} bytes, NALs: [${nalInfo}], keyFrame: ${isKeyFrame}`
      );

      // Cache parameter-set NAL units so new clients can decode mid-stream.
      // H.264: SPS=7, PPS=8   H.265: VPS=32, SPS=33, PPS=34
      nalUnits.forEach((nal) => {
        if (!isHevc && nal.type === 7) {
          this.cachedSPS = data;
          this.logger.debug(`Cached H.264 SPS (${data.length} bytes)`);
        } else if (!isHevc && nal.type === 8) {
          this.cachedPPS = data;
          this.logger.debug(`Cached H.264 PPS (${data.length} bytes)`);
        } else if (isHevc && nal.type === 32) {
          this.cachedVPS = data;
          this.logger.debug(`Cached H.265 VPS (${data.length} bytes)`);
        } else if (isHevc && nal.type === 33) {
          this.cachedSPS = data;
          this.logger.debug(`Cached H.265 SPS (${data.length} bytes)`);
        } else if (isHevc && nal.type === 34) {
          this.cachedPPS = data;
          this.logger.debug(`Cached H.265 PPS (${data.length} bytes)`);
        }
      });

      // Resolve any pending snapshot requests with keyframe data
      // This happens BEFORE checking if server is active, so snapshots work without TCP server
      let snapshotsHandled = false;
      if (isKeyFrame && this.snapshotResolvers.length > 0) {
        this.logger.debug(
          `Resolving ${this.snapshotResolvers.length} snapshot request(s) with keyframe data`
        );
        const resolvers = [...this.snapshotResolvers];
        this.snapshotResolvers = [];
        resolvers.forEach(({ resolve }) => resolve(data));
        snapshotsHandled = true;
      }

      // If server is not active, we've already handled snapshot resolution above
      // Return success only if snapshots were handled, otherwise return false
      if (!this.isActive) {
        if (snapshotsHandled) {
          this.stats.framesProcessed++;
          return true; // Return true because snapshot was handled successfully
        } else {
          return false; // Server not active and no snapshots to handle
        }
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
   * @deprecated Audio is now muxed in-process via JMuxer. The dedicated
   * audio TCP server was removed. Kept for API compatibility; always
   * returns undefined.
   */
  getAudioPort(): number | undefined {
    return undefined;
  }

  /**
   * Get the last received audio metadata (codec).
   * Returns null if no audio stream has been received yet.
   */
  getAudioMetadata(): AudioMetadata | null {
    return this.audioMetadata;
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

    const wasStreamRunning = this.livestreamIntendedState;

    try {
      // Start livestream if not already running or being started
      if (!this.livestreamIntendedState) {
        this.logger.debug("Starting livestream for snapshot capture");
        this.livestreamIntendedState = true;
        await this.ensureLivestreamState();
      } else {
        this.logger.debug(
          "Livestream already intended/running, waiting for keyframe"
        );
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
