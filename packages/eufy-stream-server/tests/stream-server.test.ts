/**
 * Tests for StreamServer
 */

import * as net from "net";
import { StreamServer } from "../src/stream-server";
import { createTestLogger, createTestH264Data, wait } from "./test-utils";

describe("StreamServer", () => {
  let server: StreamServer;
  let testPort: number;

  beforeEach(() => {
    // Use random port for testing to avoid conflicts
    testPort = 9000 + Math.floor(Math.random() * 1000);
    server = new StreamServer({
      port: testPort,
      host: "127.0.0.1",
      debug: false,
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
});
