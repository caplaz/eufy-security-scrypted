/**
 * Tests for StreamServer
 */

import * as net from "net";
import { StreamServer } from "../src/stream-server";
import { createTestLogger, createTestH264Data, wait } from "./test-utils";

// Mock the eufy-security-client
jest.mock("@caplaz/eufy-security-client", () => ({
  DEVICE_EVENTS: {
    LIVESTREAM_VIDEO_DATA: "livestream video data",
  },
}));

describe("StreamServer", () => {
  let server: StreamServer;
  let testPort: number;
  let mockWsClient: any;

  beforeEach(() => {
    // Use random port for testing to avoid conflicts
    testPort = 9000 + Math.floor(Math.random() * 1000);

    // Create mock WebSocket client
    mockWsClient = {
      addEventListener: jest.fn().mockReturnValue(() => {}),
      commands: {
        device: jest.fn().mockReturnValue({
          startLivestream: jest.fn().mockResolvedValue({}),
          stopLivestream: jest.fn().mockResolvedValue({}),
        }),
      },
    };

    server = new StreamServer({
      port: testPort,
      host: "127.0.0.1",
      debug: false,
      wsClient: mockWsClient,
      serialNumber: "TEST_DEVICE_123",
    });
  });

  afterEach(async () => {
    if (server.isRunning()) {
      await server.stop();
    }
  });

  describe("server lifecycle", () => {
    it("should start and stop successfully", async () => {
      expect(server.isRunning()).toBe(false);

      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it("should emit started and stopped events", async () => {
      const startedSpy = jest.fn();
      const stoppedSpy = jest.fn();

      server.on("started", startedSpy);
      server.on("stopped", stoppedSpy);

      await server.start();
      expect(startedSpy).toHaveBeenCalledTimes(1);

      await server.stop();
      expect(stoppedSpy).toHaveBeenCalledTimes(1);
    });

    it("should reject starting when already running", async () => {
      await server.start();

      await expect(server.start()).rejects.toThrow("Server is already running");
    });
  });

  describe("client connections", () => {
    it("should handle client connections", async () => {
      await server.start();

      const clientConnectedSpy = jest.fn();
      const clientDisconnectedSpy = jest.fn();

      server.on("clientConnected", clientConnectedSpy);
      server.on("clientDisconnected", clientDisconnectedSpy);

      // Create test client
      const client = new net.Socket();

      await new Promise<void>((resolve) => {
        client.connect(testPort, "127.0.0.1", () => {
          resolve();
        });
      });

      // Wait for connection event
      await wait(50);
      expect(clientConnectedSpy).toHaveBeenCalledTimes(1);
      expect(server.getActiveConnectionCount()).toBe(1);

      // Close client
      client.destroy();

      // Wait for disconnection event
      await wait(50);
      expect(clientDisconnectedSpy).toHaveBeenCalledTimes(1);
      expect(server.getActiveConnectionCount()).toBe(0);
    });
  });

  describe("video streaming", () => {
    it("should stream video data to connected clients", async () => {
      await server.start();

      // Create test client
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data);
      });

      await new Promise<void>((resolve) => {
        client.connect(testPort, "127.0.0.1", () => {
          resolve();
        });
      });

      // Wait for connection
      await wait(50);

      // Stream video data
      const testData = createTestH264Data();
      const success = await server.streamVideo(testData, Date.now(), true);

      expect(success).toBe(true);

      // Wait for data to be received
      await wait(50);

      expect(receivedData).toHaveLength(1);
      expect(receivedData[0]).toEqual(testData);

      client.destroy();
    });

    it("should reject invalid video data", async () => {
      await server.start();

      const invalidData = Buffer.from([0xff, 0xff, 0xff, 0xff]);
      const success = await server.streamVideo(invalidData);

      expect(success).toBe(false);
    });

    it("should handle streaming when no clients connected", async () => {
      await server.start();

      const testData = createTestH264Data();
      const success = await server.streamVideo(testData);

      expect(success).toBe(true); // Should succeed even with no clients
    });

    it("should reject streaming when server not active", async () => {
      const testData = createTestH264Data();
      const success = await server.streamVideo(testData);

      expect(success).toBe(false);
    });
  });

  describe("statistics", () => {
    it("should provide server statistics", async () => {
      await server.start();

      // Wait a small amount of time for uptime calculation
      await wait(10);

      const stats = server.getStats();

      expect(stats.isActive).toBe(true);
      expect(stats.port).toBe(testPort);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
      expect(stats.connections.active).toBe(0);
      expect(stats.streaming.framesProcessed).toBe(0);
    });

    it("should update statistics after streaming", async () => {
      await server.start();

      const testData = createTestH264Data();
      await server.streamVideo(testData);

      const stats = server.getStats();

      expect(stats.streaming.framesProcessed).toBe(1);
      expect(stats.streaming.bytesTransferred).toBe(testData.length);
      expect(stats.streaming.lastFrameTime).not.toBeNull();
    });

    it("should reset statistics", async () => {
      await server.start();

      const testData = createTestH264Data();
      await server.streamVideo(testData);

      server.resetStats();

      const stats = server.getStats();
      expect(stats.streaming.framesProcessed).toBe(0);
      expect(stats.streaming.bytesTransferred).toBe(0);
      expect(stats.streaming.lastFrameTime).toBeNull();
    });
  });

  describe("WebSocket integration", () => {
    it("should setup WebSocket listener when wsClient and serialNumber provided", () => {
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream: jest.fn().mockResolvedValue({}),
            stopLivestream: jest.fn().mockResolvedValue({}),
          }),
        },
      };

      const serverWithWs = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        debug: true,
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      expect(mockWsClient.addEventListener).toHaveBeenCalledWith(
        "livestream video data",
        expect.any(Function),
        {
          source: "device",
          serialNumber: "TEST123",
        }
      );
    });

    it("should handle video data events from WebSocket", async () => {
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream: jest.fn().mockResolvedValue({}),
            stopLivestream: jest.fn().mockResolvedValue({}),
          }),
        },
      };

      const serverWithWs = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        debug: true,
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Create test client
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data);
      });

      await new Promise<void>((resolve) => {
        client.connect(testPort, "127.0.0.1", () => {
          resolve();
        });
      });

      // Wait for connection
      await wait(50);

      // Get the event handler that was registered
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      // Simulate receiving video data event
      const testH264Data = createTestH264Data();
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: testH264Data },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      // Wait for data to be processed and received
      await wait(50);

      expect(receivedData).toHaveLength(1);
      expect(receivedData[0]).toEqual(testH264Data);

      client.destroy();
      await serverWithWs.stop();
    });

    it("should filter events by serial number", async () => {
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream: jest.fn().mockResolvedValue({}),
            stopLivestream: jest.fn().mockResolvedValue({}),
          }),
        },
      };

      const serverWithWs = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        debug: true,
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Create test client
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data);
      });

      await new Promise<void>((resolve) => {
        client.connect(testPort, "127.0.0.1", () => {
          resolve();
        });
      });

      // Wait for connection
      await wait(50);

      // Get the event handler that was registered
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      // Simulate receiving video data event for different serial number
      const testH264Data = createTestH264Data();
      eventHandler({
        serialNumber: "OTHER456", // Different serial number
        buffer: { data: testH264Data },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      // Wait a bit
      await wait(50);

      // Should not have received any data since serial numbers don't match
      expect(receivedData).toHaveLength(0);

      client.destroy();
      await serverWithWs.stop();
    });

    it("should cleanup WebSocket event listener on stop", async () => {
      const mockEventRemover = jest.fn();
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(mockEventRemover),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream: jest.fn().mockResolvedValue({}),
            stopLivestream: jest.fn().mockResolvedValue({}),
          }),
        },
      };

      const serverWithWs = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        debug: true,
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();
      await serverWithWs.stop();

      expect(mockEventRemover).toHaveBeenCalledTimes(1);
    });
  });
});
