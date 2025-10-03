/**
 * Connection Manager - Simple TCP client connection management
 *
 * Manages TCP client connections for the stream server, handling connection
 * lifecycle, data broadcasting, and connection limits. Emits events for
 * connection state changes.
 */

import * as net from "net";
import { EventEmitter } from "events";
import { Logger, ILogObj } from "tslog";
import { ConnectionInfo } from "./types";

/**
 * Simple connection manager for TCP clients
 *
 * Handles incoming TCP socket connections, manages connection lifecycle,
 * broadcasts data to all connected clients, and enforces connection limits.
 *
 * @fires clientConnected - Emitted when a new client connects
 * @fires clientDisconnected - Emitted when a client disconnects
 *
 * @example
 * ```typescript
 * const manager = new ConnectionManager(logger);
 *
 * manager.on('clientConnected', (id, info) => {
 *   console.log(`Client ${id} connected from ${info.remoteAddress}`);
 * });
 *
 * server.on('connection', (socket) => {
 *   manager.handleConnection(socket);
 * });
 * ```
 */
export class ConnectionManager extends EventEmitter {
  private logger: Logger<ILogObj>;
  private connections: Map<string, net.Socket> = new Map();
  private connectionInfo: Map<string, ConnectionInfo> = new Map();
  private connectionCounter = 0;
  private maxConnections = 10;

  /**
   * Creates a new ConnectionManager instance
   *
   * @param logger - Logger instance compatible with tslog's Logger<ILogObj> interface
   */
  constructor(logger: Logger<ILogObj>) {
    super();
    this.logger = logger;
  }

  /**
   * Handle a new incoming TCP client connection
   *
   * Accepts the socket connection, assigns a unique ID, configures socket options
   * (no-delay, keep-alive), and sets up event handlers. Rejects connections if
   * the maximum connection limit is reached.
   *
   * @param socket - TCP socket from incoming connection
   * @fires clientConnected - Emitted with (connectionId, connectionInfo) when client connects
   *
   * @example
   * ```typescript
   * server.on('connection', (socket) => {
   *   manager.handleConnection(socket);
   * });
   * ```
   */
  handleConnection(socket: net.Socket): void {
    if (this.connections.size >= this.maxConnections) {
      this.logger.warn(
        `Connection limit reached (${this.maxConnections}), rejecting connection`
      );
      socket.end();
      return;
    }

    const connectionId = `conn_${++this.connectionCounter}`;
    const remoteAddress = socket.remoteAddress || "unknown";
    const remotePort = socket.remotePort || 0;

    // Store connection
    this.connections.set(connectionId, socket);

    // Store connection info
    const connectionInfo: ConnectionInfo = {
      id: connectionId,
      remoteAddress,
      remotePort,
      connectedAt: new Date(),
      bytesWritten: 0,
      isActive: true,
    };
    this.connectionInfo.set(connectionId, connectionInfo);

    this.logger.info(
      `Client connected: ${connectionId} from ${remoteAddress}:${remotePort}`
    );

    // Set up socket event handlers
    socket.on("close", () => {
      this.handleDisconnection(connectionId);
    });

    socket.on("error", (error) => {
      this.logger.error(`Socket error for ${connectionId}:`, error);
      this.handleDisconnection(connectionId);
    });

    // Configure socket
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);

