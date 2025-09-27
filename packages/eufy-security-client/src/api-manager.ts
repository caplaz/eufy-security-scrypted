/**
 * Eufy Security WebSocket API Manager
 *
 * High-level API manager that provides a complete interface to the eufy-security-ws
 * WebSocket API. This class handles connection lifecycle, event management, command execution,
 * driver connection, state management, and error handling for Eufy devices.
 *
 * Acts as the main entry point for interacting with Eufy devices through the WebSocket container,
 * providing a clean abstraction over the raw WebSocket protocol.
 *
 * @example Basic Usage
 * ```typescript
 * const client = new ApiManager("ws://localhost:3000");
 * await client.connect();
 * await client.connectDriver();
 * await client.startListening();
 *
 * // Listen for device events
 * client.addEventListener("motion_detected", (event) => {
 *   console.log("Motion detected on device:", event.serialNumber);
 * });
 *
 * // Send commands
 * const devices = await client.sendCommand("server.get_devices");
 * ```
 *
 * @public
 * @since 1.0.0
 */

import { WebSocketClient } from "./websocket-client";
import { ClientStateManager } from "./client-state";

import { SERVER_COMMANDS } from "./server/constants";
import { DRIVER_COMMANDS, DRIVER_EVENTS } from "./driver/constants";

import { EventType, EventCallbackForType, EventListener } from "./types/events";
import type { EventSource } from "./common/constants";
import { SchemaCompatibilityInfo } from "./types/schema";
import {
  ResponseForCommand,
  SupportedCommandType,
  isSupportedCommand,
  ParamsForCommand,
} from "./types/commands";
import { StartListeningResponse } from "./server/responses";
import {
  WebSocketEventMessage,
  WebSocketVersionMessage,
} from "./websocket-types";

// Import enhanced command API
import { EnhancedCommandAPI } from "./api-manager-commands";
import { Logger, ILogObj } from "tslog";

/**
 * High-Level API Manager for Eufy Security WebSocket API
 *
 * Main interface for interacting with the eufy-security-ws container. Provides
 * a complete API for managing connections, handling events, and executing commands
 * with proper state management and error handling.
 *
 * The API Manager automatically handles:
 * - WebSocket connection establishment and management
 * - Schema version negotiation with the server
 * - Driver connection and initialization
 * - Event listener registration and dispatching
 * - Command execution with type safety
 * - Connection state tracking and error recovery
 *
 * This class is the recommended entry point for all Eufy WebSocket API operations.
 */
export class ApiManager {
  private client: WebSocketClient;
  private stateManager: ClientStateManager;

  /**
   * Enhanced command API for more elegant command execution.
   * Provides a fluent interface for building and executing commands.
   */
  private _enhancedCommands?: EnhancedCommandAPI;

  // Schema configuration
  private readonly CLIENT_MIN_SCHEMA = 13;
  private readonly CLIENT_PREFERRED_SCHEMA = 21;

  // Event listeners
  private eventListeners: Map<string, EventListener<any, any>> = new Map();
  private listenerIdCounter = 0;

  // Error handlers
  private errorHandlers: Array<(error: Error) => void> = [];

  // CAPTCHA/MFA state
  private pendingCaptcha: { captchaId: string; captcha: string } | null = null;
  private pendingMfa: { methods: string[] } | null = null;

  /**
   * Create a new API Manager instance
   *
   * Initializes the WebSocket client, state manager, and sets up all necessary
   * event handlers for proper API operation. The client will be ready to connect
   * after construction.
   *
   * @param wsUrl - WebSocket server URL (e.g., 'ws://localhost:3000')
   * @param logger - Logger instance for logging
   */
  constructor(
    wsUrl: string,
    private logger: Logger<ILogObj>
  ) {
    this.stateManager = new ClientStateManager(logger);
    this.client = new WebSocketClient(wsUrl, this.stateManager, logger);
    this.setupEventHandlers();
  }

  // ================= STATE MANAGEMENT =================

  /**
   * Get current client state snapshot
   *
   * @returns Current state including connection status, schema info, and counters
   */
  getState() {
    return this.stateManager.getState();
  }

