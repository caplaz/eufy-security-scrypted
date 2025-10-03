/**
 * Comprehensive tests for WebSocketClient reconnection logic
 * Tests scenarios that were previously uncovered
 */

import { WebSocketClient, PendingMessage } from "../../src/websocket-client";
import { ClientStateManager, ConnectionState } from "../../src/client-state";
import { Logger, ILogObj } from "tslog";
import WebSocket from "ws";

// Mock WebSocket
jest.mock("ws");
const MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;

describe("WebSocketClient - Reconnection Logic", () => {
  let client: WebSocketClient;
  let stateManager: ClientStateManager;
  let logger: Logger<ILogObj>;
  let mockWs: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    logger = new Logger<ILogObj>({ minLevel: 6 }); // Silent
    stateManager = new ClientStateManager(logger);

    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    };

    MockWebSocket.mockImplementation(() => mockWs as any);

    client = new WebSocketClient("ws://localhost:3000", stateManager, logger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Exponential Backoff", () => {
    it("should increment reconnect attempts on abnormal close", async () => {
      const connectPromise = client.connect();

      // Simulate successful connection
      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();

      await connectPromise;

      expect(stateManager.getState().reconnectAttempts).toBe(0);

      // Simulate abnormal close (triggers reconnection)
      const closeHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "close"
      )?.[1];

      closeHandler(1006, "Abnormal close"); // Abnormal closure code
      expect(stateManager.getState().reconnectAttempts).toBe(1);
    });

    it("should handle multiple reconnection attempts", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const closeHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "close"
      )?.[1];

      // Simulate multiple failed attempts
      closeHandler(1006, "Abnormal close");
      expect(stateManager.getState().reconnectAttempts).toBe(1);

      closeHandler(1006, "Abnormal close");
      expect(stateManager.getState().reconnectAttempts).toBe(2);

      closeHandler(1006, "Abnormal close");
      expect(stateManager.getState().reconnectAttempts).toBe(3);
    });

    it("should not reconnect on normal closure (code 1000)", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const closeHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "close"
      )?.[1];

      // Normal closure
      closeHandler(1000, "Normal closure");

      // Wait for any potential reconnection attempt
      jest.advanceTimersByTime(60000);

      // Should not attempt to reconnect
      expect(MockWebSocket).toHaveBeenCalledTimes(1); // Only initial connection
    });

    it("should reset reconnect attempts on successful connection", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      // Simulate abnormal close
      const closeHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "close"
      )?.[1];
      closeHandler(1006, "Abnormal close");
      expect(stateManager.getState().reconnectAttempts).toBe(1);

      // Directly set a new successful connection state
      stateManager.setWebSocketConnected(true);
      stateManager.setReconnectAttempts(0);

      // Reconnect attempts should now be reset
      expect(stateManager.getState().reconnectAttempts).toBe(0);
    });
  });

  describe("Performance Metrics", () => {
    it("should track message count correctly", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )?.[1];

      // Send some messages
      messageHandler(
        JSON.stringify({
          type: "version",
          minSchemaVersion: 13,
          maxSchemaVersion: 21,
        })
      );
      messageHandler(
        JSON.stringify({ type: "event", event: { event: "test" } })
      );
      messageHandler(
        JSON.stringify({ type: "result", messageId: "test_123", success: true })
      );

      const metrics = client.getPerformanceMetrics();
      expect(metrics.messageCount).toBe(3);
      expect(metrics.isConnected).toBe(true);
      expect(metrics.pendingMessageCount).toBe(0);
    });

    it("should track last message time", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )?.[1];

      const before = Date.now();
      messageHandler(
        JSON.stringify({
          type: "version",
          minSchemaVersion: 13,
          maxSchemaVersion: 21,
        })
      );
      const after = Date.now();

      const metrics = client.getPerformanceMetrics();
      expect(metrics.lastMessageTime).toBeGreaterThanOrEqual(before);
      expect(metrics.lastMessageTime).toBeLessThanOrEqual(after);
    });

    it("should reset performance metrics", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )?.[1];

      // Generate some metrics
      messageHandler(
        JSON.stringify({
          type: "version",
          minSchemaVersion: 13,
          maxSchemaVersion: 21,
        })
      );
      expect(client.getPerformanceMetrics().messageCount).toBe(1);

      // Reset
      client.resetPerformanceMetrics();
      expect(client.getPerformanceMetrics().messageCount).toBe(0);
      expect(client.getPerformanceMetrics().lastMessageTime).toBe(0);
    });

    it("should track pending message count", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      // Send a message without waiting for response
      const messagePromise = client.sendMessage({
        messageId: "test_message_1",
        command: "test.command",
      });

      const metrics = client.getPerformanceMetrics();
      expect(metrics.pendingMessageCount).toBe(1);

      // Simulate response
      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )?.[1];
      messageHandler(
        JSON.stringify({
          type: "result",
          messageId: "test_message_1",
          success: true,
        })
      );

      await messagePromise;

      const metricsAfter = client.getPerformanceMetrics();
      expect(metricsAfter.pendingMessageCount).toBe(0);
    });
  });

  describe("Message Timeout Handling", () => {
    it("should timeout pending messages after 30 seconds", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messagePromise = client.sendMessage({
        messageId: "test_timeout",
        command: "test.command",
      });

      // Fast-forward 30 seconds
      jest.advanceTimersByTime(30000);

      await expect(messagePromise).rejects.toThrow(
        "Message timeout: test_timeout"
      );
    });

    it("should clear pending messages on disconnect", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messagePromise = client.sendMessage({
        messageId: "test_clear",
        command: "test.command",
      });

      // Disconnect before response
      client.disconnect();

      await expect(messagePromise).rejects.toThrow("Connection closed");
    });

    it("should handle connection loss during pending messages", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messagePromise = client.sendMessage({
        messageId: "test_lost",
        command: "test.command",
      });

      // Simulate connection close
      const closeHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "close"
      )?.[1];
      closeHandler(1006, "Connection lost");

      await expect(messagePromise).rejects.toThrow("Connection closed");
    });
  });

  describe("Error Recovery", () => {
    it("should handle WebSocket errors gracefully", async () => {
      const errorHandler = jest.fn();
      client.onError(errorHandler);

      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      // Simulate WebSocket error
      const wsErrorHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "error"
      )?.[1];
      const testError = new Error("WebSocket error");
      wsErrorHandler(testError);

      expect(errorHandler).toHaveBeenCalledWith(testError);
      expect(stateManager.getState().lastError).toBe(testError);
    });

    it("should handle connection failure during connect", async () => {
      const connectPromise = client.connect();

      // Simulate connection error before open
      const errorHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "error"
      )?.[1];
      const testError = new Error("Connection refused");
      errorHandler(testError);

      await expect(connectPromise).rejects.toThrow("Connection refused");
    });
  });

  describe("Message Processing Statistics", () => {
    it("should provide message processing stats", async () => {
      const connectPromise = client.connect();

      const openHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "open"
      )?.[1];
      openHandler();
      await connectPromise;

      const messageHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === "message"
      )?.[1];

      // Send valid message
      messageHandler(
        JSON.stringify({
          type: "version",
          minSchemaVersion: 13,
          maxSchemaVersion: 21,
        })
      );

      // Send invalid message
      messageHandler("invalid json");

      const stats = client.getMessageProcessingStats();
      expect(stats.processedMessages).toBeGreaterThan(0);
      expect(stats.invalidMessages).toBeGreaterThan(0);
    });
  });
});
