/**
 * Centralized State Management for Eufy WebSocket Client
 *
 * Provides centralized state management for the entire WebSocket client lifecycle,
 * including connection states, schema negotiation, driver connection, and error handling.
 * This module ensures consistent state tracking across all client components and
 * provides reactive state change notifications.
 *
 * Key responsibilities:
 * - Track connection lifecycle states (disconnected -> connecting -> connected -> ready)
 * - Manage schema negotiation progress and compatibility information
 * - Monitor driver connection status and event listener counts
 * - Provide error state management and recovery tracking
 * - Offer reactive state change subscriptions for UI updates
 * - Ensure thread-safe state transitions and consistency
 *
 * The state manager is designed to be shared across WebSocket client, API manager,
 * and any other components that need to track or react to client state changes.
 *
 * @example Basic Usage
 * ```typescript
 * const stateManager = new ClientStateManager();
 *
 * // Subscribe to state changes
 * const unsubscribe = stateManager.onStateChange((state) => {
 *   console.log('Connection state:', state.connection);
 *   console.log('Driver connected:', state.driverConnected);
 * });
 *
 * // Update state
 * stateManager.setConnectionState(ConnectionState.CONNECTING);
 * stateManager.setDriverConnected(true);
 *
 * // Check readiness
 * if (stateManager.isReady()) {
 *   console.log('Client is ready for API calls');
 * }
 * ```
 *
 * @public
 * @since 1.0.0
 */

import { Logger, ILogObj } from "tslog";
import { SchemaCompatibilityInfo } from "./types/schema";

/**
 * Connection state enumeration for WebSocket client lifecycle
 *
 * Represents the various stages of connection establishment and readiness:
 * - DISCONNECTED: No connection established
 * - CONNECTING: Connection attempt in progress
 * - CONNECTED: WebSocket connected but not yet ready for API calls
 * - SCHEMA_NEGOTIATING: Version negotiation in progress
 * - READY: Fully connected and ready for API commands
 * - ERROR: Connection or operation error occurred
 */
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  SCHEMA_NEGOTIATING = "schema_negotiating",
  READY = "ready",
  ERROR = "error",
}

/**
 * Represents the state of the Eufy Security WebSocket client.
 * Tracks connection status, schema information, and other client state details.
 */
export interface ClientState {
  /** Current connection lifecycle state */
  connection: ConnectionState;
  /** Whether WebSocket connection is established */
  wsConnected: boolean;
  /** Whether API schema negotiation is complete */
  schemaSetupComplete: boolean;
  /** Whether Eufy driver is connected and ready */
  driverConnected: boolean;
  /** Schema compatibility and negotiation details */
  schemaInfo: SchemaCompatibilityInfo | null;
  /** Last error that occurred, if any */
  lastError: Error | null;
  /** Number of reconnection attempts made */
  reconnectAttempts: number;
  /** Number of registered event listeners */
  eventListenerCount: number;
}

/**
 * Centralized State Manager for WebSocket Client
 *
 * Manages the complete state lifecycle of the Eufy WebSocket client with
 * thread-safe state updates and reactive change notifications. This class
 * serves as the single source of truth for client state across all components.
 *
 * Features:
 * - Thread-safe state updates with automatic change notifications
 * - Reactive state subscriptions for UI and component updates
 * - Automatic state consistency management (e.g., disconnection resets schema state)
 * - Error handling and recovery state tracking
 * - Connection lifecycle management with proper state transitions
 *
 * The state manager ensures that all state changes are properly propagated
 * and that dependent states are automatically updated (e.g., WebSocket
 * disconnection automatically clears schema and driver connection states).
 */
export class ClientStateManager {
  private logger: Logger<ILogObj>;

  private state: ClientState = {
    connection: ConnectionState.DISCONNECTED,
    wsConnected: false,
    schemaSetupComplete: false,
    driverConnected: false,
    schemaInfo: null,
    lastError: null,
    reconnectAttempts: 0,
    eventListenerCount: 0,
  };

  private stateChangeCallbacks: ((state: ClientState) => void)[] = [];

  constructor(logger: Logger<ILogObj>) {
    this.logger = logger;
  }

  /**
   * Get current state snapshot
   *
   * Returns a read-only copy of the current state to prevent external
   * modifications. The returned state is a snapshot and will not reflect
   * future changes.
   *
   * @returns Immutable copy of current client state
   */
  getState(): Readonly<ClientState> {
    return { ...this.state };
  }

  /**
   * Update the connection lifecycle state
   *
   * Updates the primary connection state and notifies subscribers if changed.
   * This represents the high-level connection progress through the lifecycle.
   *
   * @param connectionState - New connection state to set
   */
  setConnectionState(connectionState: ConnectionState): void {
    if (this.state.connection !== connectionState) {
      this.state.connection = connectionState;
      this.notifyStateChange();
    }
  }