  /**
   * Subscribe to client state changes
   *
   * @param callback - Function to call when state changes occur
   * @returns Unsubscribe function to remove the listener
   */
  onStateChange(callback: (state: any) => void) {
    return this.stateManager.onStateChange(callback);
  }

  /**
   * Enhanced command API with more elegant fluent interface
   *
   * Provides builder pattern and method-based command execution:
   * - api.commands.device("12345").getProperties()
   * - api.commands.driver().connect()
   * - api.commands.command(DEVICE_COMMANDS.GET_PROPERTIES, { serialNumber: "12345" })
   */
  get commands(): EnhancedCommandAPI {
    if (!this._enhancedCommands) {
      this._enhancedCommands = new EnhancedCommandAPI(this);
    }
    return this._enhancedCommands;
  }

  // ================= EVENT LISTENERS =================

  /**
   * Register an event listener for WebSocket events
   *
   * Allows registration of event handlers with optional filtering by event source
   * and device serial number. Useful for listening to specific device events
   * or filtering events by type.
   *
   * @param eventType - Type of event to listen for (strongly typed event identifier)
   * @param eventCallback - Callback function to invoke when matching events occur
   * @param options - Optional filter criteria
   * @param options.source - Only process events from this source (server, driver, device, station)
   * @param options.serialNumber - Only process events from this device serial number
   * @returns Function to call to remove this event listener
   */
  addEventListener<T extends EventType, S extends EventSource>(
    eventType: T,
    eventCallback: EventCallbackForType<T, S>,
    options?: {
      source?: S;
      serialNumber?: string;
    }
  ): () => boolean {
    const listenerId = `listener_${eventType}_${++this.listenerIdCounter}`;

    const listener: EventListener<T, S> = {
      id: listenerId,
      eventType: eventType,
      eventCallback: eventCallback,
      source: options?.source,
      serialNumber: options?.serialNumber,
    };

    this.eventListeners.set(listenerId, listener);
    this.stateManager.setEventListenerCount(this.eventListeners.size);

    // Return a function that removes this specific listener
    return () => {
      const removed = this.eventListeners.delete(listenerId);
      if (removed) {
        this.stateManager.setEventListenerCount(this.eventListeners.size);
      }
      return removed;
    };
  }

  /**
   * Remove a specific event listener by ID
   *
   * @deprecated Use the function returned by addEventListener() instead.
   * The new function-based API is more ergonomic and less error-prone.
   *
   * @param listenerId - Unique listener ID returned by addEventListener
   * @returns true if listener was found and removed, false otherwise
   */
  removeEventListener(listenerId: string): boolean {
    const removed = this.eventListeners.delete(listenerId);
    if (removed) {
      this.stateManager.setEventListenerCount(this.eventListeners.size);
    }
    return removed;
  }

  /**
   * Remove all event listeners of a specific type
   *
   * Removes all registered listeners that match the specified event type.
   * Uses strongly typed event identifiers for precise filtering.
   *
   * @param eventType - Type of events to stop listening for (strongly typed event identifier)
   * @returns Number of listeners removed
   */
  removeEventListenersByType(eventType: EventType): number {
    let removedCount = 0;
    for (const [id, listener] of this.eventListeners) {
      if (listener.eventType === eventType) {
        this.eventListeners.delete(id);
        removedCount++;
      }
    }
    this.stateManager.setEventListenerCount(this.eventListeners.size);
    return removedCount;
  }

  /**
   * Remove all event listeners for multiple event types
   *
   * Efficiently removes all listeners for the specified event types.
   * Useful for cleanup or when switching contexts.
   *
   * @param eventTypes - Array of event types to remove listeners for
   * @returns Number of listeners removed
   */
  removeEventListenersByTypes(eventTypes: EventType[]): number {
    let removedCount = 0;
    const eventTypeSet = new Set(eventTypes);

    for (const [id, listener] of this.eventListeners) {
      if (eventTypeSet.has(listener.eventType)) {
        this.eventListeners.delete(id);
        removedCount++;
      }
    }

    this.stateManager.setEventListenerCount(this.eventListeners.size);
    return removedCount;
  }

