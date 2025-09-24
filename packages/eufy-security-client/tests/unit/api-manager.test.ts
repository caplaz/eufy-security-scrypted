/**
 * Unit tests for ApiManager
 * Tests the high-level API management functionality
 */

import { ApiManager } from "../../src/api-manager";
import { WebSocketClient } from "../../src/websocket-client";
import { ClientStateManager, ConnectionState } from "../../src/client-state";
import { MESSAGE_TYPES } from "../../src/websocket-types";
import { SERVER_COMMANDS } from "../../src/server/constants";
import { DEVICE_COMMANDS, DEVICE_EVENTS } from "../../src/device/constants";
import { DRIVER_EVENTS } from "../../src/driver/constants";
import { Logger, ILogObj } from "tslog";

// Mock WebSocketClient
jest.mock("../../src/websocket-client");
const MockWebSocketClient = WebSocketClient as jest.MockedClass<
  typeof WebSocketClient
>;

describe("ApiManager", () => {
  let apiManager: ApiManager;
  let mockWebSocketClient: jest.Mocked<WebSocketClient>;
  let stateManager: ClientStateManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock WebSocket client
    mockWebSocketClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      sendMessage: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
      getStateManager: jest.fn(),
      onConnected: jest.fn(),
      onDisconnected: jest.fn(),
      onVersionMessage: jest.fn(),
      onEventMessage: jest.fn(),
      onError: jest.fn(),
      setDebugLogging: jest.fn(),
    } as any;

    MockWebSocketClient.mockImplementation(() => mockWebSocketClient);

    const logger = new Logger<ILogObj>();
    stateManager = new ClientStateManager(logger);
    mockWebSocketClient.getStateManager.mockReturnValue(stateManager);

    apiManager = new ApiManager("ws://localhost:3000", logger);
  });

  afterEach(() => {
    apiManager.disconnect();
  });

  // Helper function to set up ready state for tests that need it
  const setupReadyState = () => {
    // Access the state manager through the mock
    const apiStateManager = (apiManager as any).stateManager;
    apiStateManager.setConnectionState(ConnectionState.READY);
    apiStateManager.setWebSocketConnected(true);
    apiStateManager.setDriverConnected(true);
    apiStateManager.setSchemaSetupComplete(true);
    apiStateManager.setSchemaInfo({
      clientMinSchema: 13,
      clientPreferredSchema: 21,
      serverMinSchema: 16,
      serverMaxSchema: 18,
      negotiatedSchema: 18,
      isCompatible: true,
    });
  };

  describe("initialization", () => {
    test("should create API manager with WebSocket client", () => {
      expect(MockWebSocketClient).toHaveBeenCalledWith(
        "ws://localhost:3000",
        expect.any(ClientStateManager),
        expect.any(Object) // logger
      );
      expect(mockWebSocketClient.onConnected).toHaveBeenCalled();
      expect(mockWebSocketClient.onDisconnected).toHaveBeenCalled();
      expect(mockWebSocketClient.onVersionMessage).toHaveBeenCalled();
      expect(mockWebSocketClient.onEventMessage).toHaveBeenCalled();
      expect(mockWebSocketClient.onError).toHaveBeenCalled();
    });

    test("should create API manager with custom state manager", () => {
      // Constructor only takes wsUrl, state manager is created internally
      const logger = new Logger<ILogObj>();
      const customApiManager = new ApiManager("ws://localhost:3001", logger);

      expect(MockWebSocketClient).toHaveBeenCalledWith(
        "ws://localhost:3001",
        expect.any(ClientStateManager),
        expect.any(Object) // logger
      );
      customApiManager.disconnect();
    });
  });

  describe("connection management", () => {
    test("should connect successfully", async () => {
      await apiManager.connect();

      expect(mockWebSocketClient.connect).toHaveBeenCalled();
    });

    test("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      mockWebSocketClient.connect.mockRejectedValue(error);

      await expect(apiManager.connect()).rejects.toThrow("Connection failed");
    });

    test("should disconnect cleanly", () => {
      apiManager.disconnect();

      expect(mockWebSocketClient.disconnect).toHaveBeenCalled();
    });

    test("should get connection state", () => {
      // Access the internal state manager
      const apiStateManager = (apiManager as any).stateManager;
      apiStateManager.setConnectionState(ConnectionState.READY);

      const state = apiManager.getState();
      expect(state.connection).toBe(ConnectionState.READY);
    });

    test("should check if connected", () => {
      stateManager.setWebSocketConnected(true);
      stateManager.setSchemaSetupComplete(true);

      expect(stateManager.isReady()).toBe(true);
    });
  });

  describe("schema negotiation", () => {
    test("should handle version message and negotiate schema", async () => {
      const versionMessage = {
        type: MESSAGE_TYPES.VERSION,
        driverVersion: "2.4.3",
        serverVersion: "1.5.6",
        minSchemaVersion: 16,
        maxSchemaVersion: 18,
      };

      // Get the version handler that was registered
      const versionHandler = (mockWebSocketClient.onVersionMessage as jest.Mock)
        .mock.calls[0][0];

      // Call the handler
      await versionHandler(versionMessage);

      // Verify schema negotiation command was sent
      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "set_api_schema",
          schemaVersion: expect.any(Number),
        })
      );
    });

    test("should handle incompatible schema versions", async () => {
      const versionMessage = {
        type: MESSAGE_TYPES.VERSION,
        driverVersion: "2.4.3",
        serverVersion: "1.5.6",
        minSchemaVersion: 10, // Below client minimum (13)
        maxSchemaVersion: 12,
      };

      const errorHandler = jest.fn();
      apiManager.onError(errorHandler);

      const versionHandler = (mockWebSocketClient.onVersionMessage as jest.Mock)
        .mock.calls[0][0];

      // The version handler no longer throws, but calls error handlers
      await versionHandler(versionMessage);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Schema incompatibility"),
        })
      );
    });
  });

  describe("command execution", () => {
    beforeEach(() => {
      // Set up ready state for command execution
      setupReadyState();
    });

    test("should send server commands", async () => {
      const response = { success: true, result: { version: "1.0.0" } };
      mockWebSocketClient.sendMessage.mockResolvedValue(response);

      const result = await apiManager.sendCommand(
        SERVER_COMMANDS.START_LISTENING
      );

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: SERVER_COMMANDS.START_LISTENING,
          messageId: expect.any(String),
        })
      );
      expect(result).toBe(response);
    });

    test("should send device commands with serial number", async () => {
      const response = { success: true, result: { properties: {} } };
      mockWebSocketClient.sendMessage.mockResolvedValue(response);

      const result = await apiManager.sendCommand(
        DEVICE_COMMANDS.GET_PROPERTIES,
        {
          serialNumber: "T8210N20123456789",
        }
      );

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: DEVICE_COMMANDS.GET_PROPERTIES,
          serialNumber: "T8210N20123456789",
          messageId: expect.any(String),
        })
      );
      expect(result).toBe(response);
    });

    test("should handle command errors", async () => {
      const error = new Error("Command failed");
      mockWebSocketClient.sendMessage.mockRejectedValue(error);

      await expect(
        apiManager.sendCommand(SERVER_COMMANDS.START_LISTENING)
      ).rejects.toThrow("Command failed");
    });

    test("should reject commands when not ready", async () => {
      // Reset the state to not-ready after setupReadyState() was called
      const apiStateManager = (apiManager as any).stateManager;
      apiStateManager.setSchemaSetupComplete(false);

      await expect(
        apiManager.sendCommand(SERVER_COMMANDS.START_LISTENING)
      ).rejects.toThrow("Client not ready");
    });
  });

  describe("driver management", () => {
    beforeEach(() => {
      setupReadyState();
    });

    test("should connect driver", async () => {
      const response = { success: true, result: { connected: true } };
      mockWebSocketClient.sendMessage.mockResolvedValue(response);

      await apiManager.connectDriver();

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "driver.connect",
          messageId: expect.any(String),
        })
      );

      // Check the actual API manager state
      const apiState = apiManager.getState();
      expect(apiState.driverConnected).toBe(true);
    });

    test("should start listening", async () => {
      const mockResult = {
        state: {
          devices: [],
          stations: [],
          driver: { connected: true },
        },
        listening: true,
      };
      mockWebSocketClient.sendMessage.mockResolvedValue(mockResult);

      const result = await apiManager.startListening();

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "start_listening", // Should match SERVER_COMMANDS.START_LISTENING
          messageId: expect.any(String),
        })
      );
      expect(result).toBe(mockResult);
    });
  });

  describe("event management", () => {
    test("should register event listeners", () => {
      const callback = jest.fn();

      const removeListener = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        callback
      );

      expect(typeof removeListener).toBe("function");

      // Test that the function works to remove the listener
      const removed = removeListener();
      expect(removed).toBe(true);
    });

    test("should filter events by source", () => {
      const callback = jest.fn();

      const listenerId = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        callback,
        {
          source: "device",
        }
      );

      // Get the event handler that was registered
      const eventHandler = (mockWebSocketClient.onEventMessage as jest.Mock)
        .mock.calls[0][0];

      // Simulate device event
      const deviceEvent = {
        type: MESSAGE_TYPES.EVENT,
        event: {
          source: "device",
          event: "property changed",
          serialNumber: "T8210N20123456789",
        },
      };
      eventHandler(deviceEvent);

      expect(callback).toHaveBeenCalledWith(deviceEvent.event);

      // Simulate server event (should be filtered out)
      const serverEvent = {
        type: MESSAGE_TYPES.EVENT,
        event: {
          source: "server",
          event: "listening started",
        },
      };
      eventHandler(serverEvent);

      expect(callback).toHaveBeenCalledTimes(1); // Still only called once

      // Clean up
      listenerId();
    });

    test("should filter events by serial number", () => {
      const callback = jest.fn();
      const targetSerial = "T8210N20123456789";

      const listenerId = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        callback,
        {
          source: "device",
          serialNumber: targetSerial,
        }
      );

      const eventHandler = (mockWebSocketClient.onEventMessage as jest.Mock)
        .mock.calls[0][0];

      // Simulate matching device event
      const matchingEvent = {
        type: MESSAGE_TYPES.EVENT,
        event: {
          source: "device",
          event: "property changed",
          serialNumber: targetSerial,
        },
      };
      eventHandler(matchingEvent);

      expect(callback).toHaveBeenCalledWith(matchingEvent.event);

      // Simulate non-matching device event
      const nonMatchingEvent = {
        type: MESSAGE_TYPES.EVENT,
        event: {
          source: "device",
          event: "property changed",
          serialNumber: "different-serial",
        },
      };
      eventHandler(nonMatchingEvent);

      expect(callback).toHaveBeenCalledTimes(1); // Still only called once

      // Clean up
      listenerId();
    });

    test("should remove event listeners", () => {
      const callback = jest.fn();

      const listenerId = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        callback
      );
      const removed = listenerId();

      expect(removed).toBe(true);

      const eventHandler = (mockWebSocketClient.onEventMessage as jest.Mock)
        .mock.calls[0][0];

      const event = {
        type: MESSAGE_TYPES.EVENT,
        event: {
          source: "device",
          event: "property changed",
        },
      };
      eventHandler(event);

      expect(callback).not.toHaveBeenCalled();
    });

    test("should return false when removing non-existent listener", () => {
      const removed = apiManager.removeEventListener("non-existent-id");
      expect(removed).toBe(false);
    });

    test("should remove event listeners by type", () => {
      const deviceCallback = jest.fn();
      const driverCallback = jest.fn();

      // Register listeners for different event types
      const deviceListenerId = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        deviceCallback
      );
      const driverListenerId = apiManager.addEventListener(
        DRIVER_EVENTS.CONNECTED,
        driverCallback
      );

      // Verify both are registered
      expect(apiManager.getState().eventListenerCount).toBe(2);

      // Remove only device event listeners
      const removedCount = apiManager.removeEventListenersByType(
        DEVICE_EVENTS.PROPERTY_CHANGED
      );

      expect(removedCount).toBe(1);
      expect(apiManager.getState().eventListenerCount).toBe(1);

      // Verify device listener is removed but driver listener remains
      expect(deviceListenerId()).toBe(false); // Already removed
      expect(driverListenerId()).toBe(true); // Still exists
    });

    test("should remove listeners for multiple event types", () => {
      const deviceCallback = jest.fn();
      const driverCallback = jest.fn();

      // Register listeners for different event types (using unique event types)
      apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        deviceCallback
      );
      apiManager.addEventListener(
        DEVICE_EVENTS.MOTION_DETECTED,
        deviceCallback
      );
      apiManager.addEventListener(DRIVER_EVENTS.PUSH_CONNECTED, driverCallback);
      apiManager.addEventListener(DRIVER_EVENTS.MQTT_CONNECTED, driverCallback);

      // Verify all are registered
      expect(apiManager.getState().eventListenerCount).toBe(4);

      // Remove multiple types at once
      const removedCount = apiManager.removeEventListenersByTypes([
        DEVICE_EVENTS.PROPERTY_CHANGED,
        DRIVER_EVENTS.PUSH_CONNECTED,
      ]);

      expect(removedCount).toBe(2);
      expect(apiManager.getState().eventListenerCount).toBe(2);
    });

    test("should get event listener information", () => {
      const callback = jest.fn();

      // Register a listener with filters
      const removeListener = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        callback,
        {
          source: "device",
          serialNumber: "T8210N20123456789",
        }
      );

      const listeners = apiManager.getEventListeners();

      expect(listeners).toHaveLength(1);
      expect(listeners[0]).toEqual({
        id: expect.stringMatching(/^listener_/),
        eventType: DEVICE_EVENTS.PROPERTY_CHANGED,
        source: "device",
        serialNumber: "T8210N20123456789",
      });

      // Should not expose callback function
      expect(listeners[0]).not.toHaveProperty("eventCallback");

      // Clean up
      removeListener();
    });
  });

  describe("state management", () => {
    test("should provide state change subscriptions", () => {
      const callback = jest.fn();

      const unsubscribe = apiManager.onStateChange(callback);

      // Access the internal state manager
      const apiStateManager = (apiManager as any).stateManager;
      apiStateManager.setConnectionState(ConnectionState.READY);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: ConnectionState.READY,
        })
      );

      // Test unsubscribe function
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });

    test("should get current state", () => {
      const apiStateManager = (apiManager as any).stateManager;
      apiStateManager.setConnectionState(ConnectionState.READY);

      const state = apiManager.getState();

      expect(state.connection).toBe(ConnectionState.READY);
    });
  });

  describe("error handling", () => {
    test("should register error handlers", () => {
      const errorHandler = jest.fn();

      apiManager.onError(errorHandler);

      // Get the error handler that was registered with WebSocket client
      const wsErrorHandler = (mockWebSocketClient.onError as jest.Mock).mock
        .calls[0][0];

      const error = new Error("Test error");
      wsErrorHandler(error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    test("should handle schema negotiation errors", async () => {
      const errorHandler = jest.fn();
      apiManager.onError(errorHandler);

      const versionMessage = {
        type: MESSAGE_TYPES.VERSION,
        driverVersion: "2.4.3",
        serverVersion: "1.5.6",
        minSchemaVersion: 0,
        maxSchemaVersion: 0,
      };

      const versionHandler = (mockWebSocketClient.onVersionMessage as jest.Mock)
        .mock.calls[0][0];

      // The version handler no longer throws, but calls error handlers
      await versionHandler(versionMessage);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Schema incompatibility"),
        })
      );
    });
  });

  // Logging is handled through the constructor logger parameter
});
