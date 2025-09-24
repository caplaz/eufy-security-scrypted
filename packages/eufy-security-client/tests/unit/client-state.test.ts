/**
 * Unit tests for ClientStateManager
 * Tests the centralized state management functionality
 */

import { ClientStateManager, ConnectionState } from "../../src/client-state";
import { SchemaCompatibilityInfo } from "../../src/types/schema";
import { Logger, ILogObj } from "tslog";

describe("ClientStateManager", () => {
  let stateManager: ClientStateManager;

  beforeEach(() => {
    const logger = new Logger<ILogObj>();
    stateManager = new ClientStateManager(logger);
  });

  describe("initialization", () => {
    test("should initialize with disconnected state", () => {
      const state = stateManager.getState();
      expect(state.connection).toBe(ConnectionState.DISCONNECTED);
      expect(state.wsConnected).toBe(false);
      expect(state.driverConnected).toBe(false);
      expect(state.schemaSetupComplete).toBe(false);
      expect(stateManager.isReady()).toBe(false);
    });

    test("should have null schema info initially", () => {
      const state = stateManager.getState();
      expect(state.schemaInfo).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.reconnectAttempts).toBe(0);
      expect(state.eventListenerCount).toBe(0);
    });
  });

  describe("connection state management", () => {
    test("should update connection state correctly", () => {
      const callback = jest.fn();
      stateManager.onStateChange(callback);

      stateManager.setConnectionState(ConnectionState.CONNECTING);
      expect(stateManager.getState().connection).toBe(
        ConnectionState.CONNECTING
      );
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: ConnectionState.CONNECTING,
        })
      );

      stateManager.setConnectionState(ConnectionState.CONNECTED);
      expect(stateManager.getState().connection).toBe(
        ConnectionState.CONNECTED
      );
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: ConnectionState.CONNECTED,
        })
      );
    });

    test("should handle WebSocket connection state with cascading effects", () => {
      // First set connected
      stateManager.setWebSocketConnected(true);
      expect(stateManager.getState().wsConnected).toBe(true);

      // Set schema complete and verify it transitions to READY
      stateManager.setSchemaSetupComplete(true);
      expect(stateManager.getState().connection).toBe(ConnectionState.READY);
      expect(stateManager.isReady()).toBe(true);

      // Disconnect should reset dependent states
      stateManager.setWebSocketConnected(false);
      const state = stateManager.getState();
      expect(state.wsConnected).toBe(false);
      expect(state.schemaSetupComplete).toBe(false);
      expect(state.driverConnected).toBe(false);
      expect(state.connection).toBe(ConnectionState.DISCONNECTED);
      expect(stateManager.isReady()).toBe(false);
    });

    test("should handle driver connection state", () => {
      stateManager.setDriverConnected(true);
      expect(stateManager.getState().driverConnected).toBe(true);

      stateManager.setDriverConnected(false);
      expect(stateManager.getState().driverConnected).toBe(false);
    });

    test("should handle schema setup completion", () => {
      // Schema completion without WebSocket connection
      stateManager.setSchemaSetupComplete(true);
      expect(stateManager.getState().schemaSetupComplete).toBe(true);
      expect(stateManager.getState().connection).not.toBe(
        ConnectionState.READY
      );

      // Reset schema setup to false first
      stateManager.setSchemaSetupComplete(false);
      expect(stateManager.getState().schemaSetupComplete).toBe(false);

      // Set WebSocket connected
      stateManager.setWebSocketConnected(true);
      expect(stateManager.getState().wsConnected).toBe(true);
      expect(stateManager.getState().connection).toBe(
        ConnectionState.DISCONNECTED
      );

      // Completing schema setup with WebSocket connected should transition to READY
      stateManager.setSchemaSetupComplete(true);
      expect(stateManager.getState().connection).toBe(ConnectionState.READY);
      expect(stateManager.isReady()).toBe(true);
    });
  });

  describe("schema management", () => {
    test("should update schema info", () => {
      const schemaInfo: SchemaCompatibilityInfo = {
        clientMinSchema: 13,
        clientPreferredSchema: 21,
        serverMinSchema: 16,
        serverMaxSchema: 20,
        negotiatedSchema: 20,
        isCompatible: true,
      };

      stateManager.setSchemaInfo(schemaInfo);
      expect(stateManager.getState().schemaInfo).toEqual(schemaInfo);
    });

    test("should clear schema info", () => {
      const schemaInfo: SchemaCompatibilityInfo = {
        clientMinSchema: 13,
        clientPreferredSchema: 21,
        serverMinSchema: 16,
        serverMaxSchema: 20,
        negotiatedSchema: 20,
        isCompatible: true,
      };

      stateManager.setSchemaInfo(schemaInfo);
      expect(stateManager.getState().schemaInfo).toEqual(schemaInfo);

      stateManager.setSchemaInfo(null);
      expect(stateManager.getState().schemaInfo).toBeNull();
    });
  });

  describe("error handling", () => {
    test("should handle error state", () => {
      const callback = jest.fn();
      stateManager.onStateChange(callback);

      const error = new Error("Test error");
      stateManager.setError(error);

      const state = stateManager.getState();
      expect(state.lastError).toBe(error);
      expect(state.connection).toBe(ConnectionState.ERROR);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          lastError: error,
          connection: ConnectionState.ERROR,
        })
      );
    });

    test("should clear error state", () => {
      const error = new Error("Test error");
      stateManager.setError(error);
      expect(stateManager.getState().lastError).toBe(error);

      stateManager.setError(null);
      expect(stateManager.getState().lastError).toBeNull();
    });
  });

  describe("reconnection attempts", () => {
    test("should track reconnection attempts", () => {
      stateManager.setReconnectAttempts(3);
      expect(stateManager.getState().reconnectAttempts).toBe(3);

      stateManager.setReconnectAttempts(0);
      expect(stateManager.getState().reconnectAttempts).toBe(0);
    });
  });

  describe("event listener count", () => {
    test("should track event listener count", () => {
      stateManager.setEventListenerCount(5);
      expect(stateManager.getState().eventListenerCount).toBe(5);

      stateManager.setEventListenerCount(0);
      expect(stateManager.getState().eventListenerCount).toBe(0);
    });
  });

  describe("state change callbacks", () => {
    test("should register and call state change callbacks", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const unsubscribe1 = stateManager.onStateChange(callback1);
      const unsubscribe2 = stateManager.onStateChange(callback2);

      stateManager.setConnectionState(ConnectionState.CONNECTED);

      expect(callback1).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: ConnectionState.CONNECTED,
        })
      );
      expect(callback2).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: ConnectionState.CONNECTED,
        })
      );

      // Test unsubscribe
      unsubscribe1();
      stateManager.setConnectionState(ConnectionState.DISCONNECTED);

      expect(callback1).toHaveBeenCalledTimes(1); // Not called again
      expect(callback2).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: ConnectionState.DISCONNECTED,
        })
      );

      unsubscribe2();
    });

    test("should handle multiple state changes", () => {
      const callback = jest.fn();
      stateManager.onStateChange(callback);

      const states = [
        ConnectionState.CONNECTING,
        ConnectionState.CONNECTED,
        ConnectionState.DISCONNECTED,
        ConnectionState.ERROR,
      ];

      states.forEach((state) => {
        stateManager.setConnectionState(state);
      });

      expect(callback).toHaveBeenCalledTimes(states.length);
      states.forEach((state, index) => {
        expect(callback).toHaveBeenNthCalledWith(
          index + 1,
          expect.objectContaining({
            connection: state,
          })
        );
      });
    });

    test("should handle callback errors gracefully", () => {
      const badCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      stateManager.onStateChange(badCallback);
      stateManager.onStateChange(goodCallback);

      // Should not throw despite bad callback
      expect(() => {
        stateManager.setConnectionState(ConnectionState.CONNECTED);
      }).not.toThrow();

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  describe("state reset", () => {
    test("should reset state to initial values while preserving listener count", () => {
      // Set up state
      stateManager.setConnectionState(ConnectionState.CONNECTED);
      stateManager.setWebSocketConnected(true);
      stateManager.setDriverConnected(true);
      stateManager.setSchemaSetupComplete(true);
      stateManager.setReconnectAttempts(3);
      stateManager.setEventListenerCount(5);
      stateManager.setError(new Error("Test"));

      // Reset
      stateManager.reset();

      const state = stateManager.getState();
      expect(state.connection).toBe(ConnectionState.DISCONNECTED);
      expect(state.wsConnected).toBe(false);
      expect(state.schemaSetupComplete).toBe(false);
      expect(state.driverConnected).toBe(false);
      expect(state.schemaInfo).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.reconnectAttempts).toBe(0);
      expect(state.eventListenerCount).toBe(5); // Preserved
    });
  });

  describe("ready state validation", () => {
    test("should be ready only when all conditions are met", () => {
      expect(stateManager.isReady()).toBe(false);

      // Set WebSocket connected
      stateManager.setWebSocketConnected(true);
      expect(stateManager.isReady()).toBe(false);

      // Set schema complete (should also set connection to READY)
      stateManager.setSchemaSetupComplete(true);
      expect(stateManager.isReady()).toBe(true);

      // Disconnect WebSocket should make not ready
      stateManager.setWebSocketConnected(false);
      expect(stateManager.isReady()).toBe(false);
    });
  });

  describe("state immutability", () => {
    test("should return immutable state copies", () => {
      const state1 = stateManager.getState();
      const state2 = stateManager.getState();

      expect(state1).not.toBe(state2); // Different objects
      expect(state1).toEqual(state2); // Same content

      // Modifying returned state should not affect internal state
      (state1 as any).connection = ConnectionState.CONNECTED;
      expect(stateManager.getState().connection).toBe(
        ConnectionState.DISCONNECTED
      );
    });
  });
});