  /**
   * Remove all event listeners for a particular serial number and source
   *
   * @param serialNumber - Device or station serial number to remove listeners for
   * @param source - (Optional) Event source to filter (e.g., 'device', 'station')
   * @returns Number of listeners removed
   */
  removeEventListenersBySerialNumber(
    serialNumber: string,
    source?: EventSource
  ): number {
    let removedCount = 0;
    for (const [id, listener] of this.eventListeners) {
      if (
        listener.serialNumber === serialNumber &&
        (!source || listener.source === source)
      ) {
        this.eventListeners.delete(id);
        removedCount++;
      }
    }
    this.stateManager.setEventListenerCount(this.eventListeners.size);
    return removedCount;
  }

  /**
   * Remove all registered event listeners
   *
   * @returns Number of listeners removed
   */
  removeAllEventListeners(): number {
    const count = this.eventListeners.size;
    this.eventListeners.clear();
    this.stateManager.setEventListenerCount(0);
    return count;
  }

  /**
   * Get all registered event listeners (for debugging/monitoring)
   *
   * Returns a snapshot of currently registered listeners for debugging purposes.
   * The returned array contains read-only information about listeners.
   *
   * @returns Array of listener information (without callback functions)
   */
  getEventListeners(): Array<{
    id: string;
    eventType: EventType;
    source?: EventSource;
    serialNumber?: string;
  }> {
    return Array.from(this.eventListeners.values()).map((listener) => ({
      id: listener.id,
      eventType: listener.eventType,
      source: listener.source,
      serialNumber: listener.serialNumber,
    }));
  }

  // ================= CONNECTION MANAGEMENT =================

  /**
   * Establish connection to the WebSocket server
   *
   * Initiates connection to the server and automatically handles schema negotiation.
   * The connection process includes version negotiation and API schema setup.
   *
   * @throws Error if connection fails or schema negotiation fails
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.stateManager.setError(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from the WebSocket server
   *
   * Gracefully closes the WebSocket connection and resets driver connection state.
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Check if client is fully connected and ready for API calls
   *
   * @returns true if WebSocket is connected and schema negotiation is complete
   */
  isConnected(): boolean {
    return this.stateManager.isReady();
  }

  /**
   * Check if driver connection is established
   *
   * @returns true if driver.connect command has been successfully executed
   */
  isDriverConnected(): boolean {
    return this.stateManager.getState().driverConnected;
  }

  /**
   * Get current schema compatibility information
   *
   * @returns Schema negotiation details or null if not yet negotiated
   */
  getSchemaInfo(): SchemaCompatibilityInfo | null {
    return this.stateManager.getState().schemaInfo;
  }