    this.emit("clientConnected", connectionId, connectionInfo);
  }

  /**
   * Handle client disconnection and cleanup
   *
   * Removes event listeners, destroys the socket, and cleans up connection
   * tracking data. Called automatically when socket closes or errors.
   *
   * @param connectionId - Unique identifier of the connection to close
   * @fires clientDisconnected - Emitted with connectionId when client disconnects
   * @private
   */
  private handleDisconnection(connectionId: string): void {
    const socket = this.connections.get(connectionId);
    const info = this.connectionInfo.get(connectionId);

    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
      this.connections.delete(connectionId);
    }

    if (info) {
      info.isActive = false;
      this.connectionInfo.delete(connectionId);
    }

    this.logger.info(`Client disconnected: ${connectionId}`);
    this.emit("clientDisconnected", connectionId);
  }

  /**
   * Send data to a specific client
   *
   * Sends the provided data buffer to a single client connection.
   * Automatically handles disconnection if the write fails or socket is not writable.
   * Updates bytes written statistics for successful writes.
   *
   * @param connectionId - The ID of the client to send data to
   * @param data - Data buffer to send to the client
   * @returns true if data was successfully sent, false otherwise
   *
   * @example
   * ```typescript
   * const success = manager.sendToClient('conn_1', cachedHeaderBuffer);
   * if (!success) {
   *   console.log('Failed to send data to client');
   * }
   * ```
   */
  sendToClient(connectionId: string, data: Buffer): boolean {
    const socket = this.connections.get(connectionId);
    if (!socket) {
      this.logger.warn(`Cannot send to ${connectionId}: connection not found`);
      return false;
    }

    try {
      if (socket.writable) {
        socket.write(data);

        // Update bytes written
        const info = this.connectionInfo.get(connectionId);
        if (info) {
          info.bytesWritten += data.length;
        }

        this.logger.debug(`Sent ${data.length} bytes to ${connectionId}`);
        return true;
      } else {
        this.logger.warn(`Socket not writable for ${connectionId}`);
        this.handleDisconnection(connectionId);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to write to ${connectionId}:`, error);
      this.handleDisconnection(connectionId);
      return false;
    }
  }

  /**
   * Broadcast data to all connected clients
   *
   * Sends the provided data buffer to all active client connections.
   * Automatically handles disconnection for failed writes or non-writable sockets.
   * Updates bytes written statistics for each successful write.
   *
   * @param data - Data buffer to broadcast to all clients
   * @returns true if data was successfully sent to at least one client, false if no active clients
   *
   * @example
   * ```typescript
   * const success = manager.broadcast(videoDataBuffer);
   * if (!success) {
   *   console.log('No clients connected to receive data');
   * }
   * ```
   */
  broadcast(data: Buffer): boolean {
    if (this.connections.size === 0) {
      return false;
    }

    let successCount = 0;
    const totalConnections = this.connections.size;

    for (const [connectionId, socket] of this.connections) {
      try {
        if (socket.writable) {
          socket.write(data);

          // Update bytes written
          const info = this.connectionInfo.get(connectionId);
          if (info) {
            info.bytesWritten += data.length;
          }

          successCount++;
        } else {
          this.logger.warn(`Socket not writable for ${connectionId}`);
          this.handleDisconnection(connectionId);
        }
      } catch (error) {
        this.logger.error(`Failed to write to ${connectionId}:`, error);
        this.handleDisconnection(connectionId);
      }
    }

    this.logger.debug(
      `Broadcast to ${successCount}/${totalConnections} clients: ${data.length} bytes`
    );
    return successCount > 0;
  }

  /**
   * Get the number of currently active connections
   *
   * @returns Count of active client connections
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get detailed statistics for all connections
   *
   * Returns information about all current connections including connection times,
   * bytes written, and connection status.
   *
   * @returns Record mapping connection IDs to their detailed information
   *
   * @example
   * ```typescript
   * const stats = manager.getConnectionStats();
   * for (const [id, info] of Object.entries(stats)) {
   *   console.log(`${id}: ${info.bytesWritten} bytes sent`);
   * }
   * ```
   */
  getConnectionStats(): Record<string, ConnectionInfo> {
    const stats: Record<string, ConnectionInfo> = {};
    for (const [id, info] of this.connectionInfo) {
      stats[id] = { ...info };
    }
    return stats;
  }

  /**
   * Close all connections and cleanup resources
   *
   * Closes all active client connections, removes all event listeners,
   * and clears connection tracking data. Should be called during server shutdown.
   *
   * @example
   * ```typescript
   * // During server shutdown
   * manager.close();
   * console.log('All connections closed');
   * ```
   */
  close(): void {
    this.logger.info(`Closing ${this.connections.size} connections`);

    for (const [connectionId, socket] of this.connections) {
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch (error) {
        this.logger.error(`Error closing connection ${connectionId}:`, error);
      }
    }

    this.connections.clear();
    this.connectionInfo.clear();
    this.removeAllListeners();
  }
}