  /**
   * Update WebSocket connection status with cascading effects
   *
   * Updates the raw WebSocket connection status and automatically resets
   * dependent states when disconnected. This ensures state consistency
   * when the underlying connection is lost.
   *
   * @param connected - Whether WebSocket is connected
   */
  setWebSocketConnected(connected: boolean): void {
    if (this.state.wsConnected !== connected) {
      this.state.wsConnected = connected;
      if (!connected) {
        // Reset dependent states on disconnection
        this.state.schemaSetupComplete = false;
        this.state.driverConnected = false;
        this.state.connection = ConnectionState.DISCONNECTED;
      } else {
        // Check if we should transition to READY when reconnecting
        this.updateConnectionStateFromConditions();
      }
      this.notifyStateChange();
    }
  }

  /**
   * Update schema negotiation completion status
   *
   * Marks schema negotiation as complete and automatically transitions
   * to READY state if WebSocket is also connected. This represents
   * successful API version negotiation.
   *
   * @param complete - Whether schema setup is complete
   */
  setSchemaSetupComplete(complete: boolean): void {
    if (this.state.schemaSetupComplete !== complete) {
      this.state.schemaSetupComplete = complete;
      this.updateConnectionStateFromConditions();
      this.notifyStateChange();
    }
  }

  /**
   * Update Eufy driver connection status
   *
   * Tracks whether the driver.connect command has been successfully
   * executed, which is required for most device operations.
   *
   * @param connected - Whether driver is connected
   */
  setDriverConnected(connected: boolean): void {
    if (this.state.driverConnected !== connected) {
      this.state.driverConnected = connected;
      this.notifyStateChange();
    }
  }

  /**
   * Update schema compatibility information
   *
   * Stores the results of schema negotiation including version details
   * and compatibility status for debugging and monitoring purposes.
   *
   * @param schemaInfo - Schema negotiation results or null to clear
   */
  setSchemaInfo(schemaInfo: SchemaCompatibilityInfo | null): void {
    this.state.schemaInfo = schemaInfo;
    this.notifyStateChange();
  }

  /**
   * Update error state with automatic connection state handling
   *
   * Records the last error and automatically sets connection state to ERROR
   * if an error is provided. Useful for error tracking and recovery.
   *
   * @param error - Error that occurred or null to clear error state
   */
  setError(error: Error | null): void {
    this.state.lastError = error;
    if (error) {
      this.state.connection = ConnectionState.ERROR;
    }
    this.notifyStateChange();
  }

  /**
   * Update reconnection attempt counter
   *
   * Tracks the number of reconnection attempts for exponential backoff
   * and maximum retry limit enforcement.
   *
   * @param attempts - Current number of reconnection attempts
   */
  setReconnectAttempts(attempts: number): void {
    this.state.reconnectAttempts = attempts;
    this.notifyStateChange();
  }

  /**
   * Update event listener count for monitoring
   *
   * Tracks the number of registered event listeners for debugging
   * and performance monitoring purposes.
   *
   * @param count - Current number of event listeners
   */
  setEventListenerCount(count: number): void {
    this.state.eventListenerCount = count;
    this.notifyStateChange();
  }

  /**
   * Update connection state based on current conditions
   *
   * Determines the appropriate connection state based on WebSocket and schema status.
   * Ensures the connection state accurately reflects the current readiness level.
   *
   * @private
   */
  private updateConnectionStateFromConditions(): void {
    if (this.state.wsConnected && this.state.schemaSetupComplete) {
      this.state.connection = ConnectionState.READY;
    }
  }

  /**
   * Check if client is fully ready for API operations
   *
   * Validates that all required setup steps are complete:
   * - WebSocket connection established
   * - Schema negotiation completed successfully
   * - Connection state is READY
   *
   * @returns true if client is ready for API commands
   */
  isReady(): boolean {
    return (
      this.state.connection === ConnectionState.READY &&
      this.state.wsConnected &&
      this.state.schemaSetupComplete
    );
  }

  /**
   * Reset state to initial values for disconnection/restart
   *
   * Resets all state to initial values while preserving event listener count.
   * Used when disconnecting or restarting the connection to ensure clean state.
   */
  reset(): void {
    this.state = {
      connection: ConnectionState.DISCONNECTED,
      wsConnected: false,
      schemaSetupComplete: false,
      driverConnected: false,
      schemaInfo: null,
      lastError: null,
      reconnectAttempts: 0,
      eventListenerCount: this.state.eventListenerCount, // Keep listener count
    };
    this.notifyStateChange();
  }

  /**
   * Subscribe to state changes with reactive updates
   *
   * Registers a callback function to be called whenever the state changes.
   * Useful for UI updates, logging, or triggering dependent operations.
   *
   * @param callback - Function to call when state changes (receives new state)
   * @returns Unsubscribe function to remove the callback
   */
  onStateChange(callback: (state: ClientState) => void): () => void {
    this.stateChangeCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all subscribers of state changes
   *
   * Internal method that calls all registered state change callbacks with
   * the current state. Handles errors in callbacks gracefully to prevent
   * cascading failures.
   */
  private notifyStateChange(): void {
    const currentState = this.getState();
    this.stateChangeCallbacks.forEach((callback) => {
      try {
        callback(currentState);
      } catch (error) {
        // Silently ignore callback errors to prevent cascading failures
      }
    });
  }
}
