/**
 * Connection Manager - Simple TCP client connection management
 */

import * as net from "net";
import { EventEmitter } from "events";
import { Logger, ILogObj } from "tslog";
import { ConnectionInfo } from "./types";

/**
 * Simple connection manager for TCP clients
 */
export class ConnectionManager extends EventEmitter {
  private logger: Logger<ILogObj>;
  private connections: Map<string, net.Socket> = new Map();
  private connectionInfo: Map<string, ConnectionInfo> = new Map();
  private connectionCounter = 0;
  private maxConnections = 10;

  constructor(logger: Logger<ILogObj>) {
    super();
    this.logger = logger;
  }

  /**
   * Handle a new client connection
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
   * Handle client disconnection
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
   * Broadcast data to all connected clients
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
   * Get number of active connections
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): Record<string, ConnectionInfo> {
    const stats: Record<string, ConnectionInfo> = {};
    for (const [id, info] of this.connectionInfo) {
      stats[id] = { ...info };
    }
    return stats;
  }

  /**
   * Close all connections and cleanup
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