  /**
   * Execute a typed command with parameters and get typed response
   *
   * Sends a command to the WebSocket API with full type safety. Commands are
   * validated against supported command types and proper parameter types are
   * enforced at compile time. Includes automatic retry with exponential backoff.
   *
   * @param command - Command constant (e.g., DEVICE_COMMANDS.GET_PROPERTIES)
   * @param params - Command parameters (type-checked based on command)
   * @returns Promise resolving to typed response data
   * @throws {Error} Client not ready error
   * @throws {Error} Unsupported command error
   * @throws {Error} Server error or timeout after retries
   *
   * @example
   * ```typescript
   * // Get device properties
   * const properties = await client.sendCommand(DEVICE_COMMANDS.GET_PROPERTIES, {
   *   serialNumber: "T8210N20123456789"
   * });
   *
   * // Commands without parameters
   * await client.sendCommand(DRIVER_COMMANDS.CONNECT);
   * ```
   */
  async sendCommand<T extends SupportedCommandType>(
    command: T,
    params: ParamsForCommand<T> = {} as ParamsForCommand<T>
  ): Promise<ResponseForCommand<T>> {
    if (
      command !== SERVER_COMMANDS.SET_API_SCHEMA &&
      !this.stateManager.isReady()
    ) {
      throw new Error("Client not ready. Cannot send commands.");
    }

    if (!isSupportedCommand(command)) {
      throw new Error(`Unsupported command: ${command}`);
    }

    const fullCommand = {
      messageId: this.generateMessageId(command),
      command,
      ...params,
    };

    // Retry configuration
    const MAX_RETRIES = 3;
    const BASE_DELAY = 250; // milliseconds

    let lastError: any;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response =
          await this.client.sendMessage<ResponseForCommand<T>>(fullCommand);
        return response;
      } catch (error) {
        lastError = error;
        if (this.logger) {
          this.logger.info(
            `sendCommand failed (attempt ${attempt}/${MAX_RETRIES}) for command: ${command}`,
            error
          );
        }

        // Exponential backoff with jitter for retries
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 0.1 * delay; // 10% jitter
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        }
      }
    }
    throw (
      lastError ||
      new Error(
        `sendCommand failed for command: ${command} after ${MAX_RETRIES} attempts`
      )
    );
  }

  /**
   * Connect to the Eufy driver
   *
   * Establishes connection to the Eufy cloud driver, which enables real-time
   * event streaming and fresh data from Eufy's cloud services. Many basic
   * device and station commands may work without driver connection using
   * cached data, but this is required for live events and cloud-based operations.
   *
   * @throws Error if client not ready or driver connection fails
   */
  async connectDriver(): Promise<void> {
    if (!this.stateManager.isReady()) {
      throw new Error("Client not ready. Cannot connect driver.");
    }

    try {
      await this.sendCommand(DRIVER_COMMANDS.CONNECT);
      this.stateManager.setDriverConnected(true);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Start listening for real-time events
   *
   * Activates real-time event streaming from the server. Events will be
   * dispatched to registered event listeners. This should be called after
   * driver connection is established. Also updates driver connection state
   * based on the server response.
   *
   * @returns Promise resolving to server response with listening status
   * @throws Error if client not ready or command fails
   */
  async startListening(): Promise<StartListeningResponse> {
    if (!this.stateManager.isReady()) {
      throw new Error("Client not ready. Cannot start listening.");
    }

    const result = await this.sendCommand(SERVER_COMMANDS.START_LISTENING);

    const driverConnected = result.state.driver.connected;
    if (this.logger) {
      this.logger.info(
        `startListening response: driver connected = ${driverConnected}`
      );
    }
    this.stateManager.setDriverConnected(driverConnected);

    return result;
  }

  // ================= PRIVATE METHODS =================

  /**
   * Set up all WebSocket event handlers
   *
   * Configures the WebSocket client with handlers for connection events,
   * version negotiation, and real-time event processing.
   */
  private setupEventHandlers(): void {
    this.client.onConnected(() => {
      // Connection established, waiting for version message
    });

    this.client.onDisconnected(() => {
      this.stateManager.setDriverConnected(false);
    });

    this.client.onVersionMessage(async (message: WebSocketVersionMessage) => {
      try {
        await this.handleVersionMessage(message);
      } catch (error) {
        // Re-trigger the error through the error handler system
        this.stateManager.setError(error as Error);
        this.errorHandlers.forEach((handler) => {
          try {
            handler(error as Error);
          } catch (handlerError) {
            this.logger.error("Error in error handler:", handlerError);
          }
        });
      }
    });

    this.client.onEventMessage((message: WebSocketEventMessage) => {
      this.handleEventMessage(message);
    });

    this.client.onError((error: Error) => {
      this.stateManager.setError(error);
      // Call all registered error handlers
      this.errorHandlers.forEach((handler) => {
        try {
          handler(error);
        } catch (handlerError) {
          // Prevent handler errors from breaking the error flow
          this.logger.error("Error in error handler:", handlerError);
        }
      });
    });
  }

  /**
   * Handle server version message and perform schema negotiation
   *
   * Processes the server's version information and negotiates a compatible
   * API schema version. Uses minimum required schema (13) and preferred
   * schema (21). Sets up the API schema and marks schema setup as complete.
   *
   * @param versionMessage - Version message from server containing schema info.
   * @throws Error if schema incompatibility is detected.
   */
  private async handleVersionMessage(
    versionMessage: WebSocketVersionMessage
  ): Promise<void> {
    const serverMinSchema = versionMessage.minSchemaVersion;
    const serverMaxSchema = versionMessage.maxSchemaVersion;

    // Check if server supports our minimum schema requirement
    const isCompatible = serverMaxSchema >= this.CLIENT_MIN_SCHEMA;

    // Determine which schema to use:
    // 1. Try preferred schema if supported by server
    // 2. Fall back to highest schema supported by both (capped at server max)
    // 3. Ensure it's at least our minimum requirement
    const negotiatedSchema = isCompatible
      ? this.CLIENT_PREFERRED_SCHEMA >= serverMinSchema &&
        this.CLIENT_PREFERRED_SCHEMA <= serverMaxSchema
        ? this.CLIENT_PREFERRED_SCHEMA
        : Math.max(this.CLIENT_MIN_SCHEMA, serverMaxSchema)
      : 0; // Will cause compatibility error below

    const schemaInfo: SchemaCompatibilityInfo = {
      clientMinSchema: this.CLIENT_MIN_SCHEMA,
      clientPreferredSchema: this.CLIENT_PREFERRED_SCHEMA,
      serverMinSchema,
      serverMaxSchema,
      negotiatedSchema,
      isCompatible,
    };

    this.stateManager.setSchemaInfo(schemaInfo);

    if (!isCompatible) {
      const error = new Error(
        `Schema incompatibility: Server supports ${serverMinSchema}-${serverMaxSchema}, ` +
          `Client requires minimum ${this.CLIENT_MIN_SCHEMA} (preferred ${this.CLIENT_PREFERRED_SCHEMA})`
      );
      this.stateManager.setError(error);
      throw error;
    }

    // Use preferred schema if supported, otherwise use negotiated
    const targetSchema =
      this.CLIENT_PREFERRED_SCHEMA >= serverMinSchema &&
      this.CLIENT_PREFERRED_SCHEMA <= serverMaxSchema
        ? this.CLIENT_PREFERRED_SCHEMA
        : negotiatedSchema;

    try {
      await this.sendCommand(SERVER_COMMANDS.SET_API_SCHEMA, {
        schemaVersion: targetSchema,
      });

      schemaInfo.negotiatedSchema = targetSchema;
      this.stateManager.setSchemaInfo(schemaInfo);
      this.stateManager.setSchemaSetupComplete(true);
    } catch (error) {
      this.stateManager.setError(error as Error);
      throw error;
    }
  }

  /**
   * Process incoming event messages and dispatch to listeners
   *
   * Routes event messages to registered event listeners based on filtering
   * criteria (source and serial number). Handles errors in individual
   * listeners without affecting others.
   *
   * @param message - Event message from server
   */
  /**
   * Handle incoming event messages and dispatch to registered listeners
   *
   * Processes event messages from the WebSocket connection and dispatches them
   * to registered event listeners with proper filtering by event type, source,
   * and serial number. Optimized for performance with early filtering and
   * efficient iteration.
   *
   * @param message - Event message from WebSocket
   * @private
   */
  private handleEventMessage(message: WebSocketEventMessage): void {
    const eventPayload = message.event;
    const eventType = eventPayload?.event;

    // Handle driver connection state events internally first
    this.handleDriverConnectionStateEvents(eventPayload);

    // Early exit if no listeners registered
    if (this.eventListeners.size === 0) {
      return;
    }

    // Performance optimization: filter listeners by event type first
    const matchingListeners: EventListener<any, any>[] = [];
    for (const listener of this.eventListeners.values()) {
      if (listener.eventType === eventType) {
        matchingListeners.push(listener);
      }
    }

    // Early exit if no listeners for this event type
    if (matchingListeners.length === 0) {
      return;
    }

    // Apply additional filters and dispatch
    for (const listener of matchingListeners) {
      try {
        // Apply filtering based on source if specified
        if (listener.source && eventPayload?.source !== listener.source) {
          continue;
        }

        // Apply filtering based on serialNumber if specified
        if (
          listener.serialNumber &&
          (!eventPayload ||
            !("serialNumber" in eventPayload) ||
            (eventPayload as any).serialNumber !== listener.serialNumber)
        ) {
          continue;
        }

        listener.eventCallback(eventPayload);
      } catch (error) {
        // Log error but don't break other listeners
        if (this.logger) {
          this.logger.error("Error in event listener:", error);
        } else {
          // Fallback to console if no logger available
          console.error("Error in event listener:", error);
        }
      }
    }
  }

  /**
   * Handle driver connection state events internally
   *
   * Listens for driver connected/disconnected events and updates the state manager
   * accordingly. This ensures that driver connection state is managed centrally
   * in the API manager without requiring external event handling.
   *
   * @param eventPayload - Event payload from the WebSocket event message
   */
  private handleDriverConnectionStateEvents(eventPayload: any): void {
    if (
      !eventPayload ||
      typeof eventPayload !== "object" ||
      !eventPayload.source ||
      !eventPayload.event
    ) {
      return;
    }

    // Check if this is a driver event
    if (eventPayload.source === "driver") {
      switch (eventPayload.event) {
        case DRIVER_EVENTS.CONNECTED:
          if (this.logger) {
            this.logger.info(
              "Driver connected event received, updating state to connected"
            );
          }
          this.stateManager.setDriverConnected(true);
          break;

        case DRIVER_EVENTS.DISCONNECTED:
          if (this.logger) {
            this.logger.info(
              "Driver disconnected event received, updating state to disconnected"
            );
          }
          this.stateManager.setDriverConnected(false);
          break;

        case DRIVER_EVENTS.CAPTCHA_REQUEST:
          if (this.logger) {
            this.logger.info("CAPTCHA request event received");
          }
          // Handle CAPTCHA request - this will be caught by the connect flow
          this.handleCaptchaRequest(eventPayload);
          break;

        case DRIVER_EVENTS.VERIFY_CODE:
          if (this.logger) {
            this.logger.info("MFA verification code request event received");
          }
          // Handle MFA request - this will be caught by the connect flow
          this.handleMfaRequest(eventPayload);
          break;
      }
    }
  }

  /**
   * Handle CAPTCHA request event
   *
   * Called when the server requests CAPTCHA authentication. Extracts the CAPTCHA
   * information and stores it for later retrieval by the CLI.
   *
   * @param eventPayload - CAPTCHA request event payload
   */
  private handleCaptchaRequest(eventPayload: any): void {
    const captchaId = eventPayload.captchaId;
    const captcha = eventPayload.captcha;

    if (this.logger) {
      this.logger.info(`CAPTCHA required - ID: ${captchaId}`);
    }

    // Store CAPTCHA info for later retrieval
    this.pendingCaptcha = { captchaId, captcha };

    // Don't throw here - let the CLI check for pending CAPTCHA after operations
  }

  /**
   * Handle MFA verification code request event
   *
   * Called when the server requests MFA verification. Stores the information
   * for later retrieval by the CLI.
   *
   * @param eventPayload - MFA request event payload
   */
  private handleMfaRequest(eventPayload: any): void {
    const methods = eventPayload.methods || [];

    if (this.logger) {
      this.logger.info(
        `MFA verification required - methods: ${methods.join(", ")}`
      );
    }

    // Store MFA info for later retrieval
    this.pendingMfa = { methods };

    // Don't throw here - let the CLI check for pending MFA after operations
  }

  /**
   * Generate unique message ID for command correlation
   *
   * Creates a unique identifier for each command message to enable proper
   * request-response correlation in the WebSocket protocol.
   *
   * @param command - Command type being sent.
   * @returns Unique message identifier.
   */
  private generateMessageId(command: SupportedCommandType): string {
    return `${command}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ================= LOGGING =================

  /**
   * Get pending CAPTCHA information
   *
   * Returns CAPTCHA information from the last CAPTCHA request event.
   * This is used by the CLI to display CAPTCHA information to the user.
   *
   * @returns CAPTCHA information or null if no CAPTCHA is pending
   */
  getPendingCaptcha(): { captchaId: string; captcha: string } | null {
    return this.pendingCaptcha;
  }

  /**
   * Clear pending CAPTCHA information
   *
   * Clears any stored CAPTCHA information after it has been used.
   */
  clearPendingCaptcha(): void {
    this.pendingCaptcha = null;
  }

  /**
   * Get pending MFA information
   *
   * Returns MFA information from the last MFA request event.
   * This is used by the CLI to display MFA information to the user.
   *
   * @returns MFA information or null if no MFA is pending
   */
  getPendingMfa(): { methods: string[] } | null {
    return this.pendingMfa;
  }

  /**
   * Clear pending MFA information
   *
   * Clears any stored MFA information after it has been used.
   */
  clearPendingMfa(): void {
    this.pendingMfa = null;
  }

  /**
   * Register error handler for WebSocket and API errors
   *
   * @param handler - Callback function to handle errors
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }
}
