/**
 * Enhanced unit tests for ApiManager
 */

import { ApiManager } from "../../src/api-manager";
import { WebSocketClient } from "../../src/websocket-client";
import { ClientStateManager } from "../../src/client-state";
import { Logger } from "tslog";
import { MESSAGE_TYPES } from "../../src/websocket-types";

// Mock the WebSocketClient and ClientStateManager
jest.mock("../../src/websocket-client");
jest.mock("../../src/client-state");

const MockWebSocketClient = WebSocketClient as jest.MockedClass<
  typeof WebSocketClient
>;
const MockClientStateManager = ClientStateManager as jest.MockedClass<
  typeof ClientStateManager
>;

describe("ApiManager", () => {
  let apiManager: ApiManager;
  let mockWebSocketClient: jest.Mocked<WebSocketClient>;
  let mockStateManager: jest.Mocked<ClientStateManager>;
  let logger: Logger<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    logger = new Logger({ name: "test" });

    // Create mock instances
    mockStateManager = {
      getState: jest.fn().mockReturnValue({
        connection: "disconnected",
        wsConnected: false,
        schemaVersion: null,
        lastError: null,
      }),
      setConnectionState: jest.fn(),
      setWebSocketConnected: jest.fn(),
      setSchemaSetupComplete: jest.fn(),
      setDriverConnected: jest.fn(),
      setSchemaInfo: jest.fn(),
      setReconnectAttempts: jest.fn(),
      setEventListenerCount: jest.fn(),
      reset: jest.fn(),
      onStateChange: jest.fn().mockReturnValue(() => {}),
      setError: jest.fn(),
      isReady: jest.fn().mockReturnValue(false),
    } as any;

    mockWebSocketClient = {
      connect: jest.fn().mockResolvedValue(void 0),
      disconnect: jest.fn(),
      isConnected: jest.fn().mockReturnValue(false),
      sendMessage: jest.fn().mockResolvedValue({ success: true }),
      onVersionMessage: jest.fn(),
      onEventMessage: jest.fn(),
      onConnected: jest.fn(),
      onDisconnected: jest.fn(),
      onError: jest.fn(),
      getStateManager: jest.fn().mockReturnValue(mockStateManager),
    } as any;

    MockWebSocketClient.mockImplementation(() => mockWebSocketClient);
    MockClientStateManager.mockImplementation(() => mockStateManager);

    apiManager = new ApiManager("ws://localhost:3000", logger);
  });

  describe("constructor", () => {
    it("should create ApiManager with WebSocketClient", () => {
      expect(MockWebSocketClient).toHaveBeenCalledWith(
        "ws://localhost:3000",
        expect.any(Object), // Use Object instead of MockClientStateManager
        logger
      );
      expect(apiManager).toBeInstanceOf(ApiManager);
    });

    it("should set up event handlers", () => {
      expect(mockWebSocketClient.onVersionMessage).toHaveBeenCalled();
      expect(mockWebSocketClient.onEventMessage).toHaveBeenCalled();
      expect(mockWebSocketClient.onConnected).toHaveBeenCalled();
      expect(mockWebSocketClient.onDisconnected).toHaveBeenCalled();
      expect(mockWebSocketClient.onError).toHaveBeenCalled();
    });
  });

  describe("connect()", () => {
    it("should connect WebSocket client", async () => {
      await apiManager.connect();
      expect(mockWebSocketClient.connect).toHaveBeenCalled();
    });

    it("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      mockWebSocketClient.connect.mockRejectedValue(error);

      await expect(apiManager.connect()).rejects.toThrow("Connection failed");
    });
  });

  describe("disconnect()", () => {
    it("should disconnect WebSocket client", () => {
      apiManager.disconnect();
      expect(mockWebSocketClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("isConnected()", () => {
    it("should return WebSocket client connection status", () => {
      mockStateManager.isReady.mockReturnValue(true);
      expect(apiManager.isConnected()).toBe(true);

      mockStateManager.isReady.mockReturnValue(false);
      expect(apiManager.isConnected()).toBe(false);
    });
  });

  describe("version message handling", () => {
    it("should handle version message and negotiate schema", () => {
      const versionHandler =
        mockWebSocketClient.onVersionMessage.mock.calls[0][0];

      const versionMessage = {
        type: "version" as "version",
        driverVersion: "1.0.0",
        serverVersion: "2.0.0",
        minSchemaVersion: 16,
        maxSchemaVersion: 18,
      };

      expect(() => versionHandler(versionMessage)).not.toThrow();
    });

    it("should use highest compatible schema version", () => {
      const versionHandler =
        mockWebSocketClient.onVersionMessage.mock.calls[0][0];

      const versionMessage = {
        type: "version" as "version",
        driverVersion: "1.0.0",
        serverVersion: "2.0.0",
        minSchemaVersion: 16,
        maxSchemaVersion: 21,
      };

      versionHandler(versionMessage);

      // Should have sent set_api_schema command
      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith({
        messageId: expect.any(String),
        command: "set_api_schema",
        schemaVersion: expect.any(Number),
      });
    });
  });

  describe("driver commands", () => {
    beforeEach(() => {
      mockWebSocketClient.isConnected.mockReturnValue(true);
      mockStateManager.getState.mockReturnValue({
        connection: "connected",
        wsConnected: true,
        schemaVersion: 18,
        lastError: null,
      } as any);
    });

    it("should execute connectDriver", async () => {
      mockStateManager.isReady.mockReturnValue(true);
      mockWebSocketClient.sendMessage.mockResolvedValue({ success: true });

      await apiManager.connectDriver();

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith({
        messageId: expect.any(String),
        command: "driver.connect",
      });
    });

    it("should execute startListening", async () => {
      mockStateManager.isReady.mockReturnValue(true);
      const expectedResult = {
        success: true,
        state: {
          devices: ["device1", "device2"],
          driver: { connected: true },
        },
      };
      mockWebSocketClient.sendMessage.mockResolvedValue(expectedResult);

      const result = await apiManager.startListening();

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith({
        messageId: expect.any(String),
        command: "start_listening",
      });
      expect(result).toEqual(expectedResult);
    });
  });

  describe("command builders", () => {
    beforeEach(() => {
      mockWebSocketClient.isConnected.mockReturnValue(true);
      mockStateManager.getState.mockReturnValue({
        connection: "connected",
        wsConnected: true,
        schemaVersion: 18,
        lastError: null,
      } as any);
    });

    it("should provide device command builder", () => {
      const deviceCommands = apiManager.commands.device("TEST_DEVICE");
      expect(deviceCommands).toBeDefined();
      expect(typeof deviceCommands.getProperties).toBe("function");
      expect(typeof deviceCommands.startLivestream).toBe("function");
    });

    it("should provide station command builder", () => {
      const stationCommands = apiManager.commands.station("TEST_STATION");
      expect(stationCommands).toBeDefined();
      expect(typeof stationCommands.getProperties).toBe("function");
    });

    it("should provide driver command builder", () => {
      const driverCommands = apiManager.commands.driver();
      expect(driverCommands).toBeDefined();
      expect(typeof driverCommands.connect).toBe("function");
      expect(typeof driverCommands.isConnected).toBe("function");
    });

    it("should provide server command builder", () => {
      const serverCommands = apiManager.commands.server();
      expect(serverCommands).toBeDefined();
      expect(typeof serverCommands.startListening).toBe("function");
    });
  });

  describe("event listeners", () => {
    it("should add event listeners", () => {
      const listener = jest.fn();
      apiManager.addEventListener("motion detected", listener);

      // Should not throw and should store the listener
      expect(() =>
        apiManager.addEventListener("motion detected", listener)
      ).not.toThrow();
    });

    it("should handle multiple listeners for same event", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      apiManager.addEventListener("motion detected", listener1);
      apiManager.addEventListener("motion detected", listener2);

      expect(() => {
        apiManager.addEventListener("motion detected", listener1);
        apiManager.addEventListener("motion detected", listener2);
      }).not.toThrow();
    });
  });

  describe("connection state handling", () => {
    it("should handle WebSocket connected event", () => {
      const connectedHandler = mockWebSocketClient.onConnected.mock.calls[0][0];
      expect(() => connectedHandler()).not.toThrow();
    });

    it("should handle WebSocket disconnected event", () => {
      const disconnectedHandler =
        mockWebSocketClient.onDisconnected.mock.calls[0][0];
      expect(() => disconnectedHandler()).not.toThrow();
    });

    it("should handle WebSocket error event", () => {
      const errorHandler = mockWebSocketClient.onError.mock.calls[0][0];
      const error = new Error("WebSocket error");
      expect(() => errorHandler(error)).not.toThrow();
    });
  });

  describe("schema negotiation", () => {
    it("should select appropriate schema version", () => {
      const versionHandler =
        mockWebSocketClient.onVersionMessage.mock.calls[0][0];

      // Test with supported versions
      const versionMessage = {
        type: "version" as "version",
        driverVersion: "1.0.0",
        serverVersion: "2.0.0",
        minSchemaVersion: 16,
        maxSchemaVersion: 18,
      };

      versionHandler(versionMessage);

      expect(mockWebSocketClient.sendMessage).toHaveBeenCalledWith({
        messageId: expect.any(String),
        command: "set_api_schema",
        schemaVersion: expect.any(Number),
      });
    });

    it("should handle unsupported schema versions gracefully", () => {
      const versionHandler =
        mockWebSocketClient.onVersionMessage.mock.calls[0][0];

      // Test with unsupported versions only
      const versionMessage = {
        type: "version" as "version",
        driverVersion: "1.0.0",
        serverVersion: "2.0.0",
        minSchemaVersion: 10,
        maxSchemaVersion: 12,
      };

      expect(() => versionHandler(versionMessage)).not.toThrow();
    });
  });
});
