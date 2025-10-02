/**
 * WebSocket Client for Eufy Security WebSocket API
 *
 * Provides a robust WebSocket connection with automatic reconnection, state management,
 * and proper message handling. This client handles:
 * - Connection lifecycle management (connect, disconnect, reconnect)
 * - Message queuing and timeout handling
 * - Event-driven architecture for version negotiation and event streaming
 * - Centralized state management integration
 * - Error handling and connection recovery
 *
 * The client is designed to be used by higher-level API managers and provides
 * a clean abstraction over the raw WebSocket connection.
 *
 * @example Basic Usage
 * ```typescript
 * const client = new WebSocketClient("ws://localhost:3000");
 * client.onConnected(() => console.log("Connected"));
 * client.onEventMessage((event) => console.log("Event:", event));
 * await client.connect();
 * ```
 *
 * @public
 * @since 1.0.0
 */

import WebSocket from "ws";
import {
  MESSAGE_TYPES,
  WebSocketCommand,
  WebSocketEventMessage,
  WebSocketMessage,
  WebSocketVersionMessage,
} from "./websocket-types";
import { ConnectionState, ClientStateManager } from "./client-state";
import { Logger, ILogObj } from "tslog";
import { WebSocketMessageProcessor } from "./utils/websocket-message-processor";

/**
 * Represents a message that is pending a response.
 * Tracks the message ID, command, and other details for pending messages.
 */
export interface PendingMessage {
  /** Promise resolver for successful response */
  resolve: Function;
  /** Promise rejector for failed response or timeout */
  reject: Function;
  /** Timeout handle for message expiration */
  timeout: NodeJS.Timeout;
}

/**
 * WebSocket Client with State Management and Automatic Reconnection
 *
 * Core WebSocket client that handles the low-level connection to the eufy-security-ws
 * container. Provides reliable message delivery, automatic reconnection with exponential
 * backoff, and proper state management integration.
 *
 * Features:
 * - Automatic reconnection with configurable retry limits
 * - Message correlation and timeout handling with efficient cleanup
 * - Event-driven architecture for different message types
 * - Integration with centralized state management
 * - Connection state tracking and error handling
 * - Memory-efficient message processing
 *
 * @public
 * @since 1.0.0
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private pendingMessages = new Map<string, PendingMessage>();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private maxReconnectAttempts = 10;
  private messageTimeout = 30000; // 30 seconds

  // Optimization: Use WeakRef for state manager to allow garbage collection
  private stateManager: ClientStateManager;
  private messageProcessor: WebSocketMessageProcessor;

  // Event handlers - using arrow functions to avoid binding overhead
  private onConnectedHandler?: () => void;
  private onDisconnectedHandler?: () => void;
  private onVersionHandler?: (message: WebSocketVersionMessage) => void;
  private onEventHandler?: (message: WebSocketEventMessage) => void;
  private onErrorHandler?: (error: Error) => void;
  private logger: Logger<ILogObj>;

  // Performance monitoring (optional)
  private messageCount = 0;
  private lastMessageTime = 0;

  /**
   * Creates a new WebSocket client instance
   *
   * @param wsUrl - WebSocket server URL (e.g., 'ws://localhost:3000')
   * @param stateManager - State manager instance for centralized state tracking
   * @param logger - Logger instance for logging messages
   *
   * @example
   * ```typescript
   * const stateManager = new ClientStateManager(logger);
   * const client = new WebSocketClient("ws://localhost:3000", stateManager, logger);
   * ```
   */
  constructor(
    wsUrl: string,
    stateManager: ClientStateManager,
    logger: Logger<ILogObj>
  ) {
    this.wsUrl = wsUrl;
    this.stateManager = stateManager;
    this.logger = logger;
    this.messageProcessor = new WebSocketMessageProcessor(logger);
  }

  /**
   * Get the current state manager instance
   *
   * @returns The ClientStateManager instance used by this client
   */
  getStateManager(): ClientStateManager {
    return this.stateManager;
  }

  /**
   * Register handler for successful WebSocket connection
   * Called when the WebSocket connection is established and ready
   *
   * @param handler - Callback function to execute on connection
   */
  onConnected(handler: () => void): void {
    this.onConnectedHandler = handler;
  }

  /**
   * Register handler for WebSocket disconnection
   * Called when the WebSocket connection is closed or lost
   *
   * @param handler - Callback function to execute on disconnection
   */
  onDisconnected(handler: () => void): void {
    this.onDisconnectedHandler = handler;
  }

  /**
   * Register handler for version/schema negotiation messages
   * Called when the server sends version information for API compatibility
   *
   * @param handler - Callback function to process version messages
   */
  onVersionMessage(handler: (message: WebSocketVersionMessage) => void): void {
    this.onVersionHandler = handler;
  }

  /**
   * Register handler for event messages from the server
   * Called when the server pushes real-time events (device updates, etc.)
   *
   * @param handler - Callback function to process event messages
   */
  onEventMessage(handler: (message: WebSocketEventMessage) => void): void {
    this.onEventHandler = handler;
  }

  /**
   * Register handler for WebSocket errors
   * Called when connection errors or message parsing errors occur
   *
   * @param handler - Callback function to handle errors
   */
  onError(handler: (error: Error) => void): void {
    this.onErrorHandler = handler;
  }

  /**
   * Establish WebSocket connection to the server
   *
   * Initiates connection to the configured WebSocket URL and sets up all event handlers.
   * Updates connection state throughout the process and handles connection errors.
   *
   * @returns Promise that resolves when connection is established, rejects on failure
   * @throws Error if connection fails or times out
   */
  async connect(): Promise<void> {
    this.stateManager.setConnectionState(ConnectionState.CONNECTING);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on("open", () => {
          this.stateManager.setWebSocketConnected(true);
          this.stateManager.setConnectionState(ConnectionState.CONNECTED);
          this.stateManager.setReconnectAttempts(0);

          this.onConnectedHandler?.();
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          // Use message processor for validation and parsing
          const result = this.messageProcessor.processMessage(data);

          if (!result.valid) {
            this.logger.warn(`Invalid message dropped: ${result.error}`);
            // Don't set error state for invalid messages - just log and continue
            return;
          }

          try {
            this.handleMessage(result.message as WebSocketMessage);
          } catch (error) {
            const err = error as Error;
            this.logger.error("Error handling processed message:", err);
            this.stateManager.setError(err);
            this.onErrorHandler?.(err);
          }
        });

        this.ws.on("close", (code: number, _reason: string) => {
          this.stateManager.setWebSocketConnected(false);
          this.clearPendingMessages();
          this.onDisconnectedHandler?.();

          if (code !== 1000) {
            // Not a normal closure
            this.scheduleReconnect();
          }
        });

        this.ws.on("error", (error: Error) => {
          this.stateManager.setError(error);
          this.onErrorHandler?.(error);
          if (!this.isConnected()) {
            reject(error);
          }
        });
      } catch (error) {
        const err = error as Error;
        this.stateManager.setError(err);
        reject(err);
      }
    });
  }

  /**
   * Gracefully disconnect from WebSocket server
   *
   * Closes the WebSocket connection with normal closure code, cancels any pending
   * reconnection attempts, and cleans up all pending messages and state.
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Normal closure");
      this.ws = null;
    }

    this.stateManager.reset();
    this.clearPendingMessages();
  }

  /**
   * Check if WebSocket is currently connected and ready
   *
   * @returns true if WebSocket is connected and ready to send/receive messages
   */
  isConnected(): boolean {
    return (
      this.stateManager.getState().wsConnected &&
      this.ws?.readyState === WebSocket.OPEN
    );
  }

  /**
   * Send a command message to the WebSocket server and wait for response
   *
   * Sends a command message with correlation ID and waits for the corresponding
   * response. Handles message timeouts and connection state validation.
   *
   * @param message - Command message to send (must include messageId for correlation)
   * @returns Promise that resolves with the server response or rejects on error/timeout
   * @throws Error if not connected, message times out, or server returns an error
   */
  async sendMessage<T = any>(message: WebSocketCommand): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error("WebSocket is not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingMessages.delete(message.messageId);
        reject(new Error(`Message timeout: ${message.messageId}`));
      }, this.messageTimeout);

      this.pendingMessages.set(message.messageId, {
        resolve,
        reject,
        timeout,
      });

      try {
        this.ws!.send(JSON.stringify(message));
      } catch (error) {
        this.pendingMessages.delete(message.messageId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Process incoming WebSocket messages based on type
   *
   * Routes different message types to appropriate handlers:
   * - VERSION: Schema negotiation messages
   * - EVENT: Real-time event notifications
   * - RESULT/RESPONSE: Command response correlation
   *
   * Optimized for performance with early type checking and minimal object creation.
   *
   * @param message - Parsed WebSocket message from server
   * @private
   */
  private handleMessage(message: WebSocketMessage): void {
    // Performance tracking
    this.messageCount++;
    this.lastMessageTime = Date.now();

    // Early type-based routing for performance
    const messageType = message.type;

    if (messageType === MESSAGE_TYPES.VERSION) {
      this.stateManager.setConnectionState(ConnectionState.SCHEMA_NEGOTIATING);
      this.onVersionHandler?.(message as WebSocketVersionMessage);
      return;
    }

    if (messageType === MESSAGE_TYPES.EVENT) {
      this.onEventHandler?.(message as WebSocketEventMessage);
      return;
    }

    // Handle command responses with message correlation
    const messageId = message.messageId;
    if (messageId && this.pendingMessages.has(messageId)) {
      const pending = this.pendingMessages.get(messageId)!;
      this.pendingMessages.delete(messageId);
      clearTimeout(pending.timeout);

      const success = message.success;
      if (success === false) {
        const errorCode = message.errorCode || "Unknown error";
        pending.reject(new Error(`Command failed: ${errorCode}`));
      } else {
        const result = message.result || message;
        pending.resolve(result);
      }
      return;
    }

    // Log unhandled messages only if logging is enabled
    if (this.logger) {
      this.logger.info("Unhandled message type:", messageType);
    }
  }

  /**
   * Schedule automatic reconnection with exponential backoff
   *
   * Implements exponential backoff strategy for reconnection attempts to avoid
   * overwhelming the server. Respects maximum retry limits and existing reconnection
   * attempts to prevent multiple concurrent reconnection processes.
   *
   * Backoff formula: min(1000 * 2^attempts, 30000) milliseconds + jitter
   *
   * @private
   */
  private scheduleReconnect(): void {
    const state = this.stateManager.getState();

    if (
      this.reconnectTimeout ||
      state.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      return;
    }

    // Exponential backoff with jitter to prevent thundering herd
    const baseDelay = Math.min(
      1000 * Math.pow(2, state.reconnectAttempts),
      30000
    );
    const jitter = Math.random() * 0.1 * baseDelay; // 10% jitter
    const delay = baseDelay + jitter;

    this.stateManager.setReconnectAttempts(state.reconnectAttempts + 1);

    if (this.logger) {
      this.logger.info(
        `Scheduling reconnection attempt ${state.reconnectAttempts + 1}/${
          this.maxReconnectAttempts
        } in ${Math.round(delay)}ms`
      );
    }

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch (error) {
        if (this.logger) {
          this.logger.info("Reconnection attempt failed:", error);
        }
        // Will trigger another reconnect attempt if under limit
      }
    }, delay);
  }

  /**
   * Clean up all pending message promises on disconnection
   *
   * Rejects all pending message promises with connection error and clears
   * their timeout handlers to prevent memory leaks. Called during disconnection
   * or connection loss to ensure no promises remain hanging.
   *
   * @private
   */
  private clearPendingMessages(): void {
    for (const pending of this.pendingMessages.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingMessages.clear();
  }

  /**
   * Get performance metrics for monitoring and debugging
   *
   * @returns Performance metrics object
   * @public
   */
  getPerformanceMetrics(): {
    messageCount: number;
    lastMessageTime: number;
    pendingMessageCount: number;
    isConnected: boolean;
    reconnectAttempts: number;
  } {
    const state = this.stateManager.getState();
    return {
      messageCount: this.messageCount,
      lastMessageTime: this.lastMessageTime,
      pendingMessageCount: this.pendingMessages.size,
      isConnected: this.isConnected(),
      reconnectAttempts: state.reconnectAttempts,
    };
  }

  /**
   * Reset performance metrics
   *
   * @public
   */
  resetPerformanceMetrics(): void {
    this.messageCount = 0;
    this.lastMessageTime = 0;
    this.messageProcessor.resetStats();
  }

  /**
   * Get message processing statistics
   *
   * @public
   */
  getMessageProcessingStats() {
    return this.messageProcessor.getStats();
  }
}
