/**
 * Tests for StreamServer
 */

import * as net from "net";
import { Duplex } from "stream";
import { StreamServer } from "../src/stream-server";
import {
  createTestLogger,
  createTestH264Data,
  createTestHevcData,
  createTestHevcVpsData,
  createTestHevcSpsData,
  createTestHevcPpsData,
  createTestHevcPFrameData,
  wait,
} from "./test-utils";
import { S330_HEVC } from "./fixtures/s330-hevc-nal-units";

/**
 * A keyframe access unit whose bytes match its codec: parameter sets + IRAP.
 * The stream server identifies the codec from these bytes, so a frame
 * labelled H265 must actually carry H.265 parameter sets.
 */
const keyframeAccessUnit = (codec: string): Buffer => {
  const sc = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  const nals =
    codec.toUpperCase() === "H265" || codec.toUpperCase() === "HEVC"
      ? [S330_HEVC.vps, S330_HEVC.sps, S330_HEVC.pps, S330_HEVC.idrSlice]
      : [
          Buffer.from([0x67, 0x42, 0x00, 0x1e]), // SPS, Baseline
          Buffer.from([0x68, 0xce, 0x3c, 0x80]), // PPS
          Buffer.from([0x65, 0x88, 0x84, 0x00]), // IDR slice
        ];
  return Buffer.concat(nals.flatMap((nal) => [sc, nal]));
};

// Mock the eufy-security-client
jest.mock("@caplaz/eufy-security-client", () => ({
  DEVICE_EVENTS: {
    LIVESTREAM_VIDEO_DATA: "livestream video data",
    LIVESTREAM_AUDIO_DATA: "livestream audio data",
  },
}));

jest.mock("jmuxer", () => {
  const { Duplex } = require("stream");
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      feed: jest.fn(),
      createStream: jest.fn(() => new Duplex({ read() {} })),
      destroy: jest.fn(),
    })),
  };
});

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

    it("reinstalls WebSocket listeners after a normal stop/start", async () => {
      const listeners: Array<{
        event: string;
        callback: (event: any) => void;
      }> = [];
      mockWsClient.addEventListener.mockImplementation(
        (event: string, callback: (payload: any) => void) => {
          const listener = { event, callback };
          listeners.push(listener);
          return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) listeners.splice(index, 1);
            return index !== -1;
          };
        },
      );

      const restarted = new StreamServer({
        port: testPort + 1,
        host: "127.0.0.1",
        wsClient: mockWsClient,
        serialNumber: "TEST_DEVICE_123",
      });
      await restarted.start();
      await restarted.stop();
      await restarted.start();

      const video = listeners.find(
        ({ event }) => event === "livestream video data",
      );
      const audio = listeners.find(
        ({ event }) => event === "livestream audio data",
      );
      video?.callback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "H264",
          videoFPS: 15,
          videoWidth: 1280,
          videoHeight: 720,
        },
      });
      audio?.callback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0x1f, 0xfc]) },
        metadata: { audioCodec: "AAC" },
      });

      expect(restarted.getVideoMetadata()?.videoCodec).toBe("H264");
      expect(restarted.getAudioStatus()).toBe("aac");
      await restarted.stop();
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

    it("notifies one next-consumer callback once and supports unsubscribe", async () => {
      await server.start();
      const attached = jest.fn();
      const unsubscribe = server.onNextConsumerAttached(attached);

      const client = net.createConnection({
        port: testPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => client.on("connect", resolve));
      await wait(20);
      expect(attached).toHaveBeenCalledTimes(1);

      const ignored = jest.fn();
      const removeIgnored = server.onNextConsumerAttached(ignored);
      removeIgnored();
      const second = net.createConnection({
        port: testPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => second.on("connect", resolve));
      await wait(20);
      expect(ignored).not.toHaveBeenCalled();
      unsubscribe();
      client.destroy();
      second.destroy();
    });

    it("notifies once when a muxed client attaches while pending and not again on muxer activation", async () => {
      await server.start();
      const attached = jest.fn();
      server.onNextConsumerAttached(attached);

      const socket = net.createConnection({
        port: server.getMuxedPort()!,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      await wait(20);
      expect((server as any).pendingMuxerSockets.size).toBe(1);
      expect(attached).toHaveBeenCalledTimes(1);

      const videoCallback = mockWsClient.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream video data",
      )[1];
      (server as any).deliversAudio = true;
      videoCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "H264",
          videoFPS: 15,
          videoWidth: 1280,
          videoHeight: 720,
        },
      });
      await wait(20);
      expect((server as any).muxerStreams.size).toBe(1);
      expect(attached).toHaveBeenCalledTimes(1);
      socket.destroy();
    });
  });

  describe("video streaming", () => {
    it("should stream video data to connected clients", async () => {
      await server.start();

      // Create test client
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data as Buffer);
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

  describe("snapshot capture", () => {
    it("should capture snapshot from stream", async () => {
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Get the event handler that was registered
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      // Start snapshot capture in background
      const snapshotPromise = serverWithWs.captureSnapshot(5000);

      // Wait a bit for the snapshot request to be registered
      await wait(100);

      // Simulate receiving a keyframe event
      const testH264Keyframe = createTestH264Data();
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: testH264Keyframe },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      // Wait for snapshot to resolve
      const snapshot = await snapshotPromise;

      expect(snapshot).toEqual(testH264Keyframe);
      expect(snapshot.length).toBeGreaterThan(0);

      await serverWithWs.stop();
    });

    it("should timeout if no keyframe received", async () => {
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Try to capture snapshot with short timeout and no keyframe
      await expect(serverWithWs.captureSnapshot(100)).rejects.toThrow(
        /Snapshot capture timed out/,
      );

      await serverWithWs.stop();
    });

    it("should handle multiple simultaneous snapshot requests", async () => {
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Get the event handler that was registered
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      // Start multiple snapshot captures
      const snapshot1Promise = serverWithWs.captureSnapshot(5000);
      const snapshot2Promise = serverWithWs.captureSnapshot(5000);

      // Wait a bit for the snapshot requests to be registered
      await wait(100);

      // Simulate receiving a keyframe event
      const testH264Keyframe = createTestH264Data();
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: testH264Keyframe },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      // Wait for both snapshots to resolve
      const [snapshot1, snapshot2] = await Promise.all([
        snapshot1Promise,
        snapshot2Promise,
      ]);

      expect(snapshot1).toEqual(testH264Keyframe);
      expect(snapshot2).toEqual(testH264Keyframe);

      await serverWithWs.stop();
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      expect(mockWsClient.addEventListener).toHaveBeenCalledWith(
        "livestream video data",
        expect.any(Function),
        {
          source: "device",
          serialNumber: "TEST123",
        },
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Create test client
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data as Buffer);
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Create test client
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data as Buffer);
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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();
      await serverWithWs.stop();

      // Two event listeners are registered: one for video data, one for audio data
      expect(mockEventRemover).toHaveBeenCalledTimes(2);
    });
  });

  describe("SPS/PPS header caching", () => {
    it("should cache SPS/PPS headers and send to new clients", async () => {
      const { createTestSPSData, createTestPPSData } = require("./test-utils");

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
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });

      await serverWithWs.start();

      // Get the WebSocket event handler
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      // Simulate receiving SPS header
      const spsData = createTestSPSData();
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: spsData },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      await wait(50);

      // Simulate receiving PPS header
      const ppsData = createTestPPSData();
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: ppsData },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      await wait(50);

      // Now connect a client - it should receive cached SPS/PPS headers
      const client = new net.Socket();
      const receivedData: Buffer[] = [];

      client.on("data", (data) => {
        receivedData.push(data as Buffer);
      });

      await new Promise<void>((resolve) => {
        client.connect(testPort, "127.0.0.1", () => {
          resolve();
        });
      });

      // Wait for headers to be sent
      await wait(100);

      // Client should have received at least one buffer
      expect(receivedData.length).toBeGreaterThanOrEqual(1);

      // Combine all received buffers for verification
      const combinedData = Buffer.concat(receivedData);

      // Verify we received SPS (contains NAL type 7)
      const hasSPS =
        combinedData.includes(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67])) ||
        combinedData.includes(Buffer.from([0x00, 0x00, 0x01, 0x67]));
      expect(hasSPS).toBe(true);

      // Verify we received PPS (contains NAL type 8)
      const hasPPS =
        combinedData.includes(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x68])) ||
        combinedData.includes(Buffer.from([0x00, 0x00, 0x01, 0x68]));
      expect(hasPPS).toBe(true);

      client.destroy();
      await serverWithWs.stop();
    });
  });

  describe("H.265 / HEVC support", () => {
    let serverWithWs: StreamServer;
    let eventHandler: (event: any) => void;

    const makeH265WsClient = () => ({
      addEventListener: jest.fn().mockReturnValue(() => {}),
      commands: {
        device: jest.fn().mockReturnValue({
          startLivestream: jest.fn().mockResolvedValue({}),
          stopLivestream: jest.fn().mockResolvedValue({}),
        }),
      },
    });

    const h265Metadata = {
      videoCodec: "H265",
      videoFPS: 30,
      videoWidth: 1920,
      videoHeight: 1080,
    };

    beforeEach(async () => {
      const wsClient = makeH265WsClient();
      serverWithWs = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: wsClient as any,
        serialNumber: "H265_DEVICE",
      });
      await serverWithWs.start();
      eventHandler = wsClient.addEventListener.mock.calls[0][1];
    });

    afterEach(async () => {
      if (serverWithWs.isRunning()) await serverWithWs.stop();
    });

    it("detects H.265 keyframe and resolves snapshot", async () => {
      const hevcData = createTestHevcData(); // VPS+SPS+PPS+IDR

      // Kick off snapshot; wait for its internal resolver to be registered
      const snapshotPromise = serverWithWs.captureSnapshot(3000);
      await wait(100);

      // Simulate first video data event with H.265 IDR access unit
      eventHandler({
        serialNumber: "H265_DEVICE",
        buffer: { data: hevcData },
        metadata: h265Metadata,
      });

      const snapshot = await snapshotPromise;
      expect(snapshot.length).toBeGreaterThan(0);
      expect(snapshot).toEqual(hevcData);
    });

    it("does NOT resolve snapshot on H.265 P-frame (TRAIL_R)", async () => {
      const pFrame = createTestHevcPFrameData();

      // Seed metadata first so the server knows it's H.265
      eventHandler({
        serialNumber: "H265_DEVICE",
        buffer: { data: createTestHevcData() },
        metadata: h265Metadata,
      });
      await wait(50);

      // Start snapshot; wait for resolver to register
      const snapshotPromise = serverWithWs.captureSnapshot(200);
      await wait(50);

      // P-frame must not resolve the snapshot
      eventHandler({
        serialNumber: "H265_DEVICE",
        buffer: { data: pFrame },
        metadata: h265Metadata,
      });

      await expect(snapshotPromise).rejects.toThrow(/timed out/i);
    });

    it("does NOT resolve snapshot on H.265 parameter sets without IRAP", async () => {
      // Seed metadata via a parameter-set-only event (codec still gets
      // detected from event.metadata).
      const psOnly = Buffer.concat([
        createTestHevcVpsData(),
        createTestHevcSpsData(),
        createTestHevcPpsData(),
      ]);

      // Begin snapshot capture
      const snapshotPromise = serverWithWs.captureSnapshot(200);
      await wait(50);

      // Deliver only VPS+SPS+PPS — no IRAP/IDR slice. FFmpeg can't decode
      // a JPEG from parameter sets alone, so the resolver must wait.
      eventHandler({
        serialNumber: "H265_DEVICE",
        buffer: { data: psOnly },
        metadata: h265Metadata,
      });

      await expect(snapshotPromise).rejects.toThrow(/timed out/i);
    });

    it("caches H.265 VPS, SPS and PPS and sends them to new clients", async () => {
      const vpsData = createTestHevcVpsData();
      const spsData = createTestHevcSpsData();
      const ppsData = createTestHevcPpsData();

      // Feed VPS, SPS, PPS buffers sequentially
      for (const buf of [vpsData, spsData, ppsData]) {
        eventHandler({
          serialNumber: "H265_DEVICE",
          buffer: { data: buf },
          metadata: h265Metadata,
        });
        await wait(20);
      }

      // Connect a fresh TCP client — it should receive the three cached parameter sets
      const client = new net.Socket();
      const receivedData: Buffer[] = [];
      client.on("data", (d) => receivedData.push(d as Buffer));

      await new Promise<void>((resolve) =>
        client.connect(testPort, "127.0.0.1", resolve),
      );
      await wait(100);

      const combined = Buffer.concat(receivedData);

      // VPS byte0 = 0x40 (type 32)
      const hasVPS =
        combined.includes(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x40])) ||
        combined.includes(Buffer.from([0x00, 0x00, 0x01, 0x40]));
      expect(hasVPS).toBe(true);

      // SPS byte0 = 0x42 (type 33)
      const hasSPS =
        combined.includes(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42])) ||
        combined.includes(Buffer.from([0x00, 0x00, 0x01, 0x42]));
      expect(hasSPS).toBe(true);

      // PPS byte0 = 0x44 (type 34)
      const hasPPS =
        combined.includes(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x44])) ||
        combined.includes(Buffer.from([0x00, 0x00, 0x01, 0x44]));
      expect(hasPPS).toBe(true);

      client.destroy();
    });

    it("exposes H.265 codec in getVideoMetadata() after first frame", async () => {
      expect(serverWithWs.getVideoMetadata()).toBeNull();

      eventHandler({
        serialNumber: "H265_DEVICE",
        buffer: { data: createTestHevcData() },
        metadata: h265Metadata,
      });
      await wait(20);

      expect(serverWithWs.getVideoMetadata()?.videoCodec).toBe("H265");
    });
  });

  describe("station stream slot gating (acquireStreamSlot)", () => {
    const makeWs = () => {
      const startLivestream = jest.fn().mockResolvedValue({});
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream,
            stopLivestream: jest.fn().mockResolvedValue({}),
            isLivestreaming: jest.fn().mockResolvedValue({
              livestreaming: false,
            }),
          }),
        },
      };
      return { mockWsClient, startLivestream };
    };

    it("does NOT start the livestream when a background request is denied", async () => {
      const { mockWsClient, startLivestream } = makeWs();
      const acquireStreamSlot = jest.fn().mockReturnValue(null); // slot busy
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();

      // captureSnapshot starts the stream at background priority (no consumers).
      await expect(s.captureSnapshot(150)).rejects.toThrow(/timed out/);

      expect(acquireStreamSlot).toHaveBeenCalledWith(
        "background",
        expect.any(Function),
      );
      expect(startLivestream).not.toHaveBeenCalled();
      await s.stop();
    });

    it("yields (slotRevoked, no wedge/recycle) when the slot is revoked", async () => {
      const { mockWsClient, startLivestream } = makeWs();
      let capturedRevoke: (() => void) | undefined;
      const lease = { release: jest.fn(), active: true };
      const acquireStreamSlot = jest.fn((_p: string, onRevoke: () => void) => {
        capturedRevoke = onRevoke;
        return lease;
      });
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot: acquireStreamSlot as any,
      });
      await s.start();
      const wedged = jest.fn();
      s.on("upstreamWedged", wedged);

      // Begin a capture so the server acquires the slot and starts.
      const snap = s.captureSnapshot(400).catch(() => {});
      await wait(80);
      expect(startLivestream).toHaveBeenCalled();
      expect(capturedRevoke).toBeDefined();

      // A higher-priority camera preempts us — assert the immediate contract.
      capturedRevoke!();
      await wait(30);

      expect((s as any).slotRevoked).toBe(true);
      // Yielding the slot is contention, NOT an upstream wedge — must not recycle.
      expect(wedged).not.toHaveBeenCalled();
      expect(lease.release).toHaveBeenCalled();
      await snap;
      await s.stop();
    });

    it("on revoke, stops the livestream BEFORE releasing the slot (clean staggered handoff)", async () => {
      const order: string[] = [];
      let started = false;
      const startLivestream = jest.fn().mockImplementation(async () => {
        started = true;
        return {};
      });
      const stopLivestream = jest.fn().mockImplementation(async () => {
        started = false;
        order.push("stop");
        return {};
      });
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream,
            stopLivestream,
            // Reflect reality: not streaming until start, streaming after.
            isLivestreaming: jest
              .fn()
              .mockImplementation(async () => ({ livestreaming: started })),
          }),
        },
      };
      let capturedRevoke: (() => void) | undefined;
      const lease = {
        release: jest.fn(() => order.push("release")),
        active: true,
      };
      const acquireStreamSlot = jest.fn((_p: string, onRevoke: () => void) => {
        capturedRevoke = onRevoke;
        return lease;
      });
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot: acquireStreamSlot as any,
      });
      await s.start();

      const snap = s.captureSnapshot(400).catch(() => {});
      await wait(80);
      expect(startLivestream).toHaveBeenCalled();
      expect(capturedRevoke).toBeDefined();

      // Preempted: must stop our P2P, THEN release — so the preemptor's
      // whenReady (gated on release) can't start it mid-teardown and starve
      // the one-stream HomeBase.
      capturedRevoke!();
      await wait(120);

      expect(order).toContain("stop");
      expect(order).toContain("release");
      expect(order.indexOf("stop")).toBeLessThan(order.indexOf("release"));
      expect(stopLivestream).toHaveBeenCalled();
      await snap;
      await s.stop();
    });

    it("starts the livestream when the slot is granted", async () => {
      const { mockWsClient, startLivestream } = makeWs();
      const lease = { release: jest.fn(), active: true };
      const acquireStreamSlot = jest.fn().mockReturnValue(lease);
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();

      await expect(s.captureSnapshot(150)).rejects.toThrow(/timed out/);

      expect(acquireStreamSlot).toHaveBeenCalled();
      expect(startLivestream).toHaveBeenCalled();
      await s.stop();
    });

    it("holds a background slot briefly, then stops upstream before releasing it", async () => {
      const order: string[] = [];
      let streaming = false;
      const deviceApi = {
        startLivestream: jest.fn().mockImplementation(async () => {
          streaming = true;
        }),
        stopLivestream: jest.fn().mockImplementation(async () => {
          streaming = false;
          order.push("stop");
        }),
        isLivestreaming: jest
          .fn()
          .mockImplementation(async () => ({ livestreaming: streaming })),
      };
      const wsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: { device: jest.fn().mockReturnValue(deviceApi) },
      };
      const lease = {
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(() => order.push("release")),
      };
      const acquireStreamSlot = jest.fn().mockReturnValue(lease);
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: wsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();

      s.holdWarmLease(30);
      await wait(20);
      expect(acquireStreamSlot).toHaveBeenCalledWith(
        "background",
        expect.any(Function),
      );
      expect(deviceApi.startLivestream).toHaveBeenCalled();

      await wait(60);
      expect(order).toEqual(["stop", "release"]);
      await s.stop();
    });

    it("stops and releases a live grant before a denied warm background retry", async () => {
      const order: string[] = [];
      let streaming = false;
      const deviceApi = {
        startLivestream: jest.fn().mockImplementation(async () => {
          streaming = true;
        }),
        stopLivestream: jest.fn().mockImplementation(async () => {
          streaming = false;
          order.push("stop");
        }),
        isLivestreaming: jest
          .fn()
          .mockImplementation(async () => ({ livestreaming: streaming })),
      };
      const wsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: { device: jest.fn().mockReturnValue(deviceApi) },
      };
      const liveLease = {
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(() => order.push("release")),
      };
      const acquireStreamSlot = jest
        .fn()
        .mockReturnValueOnce(liveLease)
        .mockImplementationOnce(() => {
          order.push("background-denied");
          return null;
        });
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: wsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();
      const bootstrap = s.acquireMetadataWaiter(5000);
      await wait(20);
      expect(acquireStreamSlot).toHaveBeenLastCalledWith(
        "live",
        expect.any(Function),
      );

      s.holdWarmLease(500);
      await wait(30);

      expect(order).toEqual(["stop", "release", "background-denied"]);
      expect((s as any).livestreamIntendedState).toBe(false);
      expect((s as any).streamLease).toBeNull();
      void bootstrap.promise.catch(() => {});
      bootstrap.release();
      await s.stop();
    });

    it("does not create a warm lease for a real consumer and ignores duplicate holds", async () => {
      const { mockWsClient } = makeWs();
      const acquireStreamSlot = jest.fn().mockReturnValue({
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(),
      });
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();
      const client = net.createConnection({
        port: testPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => client.on("connect", resolve));
      await wait(20);

      s.holdWarmLease(500);
      expect((s as any).warmLease).toBeUndefined();
      client.destroy();

      const isolated = new StreamServer({
        port: testPort + 1,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST124",
        acquireStreamSlot,
      });
      await isolated.start();
      isolated.holdWarmLease(500);
      isolated.holdWarmLease(500);
      await wait(20);
      expect((isolated as any).metadataBootstrapConsumers).toBe(1);
      await isolated.stop();
      await s.stop();
    });

    it("ends a warm lease on its first live frame", async () => {
      const { mockWsClient } = makeWs();
      let streaming = false;
      const deviceApi = mockWsClient.commands.device();
      deviceApi.startLivestream.mockImplementation(async () => {
        streaming = true;
      });
      deviceApi.stopLivestream.mockImplementation(async () => {
        streaming = false;
      });
      deviceApi.isLivestreaming = jest.fn(async () => ({
        livestreaming: streaming,
      }));
      const acquireStreamSlot = jest.fn().mockReturnValue({
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(),
      });
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();
      s.holdWarmLease(500);
      await wait(20);
      const videoCallback = mockWsClient.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream video data",
      )[1];
      videoCallback({
        serialNumber: "TEST123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "H264",
          videoFPS: 15,
          videoWidth: 1280,
          videoHeight: 720,
        },
      });
      await wait(20);
      expect((s as any).warmLease).toBeUndefined();
      expect(deviceApi.stopLivestream).toHaveBeenCalled();
      await s.stop();
    });

    it("ends a warm lease when a sibling preempts its background slot", async () => {
      const { mockWsClient } = makeWs();
      let revoke: (() => void) | undefined;
      let streaming = false;
      const deviceApi = mockWsClient.commands.device();
      deviceApi.startLivestream.mockImplementation(async () => {
        streaming = true;
      });
      deviceApi.stopLivestream.mockImplementation(async () => {
        streaming = false;
      });
      deviceApi.isLivestreaming = jest.fn(async () => ({
        livestreaming: streaming,
      }));
      const lease = {
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(),
      };
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot: jest.fn((_priority, onRevoke) => {
          revoke = onRevoke;
          return lease;
        }),
      });
      await s.start();
      s.holdWarmLease(500);
      await wait(20);
      revoke!();
      await wait(20);
      expect((s as any).warmLease).toBeUndefined();
      expect(deviceApi.stopLivestream).toHaveBeenCalled();
      expect(lease.release).toHaveBeenCalled();
      await s.stop();
    });

    it("replaces an expiring background warm slot with a live consumer lease", async () => {
      let streaming = false;
      const deviceApi = {
        startLivestream: jest.fn().mockImplementation(async () => {
          streaming = true;
        }),
        stopLivestream: jest.fn().mockImplementation(async () => {
          streaming = false;
        }),
        isLivestreaming: jest
          .fn()
          .mockImplementation(async () => ({ livestreaming: streaming })),
      };
      const wsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: { device: jest.fn().mockReturnValue(deviceApi) },
      };
      const backgroundLease = {
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(),
      };
      const liveLease = {
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(),
      };
      const acquireStreamSlot = jest
        .fn()
        .mockReturnValueOnce(backgroundLease)
        .mockReturnValueOnce(liveLease);
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: wsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();
      s.holdWarmLease(80);
      await wait(20);

      const client = net.createConnection({
        port: testPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => client.on("connect", resolve));
      await wait(20);
      expect(backgroundLease.release).toHaveBeenCalled();
      expect(acquireStreamSlot).toHaveBeenLastCalledWith(
        "live",
        expect.any(Function),
      );

      await wait(100);
      expect(liveLease.release).not.toHaveBeenCalled();
      client.destroy();
      await s.stop();
    });

    it("keeps a warm background consumer through wedge recycle and re-arms it", async () => {
      const { mockWsClient, startLivestream } = makeWs();
      const leases = [
        {
          active: true,
          whenReady: Promise.resolve(),
          markDelivering: jest.fn(),
          release: jest.fn(),
        },
        {
          active: true,
          whenReady: Promise.resolve(),
          markDelivering: jest.fn(),
          release: jest.fn(),
        },
      ];
      const acquireStreamSlot = jest
        .fn()
        .mockImplementation(() => leases.shift()!);
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();
      s.holdWarmLease(500);
      await wait(20);
      expect(acquireStreamSlot).toHaveBeenLastCalledWith(
        "background",
        expect.any(Function),
      );

      (s as any).markUpstreamWedged("cold-start-counter-maxed", {
        attempts: 1,
      });
      s.setRecycleInFlight(true);
      s.setRecycleInFlight(false);
      await wait(20);

      expect(acquireStreamSlot).toHaveBeenLastCalledWith(
        "background",
        expect.any(Function),
      );
      expect(startLivestream).toHaveBeenCalledTimes(2);
      await s.stop();
    });

    it("stops before releasing a wedged warm slot, then re-arms it after recycle", async () => {
      const order: string[] = [];
      let streaming = false;
      const deviceApi = {
        startLivestream: jest.fn().mockImplementation(async () => {
          streaming = true;
        }),
        stopLivestream: jest.fn().mockImplementation(async () => {
          streaming = false;
          order.push("stop");
        }),
        isLivestreaming: jest
          .fn()
          .mockImplementation(async () => ({ livestreaming: streaming })),
      };
      const wsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: { device: jest.fn().mockReturnValue(deviceApi) },
      };
      const leases = [
        {
          active: true,
          whenReady: Promise.resolve(),
          markDelivering: jest.fn(),
          release: jest.fn(() => order.push("release")),
        },
        {
          active: true,
          whenReady: Promise.resolve(),
          markDelivering: jest.fn(),
          release: jest.fn(),
        },
      ];
      const acquireStreamSlot = jest
        .fn()
        .mockImplementation(() => leases.shift()!);
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: wsClient as any,
        serialNumber: "TEST123",
        acquireStreamSlot,
      });
      await s.start();
      s.holdWarmLease(500);
      await wait(20);

      (s as any).markUpstreamWedged("cold-start-counter-maxed", {
        attempts: 1,
      });
      await wait(20);
      expect(order).toEqual(["stop", "release"]);

      s.setRecycleInFlight(true);
      s.setRecycleInFlight(false);
      await wait(20);
      expect(acquireStreamSlot).toHaveBeenLastCalledWith(
        "background",
        expect.any(Function),
      );
      expect(deviceApi.startLivestream).toHaveBeenCalledTimes(2);
      await s.stop();
    });
  });

  describe("keyframe cache (getCachedKeyframe)", () => {
    const makeServer = () => {
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream: jest.fn().mockResolvedValue({}),
            stopLivestream: jest.fn().mockResolvedValue({}),
          }),
        },
      };
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });
      return { s, mockWsClient };
    };

    it("returns null before any keyframe is seen", async () => {
      const { s } = makeServer();
      await s.start();
      expect(s.getCachedKeyframe(60000)).toBeNull();
      await s.stop();
    });

    it("caches a keyframe that flows through with no snapshot pending", async () => {
      const { s, mockWsClient } = makeServer();
      await s.start();
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      // No captureSnapshot() in flight — keyframe arrives because some other
      // consumer (live view, HKSV, motion recording) woke the camera.
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      const cached = s.getCachedKeyframe(60000);
      expect(cached).not.toBeNull();
      expect(cached!.codec).toBe("H264");
      expect(cached!.data.length).toBeGreaterThan(0);
      expect(cached!.ageMs).toBeGreaterThanOrEqual(0);
      await s.stop();
    });

    it("records the codec for an H.265 keyframe", async () => {
      const { s, mockWsClient } = makeServer();
      await s.start();
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: createTestHevcData() },
        metadata: {
          videoCodec: "h265",
          videoFPS: 15,
          videoWidth: 1280,
          videoHeight: 720,
        },
      });

      const cached = s.getCachedKeyframe(60000);
      expect(cached).not.toBeNull();
      expect(cached!.codec).toBe("H265");
      await s.stop();
    });

    it("setCachedKeyframe seeds the cache (restore-after-reload)", async () => {
      const { s } = makeServer();
      await s.start();
      expect(s.getCachedKeyframe(60000)).toBeNull();

      const restored = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x40, 0x01]);
      s.setCachedKeyframe(restored, "H265");

      const cached = s.getCachedKeyframe(60000);
      expect(cached).not.toBeNull();
      expect(cached!.codec).toBe("H265");
      expect(cached!.data).toEqual(restored);
      await s.stop();
    });

    it("setCachedKeyframe does NOT overwrite a live keyframe", async () => {
      const { s, mockWsClient } = makeServer();
      await s.start();
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];
      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });
      s.setCachedKeyframe(Buffer.from([0xde, 0xad]), "H265");
      expect(s.getCachedKeyframe(60000)!.codec).toBe("H264");
      await s.stop();
    });

    it("returns null when the cached keyframe is older than maxAgeMs", async () => {
      const { s, mockWsClient } = makeServer();
      await s.start();
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      await wait(50);
      // Freshness window shorter than the elapsed time → treated as stale.
      expect(s.getCachedKeyframe(10)).toBeNull();
      // But still available within a generous window.
      expect(s.getCachedKeyframe(60000)).not.toBeNull();
      await s.stop();
    });
  });

  describe("livestream active/inactive events (station registry signals)", () => {
    const makeServer = () => {
      const mockWsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: {
          device: jest.fn().mockReturnValue({
            startLivestream: jest.fn().mockResolvedValue({}),
            stopLivestream: jest.fn().mockResolvedValue({}),
          }),
        },
      };
      const s = new StreamServer({
        port: testPort,
        host: "127.0.0.1",
        wsClient: mockWsClient as any,
        serialNumber: "TEST123",
      });
      return { s, mockWsClient };
    };

    it("emits livestreamActive with the serial when video first flows", async () => {
      const { s, mockWsClient } = makeServer();
      await s.start();
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      const active = jest.fn();
      s.on("livestreamActive", active);

      eventHandler({
        serialNumber: "TEST123",
        buffer: { data: createTestH264Data() },
        metadata: {
          videoCodec: "h264",
          videoFPS: 30,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });

      expect(active).toHaveBeenCalledTimes(1);
      expect(active).toHaveBeenCalledWith({ serialNumber: "TEST123" });
      await s.stop();
    });

    it("emits livestreamInactive on stop, and only once per transition", async () => {
      const { s, mockWsClient } = makeServer();
      await s.start();
      const eventHandler = mockWsClient.addEventListener.mock.calls[0][1];

      const active = jest.fn();
      const inactive = jest.fn();
      s.on("livestreamActive", active);
      s.on("livestreamInactive", inactive);

      // Two video events — active should fire only once (transition).
      for (let i = 0; i < 2; i++) {
        eventHandler({
          serialNumber: "TEST123",
          buffer: { data: createTestH264Data() },
          metadata: {
            videoCodec: "h264",
            videoFPS: 30,
            videoWidth: 1920,
            videoHeight: 1080,
          },
        });
      }
      expect(active).toHaveBeenCalledTimes(1);

      await s.stop();
      expect(inactive).toHaveBeenCalledWith({ serialNumber: "TEST123" });
    });
  });

  describe("getMuxedPort", () => {
    it("returns undefined before server starts", () => {
      expect(server.getMuxedPort()).toBeUndefined();
    });

    it("returns a positive number after server starts", async () => {
      await server.start();
      const port = server.getMuxedPort();
      expect(typeof port).toBe("number");
      expect(port).toBeGreaterThan(0);
    });
  });

  describe("metadata sessions and wait hygiene", () => {
    const fireVideoMetadata = (codec: "H264" | "H265") => {
      const videoListener = mockWsClient.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream video data",
      );
      videoListener[1]({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: keyframeAccessUnit(codec) },
        metadata: {
          videoCodec: codec,
          videoFPS: 15,
          videoWidth: 1280,
          videoHeight: 720,
        },
      });
    };

    it("removes a waiter after metadata wait timeout", async () => {
      await expect(server.waitForVideoMetadata(50)).rejects.toThrow();
      expect((server as any).metadataWaiters.length).toBe(0);
    });

    it("removes a waiter after metadata wait cancellation", async () => {
      const controller = new AbortController();
      const waitForMetadata = server.waitForVideoMetadata(5000, {
        signal: controller.signal,
      });

      controller.abort();

      await expect(waitForMetadata).rejects.toThrow(/cancel/i);
      expect((server as any).metadataWaiters.length).toBe(0);
    });

    it("requires metadata confirmation for every livestream session", () => {
      fireVideoMetadata("H264");
      expect(server.getVideoMetadata()?.videoCodec).toBe("H264");
      expect(server.isMetadataVerifiedForCurrentSession()).toBe(true);

      (server as any).beginMetadataSession();

      expect(server.isMetadataVerifiedForCurrentSession()).toBe(false);
      expect(server.getVideoMetadata()?.videoCodec).toBe("H264");

      fireVideoMetadata("H265");

      expect(server.isMetadataVerifiedForCurrentSession()).toBe(true);
      expect(server.getVideoMetadata()?.videoCodec).toBe("H265");
    });

    it("does not carry audio detection into a new metadata session", () => {
      const audioListener = mockWsClient.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream audio data",
      )[1];
      audioListener({
        serialNumber: "TEST_DEVICE_123",
        buffer: {
          data: Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]),
        },
        metadata: { audioCodec: "AAC" },
      });
      expect(server.getAudioStatus()).toBe("aac");

      (server as any).beginMetadataSession();

      expect(server.getAudioStatus()).toBe("unknown");
      expect((server as any).audioMetadata).toBeNull();
    });

    it("boots upstream for a metadata waiter and holds its consumer until release", async () => {
      await server.start();

      const waiter = server.acquireMetadataWaiter(5000);
      await wait(20);

      expect((server as any).getTotalConsumers()).toBe(1);
      expect(mockWsClient.commands.device().startLivestream).toHaveBeenCalled();

      fireVideoMetadata("H265");
      await expect(waiter.promise).resolves.toEqual(
        expect.objectContaining({ videoCodec: "H265" }),
      );
      expect((server as any).getTotalConsumers()).toBe(1);

      waiter.release();
      expect((server as any).getTotalConsumers()).toBe(0);
    });

    it("cancels a metadata bootstrap cleanly and turns its timeout into a background warm lease", async () => {
      const acquireStreamSlot = jest.fn().mockImplementation(() => ({
        active: true,
        whenReady: Promise.resolve(),
        markDelivering: jest.fn(),
        release: jest.fn(),
      }));
      const s = new StreamServer({
        port: testPort + 1,
        host: "127.0.0.1",
        wsClient: mockWsClient,
        serialNumber: "TEST_DEVICE_123",
        acquireStreamSlot,
      });
      await s.start();
      const cancelled = s.acquireMetadataWaiter(5000);
      cancelled.cancel();
      await expect(cancelled.promise).rejects.toThrow(/cancel/i);
      expect((s as any).getTotalConsumers()).toBe(0);

      const timedOut = s.acquireMetadataWaiter(20);
      await expect(timedOut.promise).rejects.toThrow(/timeout/i);
      await wait(20);
      expect(acquireStreamSlot.mock.calls.map((call) => call[0])).toEqual([
        "live",
        "live",
        "background",
      ]);
      await s.stop();
    });
  });

  describe("audio event handler", () => {
    let audioCallback: (event: any) => void;
    let videoCallback: (event: any) => void;

    // Seed video metadata so handleMuxedClient's waitForVideoMetadata
    // resolves quickly. Without this it would block for 15s waiting for
    // the first video frame, and tests that rely on a muxer being attached
    // would time out.
    const seedVideoMetadata = () => {
      // These tests exercise audio, so mark the device as audio-capable to
      // skip the muxer's audio-detection wait and create it immediately
      // (in "both" mode), matching the assumption these tests were written under.
      const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      // Minimal H.264 SPS NAL — content irrelevant for metadata capture.
      const nal = Buffer.from([0x67, 0x42, 0x00, 0x1e]);
      // A real first frame cannot arrive before the server has handled the
      // connection and issued its session start. Defer this synthetic frame
      // one event turn so it verifies that newly-started session.
      setTimeout(() => {
        (server as any).deliversAudio = true;
        videoCallback({
          serialNumber: "TEST_DEVICE_123",
          buffer: { data: Buffer.concat([startCode, nal]) },
          metadata: {
            videoCodec: "H264",
            videoFPS: 30,
            videoWidth: 1280,
            videoHeight: 720,
          },
        });
      }, 0);
    };

    beforeEach(async () => {
      await server.start();
      const videoCall = mockWsClient.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream video data",
      );
      videoCallback = videoCall[1];
      const audioCall = mockWsClient.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream audio data",
      );
      audioCallback = audioCall[1];
    });

    it("ignores events for wrong serialNumber", () => {
      // Connect a muxed client would normally be needed, but we just verify no
      // crash and no side-effects when serialNumber doesn't match.
      // Since muxerStreams is empty the early-return for wrong SN is the first guard.
      const JMuxerMock = require("jmuxer").default;
      JMuxerMock.mockClear();

      audioCallback({
        serialNumber: "OTHER_DEVICE",
        buffer: {
          data: Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]),
        },
        metadata: { audioCodec: "AAC" },
      });

      // JMuxer should never have been constructed or fed
      expect(JMuxerMock).not.toHaveBeenCalled();
    });

    it("captures audio metadata on first event", async () => {
      expect((server as any).audioMetadata).toBeNull();

      const adtsBuffer = Buffer.from([
        0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc,
      ]);
      audioCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: adtsBuffer },
        metadata: { audioCodec: "AAC" },
      });

      expect((server as any).audioMetadata).toEqual({ audioCodec: "AAC" });
    });

    it("drops non-ADTS frames when muxers are attached", async () => {
      // Connect a muxed client
      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      // Seed video metadata so handleMuxedClient's metadata-wait resolves
      // and the JMuxer gets constructed.
      seedVideoMetadata();
      await wait(50);

      expect((server as any).muxerStreams.size).toBe(1);

      // Get the muxer instance that was created
      const JMuxerMock = require("jmuxer").default;
      const muxerInstance =
        JMuxerMock.mock.results[JMuxerMock.mock.results.length - 1].value;
      muxerInstance.feed.mockClear();

      // Fire audio event with non-ADTS buffer (doesn't start with 0xFF 0xFx)
      const nonAdtsBuffer = Buffer.from([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
      ]);
      audioCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: nonAdtsBuffer },
        metadata: { audioCodec: "AAC" },
      });

      expect(muxerInstance.feed).not.toHaveBeenCalledWith(
        expect.objectContaining({ audio: expect.anything() }),
      );

      socket.destroy();
    });

    it("only an ADTS frame marks the camera as audio-capable (non-ADTS stays video-only)", () => {
      // A camera that emits audio events but no usable ADTS frame must NOT be
      // flagged as delivering audio — otherwise the muxer picks `both` mode and
      // hangs forever waiting for an audio sample that never arrives, and the
      // live view stays black. Such a camera must be muxed video-only.
      expect((server as any).deliversAudio).toBeUndefined();

      audioCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: {
          data: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
        },
        metadata: { audioCodec: "AAC" },
      });
      expect((server as any).deliversAudio).toBeUndefined();

      // A real ADTS frame flips it on so audio-capable cameras use `both`.
      audioCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: {
          data: Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]),
        },
        metadata: { audioCodec: "AAC" },
      });
      expect((server as any).deliversAudio).toBe(true);
    });

    it("reports unknown, aac, and video-only audio detection states", () => {
      expect(server.getAudioStatus()).toBe("unknown");

      audioCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: {
          data: Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]),
        },
        metadata: { audioCodec: "AAC" },
      });
      expect(server.getAudioStatus()).toBe("aac");

      (server as any).deliversAudio = false;
      expect(server.getAudioStatus()).toBe("none");
    });

    it("feeds valid ADTS frames to all muxers", async () => {
      // Connect a muxed client
      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      seedVideoMetadata();
      await wait(50);

      expect((server as any).muxerStreams.size).toBe(1);

      const JMuxerMock = require("jmuxer").default;
      const muxerInstance =
        JMuxerMock.mock.results[JMuxerMock.mock.results.length - 1].value;
      muxerInstance.feed.mockClear();

      // Valid ADTS: sync word 0xFFF, ID=0, layer=00, protection_absent=1
      const adtsBuffer = Buffer.from([
        0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc,
      ]);
      audioCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: adtsBuffer },
        metadata: { audioCodec: "AAC" },
      });

      expect(muxerInstance.feed).toHaveBeenCalledWith({ audio: adtsBuffer });

      socket.destroy();
    });
  });

  describe("handleMuxedClient", () => {
    // JMuxer is only constructed after the first video event arrives (so
    // the muxer can be created with the correct codec). Helper to seed
    // that metadata and unblock the in-flight `waitForVideoMetadata`.
    const seedVideoMetadata = (s: StreamServer, codec: string = "H264") => {
      // Default these tests to audio-capable so the muxer is built
      // immediately (mode "both"), as they were written before audio-aware
      // mode existed. The video-only path has its own dedicated tests.
      const videoCall = (
        (s as any).options.wsClient as any
      ).addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream video data",
      );
      const videoCallback = videoCall[1];
      // Keep the synthetic first frame after the connection handler has
      // established its metadata session, matching real P2P ordering.
      setTimeout(() => {
        (s as any).deliversAudio = true;
        videoCallback({
          serialNumber: "TEST_DEVICE_123",
          buffer: { data: keyframeAccessUnit(codec) },
          metadata: {
            videoCodec: codec,
            videoFPS: 30,
            videoWidth: 1280,
            videoHeight: 720,
          },
        });
      }, 0);
    };

    it("adds muxer to map on connection", async () => {
      await server.start();

      expect((server as any).muxerStreams.size).toBe(0);

      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      // Connection alone only registers the socket as pending; the muxer
      // is built after the first video event delivers metadata. Seed the
      // metadata, then wait for handleMuxedClient to construct the muxer.
      seedVideoMetadata(server);
      await wait(50);

      expect((server as any).muxerStreams.size).toBe(1);
      expect((server as any).pendingMuxerSockets.size).toBe(0);

      socket.destroy();
    });

    it("removes muxer on socket close", async () => {
      await server.start();

      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      seedVideoMetadata(server);
      await wait(50);

      expect((server as any).muxerStreams.size).toBe(1);

      const JMuxerMock = require("jmuxer").default;
      const muxerInstance =
        JMuxerMock.mock.results[JMuxerMock.mock.results.length - 1].value;

      socket.destroy();
      await wait(100);

      expect((server as any).muxerStreams.size).toBe(0);
      expect(muxerInstance.destroy).toHaveBeenCalled();
    });

    it("constructs JMuxer with videoCodec=H264 for H.264 streams", async () => {
      await server.start();

      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      seedVideoMetadata(server, "H264");
      await wait(50);

      const JMuxerMock = require("jmuxer").default;
      const lastCall =
        JMuxerMock.mock.calls[JMuxerMock.mock.calls.length - 1][0];
      expect(lastCall.videoCodec).toBe("H264");

      socket.destroy();
    });

    it("constructs JMuxer with videoCodec=H265 for H.265 streams", async () => {
      await server.start();

      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      seedVideoMetadata(server, "H265");
      await wait(50);

      const JMuxerMock = require("jmuxer").default;
      const lastCall =
        JMuxerMock.mock.calls[JMuxerMock.mock.calls.length - 1][0];
      expect(lastCall.videoCodec).toBe("H265");

      socket.destroy();
    });

    it("muxes in 'video' mode for a video-only (mic-off) camera", async () => {
      await server.start();
      const socket = net.createConnection({
        port: server.getMuxedPort()!,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));

      // Let the connection handler establish its new metadata session before
      // simulating the first P2P video frame.
      await wait(0);

      // Seed video metadata directly — the helper would force audio=true.
      const videoCallback = (
        (server as any).options.wsClient as any
      ).addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "livestream video data",
      )[1];
      // Known video-only: set this after the new session clears stale audio
      // detection, so the muxer does not wait for a track that will not arrive.
      (server as any).deliversAudio = false;
      videoCallback({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: keyframeAccessUnit("H265") },
        metadata: {
          videoCodec: "H265",
          videoFPS: 15,
          videoWidth: 1920,
          videoHeight: 1080,
        },
      });
      await wait(50);

      const JMuxerMock = require("jmuxer").default;
      const lastCall =
        JMuxerMock.mock.calls[JMuxerMock.mock.calls.length - 1][0];
      expect(lastCall.mode).toBe("video");
      socket.destroy();
    });

    it("pending muxer client counts as a consumer (triggers livestream start)", async () => {
      await server.start();

      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      // Don't seed metadata — leave the socket pending. The livestream
      // state machine should still consider it a consumer and ask the WS
      // client to start the livestream.
      await wait(20);

      expect(mockWsClient.commands.device().startLivestream).toHaveBeenCalled();

      socket.destroy();
    });

    it("cancels a pending metadata wait when its muxed socket closes", async () => {
      await server.start();

      const socket = net.createConnection({
        port: server.getMuxedPort()!,
        host: "127.0.0.1",
      });
      const unhandledRejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason);
      };
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        await new Promise((resolve) => socket.on("connect", resolve));
        await wait(20);

        expect((server as any).metadataWaiters.length).toBe(1);

        const pendingServerSocket = Array.from(
          (server as any).pendingMuxerSockets,
        )[0] as net.Socket;
        const serverSocketClosed = new Promise<void>((resolve) =>
          pendingServerSocket.once("close", resolve),
        );
        socket.destroy();
        await serverSocketClosed;
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect((server as any).metadataWaiters.length).toBe(0);
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.removeListener("unhandledRejection", onUnhandledRejection);
        socket.destroy();
      }
    });

    it("cancels pending metadata waits before server stop resolves", async () => {
      await server.start();

      const socket = net.createConnection({
        port: server.getMuxedPort()!,
        host: "127.0.0.1",
      });
      const unhandledRejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason);
      };
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        await new Promise((resolve) => socket.on("connect", resolve));
        await wait(20);

        expect((server as any).metadataWaiters.length).toBe(1);

        await server.stop();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect((server as any).metadataWaiters.length).toBe(0);
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.removeListener("unhandledRejection", onUnhandledRejection);
        socket.destroy();
      }
    });

    it("JMuxer duplex data is written to socket", async () => {
      await server.start();

      const muxedPort = server.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });

      const receivedChunks: Buffer[] = [];
      socket.on("data", (chunk) => receivedChunks.push(chunk as Buffer));

      await new Promise((resolve) => socket.on("connect", resolve));
      seedVideoMetadata(server);
      await wait(50);

      const JMuxerMock = require("jmuxer").default;
      const muxerInstance =
        JMuxerMock.mock.results[JMuxerMock.mock.results.length - 1].value;

      // Get the duplex stream that was created by muxer.createStream()
      const duplex: Duplex =
        muxerInstance.createStream.mock.results[0]?.value ??
        muxerInstance.createStream();

      // Push data into the duplex — the handler should write it to the socket
      const testChunk = Buffer.from("fmp4-data-chunk");
      duplex.push(testChunk);

      await wait(100);

      const combined = Buffer.concat(receivedChunks);
      expect(combined).toEqual(testChunk);

      socket.destroy();
    });
  });

  describe("parameter-set caching (individual NAL units, not whole events)", () => {
    const START = Buffer.from([0x00, 0x00, 0x00, 0x01]);
    const SPS_NAL = Buffer.from([0x67, 0x42, 0x00, 0x1e]);
    const PPS_NAL = Buffer.from([0x68, 0xce, 0x3c, 0x80]);
    // Distinctive payloads so we can detect which IDR ended up where.
    const IDR_A = Buffer.from([0x65, 0xaa, 0xaa, 0xaa, 0xaa]);
    const IDR_B = Buffer.from([0x65, 0xbb, 0xbb, 0xbb, 0xbb]);

    const h264Metadata = {
      videoCodec: "H264",
      videoFPS: 30,
      videoWidth: 1920,
      videoHeight: 1080,
    };

    const fireVideo = (data: Buffer) => {
      const handler = mockWsClient.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === "livestream video data",
      )[1];
      handler({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data },
        metadata: h264Metadata,
      });
    };

    it("caches only the parameter-set NALs from a bundled SPS+PPS+IDR event", async () => {
      await server.start();

      // Eufy typically bundles parameter sets with the IDR in one event.
      fireVideo(Buffer.concat([START, SPS_NAL, START, PPS_NAL, START, IDR_A]));
      await wait(50);

      // A new raw TCP client receives the cached headers on connect. It must
      // get the SPS and PPS — and must NOT get the stale IDR frame.
      const client = new net.Socket();
      const received: Buffer[] = [];
      client.on("data", (d) => received.push(d as Buffer));
      await new Promise<void>((resolve) => {
        client.connect(testPort, "127.0.0.1", () => resolve());
      });
      await wait(100);

      const combined = Buffer.concat(received);
      expect(combined.includes(SPS_NAL)).toBe(true);
      expect(combined.includes(PPS_NAL)).toBe(true);
      expect(combined.includes(IDR_A)).toBe(false);

      client.destroy();
    });

    it("snapshot for a later IDR-only event does not embed the previous IDR", async () => {
      // Frame A arrives bundled with the parameter sets.
      fireVideo(Buffer.concat([START, SPS_NAL, START, PPS_NAL, START, IDR_A]));
      await wait(20);

      // A snapshot is requested, then frame B arrives as an IDR-only event
      // (no parameter sets in the same event → the cached ones get prepended).
      const snapshotPromise = server.captureSnapshot(3000);
      await wait(20);
      fireVideo(Buffer.concat([START, IDR_B]));

      const payload = await snapshotPromise;

      // Decodable: parameter sets present, followed by frame B.
      expect(payload.includes(SPS_NAL)).toBe(true);
      expect(payload.includes(PPS_NAL)).toBe(true);
      expect(payload.includes(IDR_B)).toBe(true);
      // Correct: the stale frame A must not precede frame B in the payload —
      // ffmpeg decodes the FIRST picture it finds, which would be frame A.
      expect(payload.includes(IDR_A)).toBe(false);
    });
  });

  describe("stop() with muxer-only consumers", () => {
    it("stops the upstream livestream even when no raw TCP clients exist", async () => {
      // The normal HomeKit path: consumers attach only via the muxed port
      // (zero raw TCP clients). stop() must still stop the camera.
      const deviceApi = {
        startLivestream: jest.fn().mockResolvedValue({}),
        stopLivestream: jest.fn().mockResolvedValue({}),
        isLivestreaming: jest.fn().mockResolvedValue({ livestreaming: true }),
      };
      const wsClient = {
        addEventListener: jest.fn().mockReturnValue(() => {}),
        commands: { device: jest.fn().mockReturnValue(deviceApi) },
      };
      const s = new StreamServer({
        port: testPort + 1,
        host: "127.0.0.1",
        wsClient: wsClient as any,
        serialNumber: "TEST_DEVICE_123",
      });
      await s.start();

      // Attach a muxed client — this sets livestream intent.
      const muxedPort = s.getMuxedPort()!;
      const socket = net.createConnection({
        port: muxedPort,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      await wait(100);
      expect((s as any).livestreamIntendedState).toBe(true);

      await s.stop();

      expect(deviceApi.stopLivestream).toHaveBeenCalled();
      socket.destroy();
    });
  });

  describe("battery-camera cold start and session changes (muxer)", () => {
    const ADTS = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc]);

    const lastListener = (event: string) => {
      const calls = mockWsClient.addEventListener.mock.calls.filter(
        (call: any[]) => call[0] === event,
      );
      return calls[calls.length - 1][1] as (e: any) => void;
    };
    const fireVideo = (codec: "H264" | "H265" = "H264") =>
      lastListener("livestream video data")({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: keyframeAccessUnit(codec) },
        metadata: {
          videoCodec: codec,
          videoFPS: 15,
          videoWidth: 2560,
          videoHeight: 1440,
        },
      });
    const fireAudio = (count = 1) => {
      for (let i = 0; i < count; i++) {
        lastListener("livestream audio data")({
          serialNumber: "TEST_DEVICE_123",
          buffer: { data: ADTS },
          metadata: { audioCodec: "AAC" },
        });
      }
    };
    const jmuxer = () => require("jmuxer").default;
    const lastCall = () => {
      const calls = jmuxer().mock.calls;
      return calls[calls.length - 1][0];
    };
    /** Make the newest mocked JMuxer emit fMP4, as a real one would. */
    const emitFmp4 = () => {
      const results = jmuxer().mock.results;
      const instance = results[results.length - 1].value;
      const duplex = instance.createStream.mock.results[0].value;
      duplex.push(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]));
    };
    const connectMuxed = async (s: StreamServer) => {
      const socket = net.createConnection({
        port: s.getMuxedPort()!,
        host: "127.0.0.1",
      });
      await new Promise((resolve) => socket.on("connect", resolve));
      socket.resume(); // drain like ffmpeg does, so a server close surfaces
      return socket;
    };
    const closed = (socket: net.Socket) =>
      new Promise((resolve) => socket.once("close", resolve));
    const tune = (s: StreamServer) => {
      (s as any).BOTH_TO_VIDEO_FALLBACK_MS = 80;
      (s as any).AUDIO_DETECT_WINDOW_MS = 60;
      (s as any).AUDIO_RECONNECT_SETTLE_MS = 30;
    };

    /**
     * A server whose HomeBase slot is granted only when the test says so,
     * reproducing the cold-start order where the muxer client attaches
     * before the P2P session (and `beginMetadataSession`) begins.
     */
    const createSlotGatedServer = () => {
      let grantSlot: () => void = () => undefined;
      const whenReady = new Promise<void>((resolve) => (grantSlot = resolve));
      const revokers: Array<() => void> = [];
      const acquireStreamSlot = jest
        .fn()
        .mockImplementation((_priority: string, onRevoke: () => void) => {
          revokers.push(onRevoke);
          return {
            active: true,
            whenReady,
            markDelivering: jest.fn(),
            release: jest.fn(),
          };
        });
      const s = new StreamServer({
        port: testPort + 2,
        host: "127.0.0.1",
        wsClient: mockWsClient,
        serialNumber: "TEST_DEVICE_123",
        acquireStreamSlot,
      });
      tune(s);
      return {
        s,
        acquireStreamSlot,
        grantSlot: () => grantSlot(),
        revoke: () => revokers[revokers.length - 1](),
      };
    };

    /** A previous P2P session delivered video + AAC, then stopped. */
    const runPreviousSession = (s: StreamServer) => {
      (s as any).beginMetadataSession();
      fireVideo();
      fireAudio();
      expect(s.getAudioStatus()).toBe("aac");
      (s as any).setLivestreamActual(false);
      (s as any).livestreamSessionStartedAt = 0;
    };

    /**
     * Start a session through a first viewer that delivers video and audio
     * and is emitting fMP4, so the next muxer client attaches warm.
     */
    const startWarmSession = async (codec: "H264" | "H265" = "H264") => {
      await server.start();
      tune(server);
      const opener = await connectMuxed(server);
      await wait(20);
      fireVideo(codec);
      fireAudio();
      await wait(20);
      emitFmp4(); // opener is live; it must not fall back during the test
      await wait(10);
      return opener;
    };

    // Report the upstream as streaming once started, like bropat does, so a
    // reconnecting consumer joins the running P2P session.
    beforeEach(() => {
      const api = mockWsClient.commands.device();
      api.isLivestreaming = jest.fn().mockImplementation(async () => ({
        livestreaming:
          api.startLivestream.mock.calls.length >
          api.stopLivestream.mock.calls.length,
      }));
    });

    let gated: StreamServer | undefined;
    afterEach(async () => {
      if (gated?.isRunning()) await gated.stop();
      gated = undefined;
    });

    describe("cold start", () => {
      it("waits for the new session's first video frame, then muxes 'both' when audio arrives", async () => {
        const { s, grantSlot } = createSlotGatedServer();
        gated = s;
        await s.start();
        runPreviousSession(s);
        const callsBefore = jmuxer().mock.calls.length;

        const socket = await connectMuxed(s);
        // Camera still waking: the previous session must not build a muxer.
        await wait(150);
        expect(jmuxer().mock.calls.length).toBe(callsBefore);
        expect((s as any).pendingMuxerSockets.size).toBe(1);

        grantSlot();
        await wait(20);
        expect(
          mockWsClient.commands.device().startLivestream,
        ).toHaveBeenCalled();
        expect(s.getAudioStatus()).toBe("unknown");
        expect(jmuxer().mock.calls.length).toBe(callsBefore);

        fireVideo();
        fireAudio();
        await wait(30);
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        expect(lastCall().mode).toBe("both");
        socket.destroy();
      });

      it("muxes video-only when no audio arrives within the detect window", async () => {
        await server.start();
        tune(server);
        const callsBefore = jmuxer().mock.calls.length;
        const socket = await connectMuxed(server);
        await wait(20);
        fireVideo();
        await wait(100); // > AUDIO_DETECT_WINDOW_MS
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        expect(lastCall().mode).toBe("video");
        socket.destroy();
      });

      it("rebuilds as 'both' in place when audio arrives before the first fMP4", async () => {
        await server.start();
        tune(server);
        const socket = await connectMuxed(server);
        await wait(20);
        fireVideo();
        await wait(100);
        expect(lastCall().mode).toBe("video");
        const calls = jmuxer().mock.calls.length;

        fireAudio(5);
        expect(jmuxer().mock.calls.length).toBe(calls + 1);
        expect(lastCall().mode).toBe("both");
        expect(socket.destroyed).toBe(false);
        socket.destroy();
      });

      it("never closes a video-only socket for audio once fMP4 has started", async () => {
        await server.start();
        tune(server);
        const socket = await connectMuxed(server);
        let socketClosed = false;
        socket.on("close", () => (socketClosed = true));
        await wait(20);
        fireVideo();
        await wait(100);
        expect(lastCall().mode).toBe("video");
        emitFmp4();
        await wait(10);
        const calls = jmuxer().mock.calls.length;

        fireAudio(10);
        await wait(100);
        expect(jmuxer().mock.calls.length).toBe(calls);
        expect(socketClosed).toBe(false);
        socket.destroy();
      });

      it("keeps a mic-off camera video-only for the whole session", async () => {
        await server.start();
        tune(server);
        const callsBefore = jmuxer().mock.calls.length;
        const socket = await connectMuxed(server);
        await wait(20);
        fireVideo();
        await wait(100);
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        expect(lastCall().mode).toBe("video");
        emitFmp4();

        for (let i = 0; i < 5; i++) fireVideo();
        await wait(120);
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        expect(socket.destroyed).toBe(false);
        socket.destroy();
      });
    });

    describe("after a plugin restart and with a busy HomeBase", () => {
      it("rebuilds a muxer built from the persisted codec hint once the session's codec is known", async () => {
        const s = new StreamServer({
          port: testPort + 3,
          host: "127.0.0.1",
          wsClient: mockWsClient,
          serialNumber: "TEST_DEVICE_123",
          initialVideoCodec: "H265",
        });
        gated = s;
        tune(s);
        (s as any).MUXER_METADATA_TIMEOUT_MS = 50;
        await s.start();
        const callsBefore = jmuxer().mock.calls.length;
        const socket = await connectMuxed(s);
        await wait(150); // metadata wait times out → hinted H265, video-only
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        expect(lastCall().videoCodec).toBe("H265");

        fireVideo("H264"); // the session turns out to be H.264
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 2);
        expect(lastCall().videoCodec).toBe("H264");
        expect(socket.destroyed).toBe(false);
        socket.destroy();
      });

      it("retries a denied live slot while a consumer waits", async () => {
        let grants = 0;
        const acquireStreamSlot = jest.fn().mockImplementation(() =>
          grants++ === 0
            ? null // another camera is in its warm-up window
            : {
                active: true,
                whenReady: Promise.resolve(),
                markDelivering: jest.fn(),
                release: jest.fn(),
              },
        );
        const s = new StreamServer({
          port: testPort + 4,
          host: "127.0.0.1",
          wsClient: mockWsClient,
          serialNumber: "TEST_DEVICE_123",
          acquireStreamSlot,
        });
        gated = s;
        tune(s);
        (s as any).SLOT_BUSY_RETRY_MS = 50;
        await s.start();
        const socket = await connectMuxed(s);
        await wait(20);
        expect(acquireStreamSlot).toHaveBeenCalledTimes(1);
        expect(
          mockWsClient.commands.device().startLivestream,
        ).not.toHaveBeenCalled();

        await wait(100);
        expect(acquireStreamSlot).toHaveBeenCalledTimes(2);
        expect(
          mockWsClient.commands.device().startLivestream,
        ).toHaveBeenCalledTimes(1);
        socket.destroy();
      });

      it("stops retrying once no consumer is waiting", async () => {
        const acquireStreamSlot = jest.fn().mockReturnValue(null);
        const s = new StreamServer({
          port: testPort + 5,
          host: "127.0.0.1",
          wsClient: mockWsClient,
          serialNumber: "TEST_DEVICE_123",
          acquireStreamSlot,
        });
        gated = s;
        (s as any).SLOT_BUSY_RETRY_MS = 50;
        await s.start();
        const socket = await connectMuxed(s);
        await wait(20);
        socket.destroy();
        await wait(200);
        expect(acquireStreamSlot).toHaveBeenCalledTimes(1);
      });
    });

    describe("warm attach", () => {
      it("muxes 'both' and starts the fallback clock at the first video frame, not at attach", async () => {
        const opener = await startWarmSession();
        const socket = await connectMuxed(server);
        await wait(30);
        expect(lastCall().mode).toBe("both");
        const callsAtBuild = jmuxer().mock.calls.length;

        await wait(150); // no video fed yet → no fallback, however long
        expect(jmuxer().mock.calls.length).toBe(callsAtBuild);

        fireVideo(); // window opens
        await wait(40);
        emitFmp4(); // inside the window
        await wait(120);
        expect(jmuxer().mock.calls.length).toBe(callsAtBuild);
        socket.destroy();
        opener.destroy();
      });

      it("falls back to video-only, restores 'both' once audio proves continuous, and never flaps", async () => {
        const opener = await startWarmSession();
        const socket = await connectMuxed(server);
        await wait(30);
        expect(lastCall().mode).toBe("both");

        fireVideo();
        await wait(120); // no fMP4 → fallback
        expect(lastCall().mode).toBe("video");
        const callsAfterFallback = jmuxer().mock.calls.length;

        fireAudio(4); // 5th ADTS frame in this session
        expect(jmuxer().mock.calls.length).toBe(callsAfterFallback + 1);
        expect(lastCall().mode).toBe("both");

        fireVideo();
        await wait(120);
        expect(lastCall().mode).toBe("video");
        fireAudio(10);
        expect(lastCall().mode).toBe("video");
        expect(socket.destroyed).toBe(false);
        socket.destroy();
        opener.destroy();
      });
    });

    describe("GOP replay into a new muxer", () => {
      const newestMuxer = () => {
        const results = jmuxer().mock.results;
        return results[results.length - 1].value;
      };

      it("feeds a muxer built right after a keyframe the current GOP", async () => {
        const opener = await startWarmSession();
        const callsBefore = jmuxer().mock.calls.length;
        const socket = await connectMuxed(server);
        await wait(30);
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        // No live frame since attach, yet the new muxer already has the
        // session's keyframe and can emit without waiting a whole GOP.
        expect(newestMuxer().feed).toHaveBeenCalledWith({
          video: keyframeAccessUnit("H264"),
        });
        socket.destroy();
        opener.destroy();
      });

      it("does not replay a GOP older than the replay window", async () => {
        const opener = await startWarmSession();
        (server as any).GOP_REPLAY_MAX_AGE_MS = -1;
        const socket = await connectMuxed(server);
        await wait(30);
        expect(newestMuxer().feed).not.toHaveBeenCalledWith(
          expect.objectContaining({ video: expect.anything() }),
        );
        socket.destroy();
        opener.destroy();
      });
    });

    describe("waitForSettledCodec", () => {
      it("waits for the second keyframe and reports the codec the camera switched to", async () => {
        await server.start();
        (server as any).CODEC_SETTLE_MS = 60_000;
        (server as any).beginMetadataSession();
        fireVideo("H265");
        let settled: string | undefined | null = null;
        const waiting = server
          .waitForSettledCodec(2_000)
          .then((codec) => (settled = codec));
        await wait(150);
        expect(settled).toBeNull(); // one keyframe: not settled yet
        fireVideo("H264"); // the S330 switches at its next keyframe
        await waiting;
        expect(settled).toBe("H264");
      });

      it("settles on time after the first frame when no second keyframe comes", async () => {
        await server.start();
        (server as any).CODEC_SETTLE_MS = 50;
        (server as any).beginMetadataSession();
        fireVideo("H265");
        await expect(server.waitForSettledCodec(2_000)).resolves.toBe("H265");
      });

      it("resolves undefined when the session never delivers video", async () => {
        await server.start();
        (server as any).beginMetadataSession();
        await expect(server.waitForSettledCodec(150)).resolves.toBeUndefined();
      });
    });

    describe("stale session after a HomeBase slot revoke", () => {
      it("stops trusting the session and lets a new viewer re-take the slot", async () => {
        const { s, acquireStreamSlot, grantSlot, revoke } =
          createSlotGatedServer();
        gated = s;
        await s.start();
        grantSlot();
        const socket = await connectMuxed(s);
        await wait(20);
        fireVideo();
        await wait(20);
        expect(s.isMetadataVerifiedForCurrentSession()).toBe(true);
        const api = mockWsClient.commands.device();
        const startsBefore = api.startLivestream.mock.calls.length;

        revoke();
        await wait(30);
        expect(s.isMetadataVerifiedForCurrentSession()).toBe(false);
        expect(api.stopLivestream).toHaveBeenCalled();

        // A frame trailing the revoked session must not re-verify it.
        fireVideo();
        expect(s.isMetadataVerifiedForCurrentSession()).toBe(false);

        // Rebroadcast reconnecting is not a new viewer: stay yielded.
        const reconnect = await connectMuxed(s);
        await wait(30);
        expect(api.startLivestream.mock.calls.length).toBe(startsBefore);

        // A getVideoStream bootstrap is: it re-takes the slot and restarts.
        const slotsBefore = acquireStreamSlot.mock.calls.length;
        const viewer = s.acquireMetadataWaiter(5000, { viewer: true });
        await wait(30);
        expect(acquireStreamSlot.mock.calls.length).toBe(slotsBefore + 1);
        expect(api.startLivestream.mock.calls.length).toBe(startsBefore + 1);

        fireVideo();
        await expect(viewer.promise).resolves.toEqual(
          expect.objectContaining({ videoCodec: "H264" }),
        );
        expect(s.isMetadataVerifiedForCurrentSession()).toBe(true);
        viewer.release();
        reconnect.destroy();
        socket.destroy();
      });

      it("stops trusting the session when the livestream stops", () => {
        (server as any).beginMetadataSession();
        fireVideo();
        expect(server.isMetadataVerifiedForCurrentSession()).toBe(true);
        (server as any).setLivestreamActual(false);
        expect(server.isMetadataVerifiedForCurrentSession()).toBe(false);
        // The codec stays available as a hint for the next request.
        expect(server.getVideoMetadata()?.videoCodec).toBe("H264");
      });
    });

    describe("codec label vs bitstream", () => {
      const sc = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      const h264PSlice = Buffer.concat([sc, Buffer.from([0x21, 0x9a, 0x02])]);
      const fireFrame = (data: Buffer, label: "H264" | "H265") =>
        lastListener("livestream video data")({
          serialNumber: "TEST_DEVICE_123",
          buffer: { data },
          metadata: {
            videoCodec: label,
            videoFPS: 15,
            videoWidth: 3840,
            videoHeight: 2160,
          },
        });

      it("trusts H.264 parameter sets over an H265 label and muxes H.264", async () => {
        await server.start();
        tune(server);
        const socket = await connectMuxed(server);
        await wait(20);
        fireFrame(keyframeAccessUnit("H264"), "H265");
        await wait(100);

        expect(server.getVideoMetadata()?.videoCodec).toBe("H264");
        expect(lastCall().videoCodec).toBe("H264");
        socket.destroy();
      });

      it("re-emits metadataReceived with the codec settled by the bitstream", () => {
        const seen: string[] = [];
        server.on("metadataReceived", (m) => seen.push(m.videoCodec));
        (server as any).beginMetadataSession();
        fireFrame(h264PSlice, "H265"); // label only, no parameter sets yet
        fireFrame(keyframeAccessUnit("H264"), "H265");
        expect(seen).toEqual(["H265", "H264"]);
      });

      it("waits for parameter sets before building the muxer, then corrects the label", async () => {
        await server.start();
        tune(server);
        const callsBefore = jmuxer().mock.calls.length;
        const socket = await connectMuxed(server);
        await wait(20);

        // Session opens mid-GOP: slices only, labelled H265 (wrongly).
        fireFrame(h264PSlice, "H265");
        fireFrame(h264PSlice, "H265");
        await wait(50);
        expect(server.getVideoMetadata()?.videoCodec).toBe("H265");
        expect(jmuxer().mock.calls.length).toBe(callsBefore);

        fireFrame(keyframeAccessUnit("H264"), "H265");
        await wait(100); // + AUDIO_DETECT_WINDOW_MS (no audio in this session)
        expect(server.getVideoMetadata()?.videoCodec).toBe("H264");
        expect(jmuxer().mock.calls.length).toBe(callsBefore + 1);
        expect(lastCall().videoCodec).toBe("H264");
        socket.destroy();
      });
    });

    describe("snapshot keyframe cache", () => {
      const sc = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      const nalsOf = (...nals: Buffer[]) =>
        Buffer.concat(nals.flatMap((nal) => [sc, nal]));
      const label = (codec: "H264" | "H265") => {
        (server as any).videoMetadata = {
          videoCodec: codec,
          videoFPS: 15,
          videoWidth: 3840,
          videoHeight: 2160,
        };
      };

      it("does not cache a P-frame or an IDR without its parameter sets", async () => {
        label("H265");
        await server.streamVideo(nalsOf(S330_HEVC.trailSlice));
        await server.streamVideo(nalsOf(S330_HEVC.idrSlice));
        expect(server.getCachedKeyframe(60000)).toBeNull();
      });

      it("caches a self-contained H.265 keyframe, prepending cached parameter sets", async () => {
        label("H265");
        await server.streamVideo(
          nalsOf(S330_HEVC.vps, S330_HEVC.sps, S330_HEVC.pps),
        );
        await server.streamVideo(nalsOf(S330_HEVC.idrSlice));
        const cached = server.getCachedKeyframe(60000);
        expect(cached?.codec).toBe("H265");
        expect(cached?.data).toEqual(
          nalsOf(
            S330_HEVC.vps,
            S330_HEVC.sps,
            S330_HEVC.pps,
            S330_HEVC.idrSlice,
          ),
        );
      });

      it("never pairs an H.265 keyframe with H.264 parameter sets", async () => {
        label("H264");
        await server.streamVideo(
          nalsOf(
            Buffer.from([0x67, 0x42, 0x00, 0x1e]),
            Buffer.from([0x68, 0xce, 0x3c, 0x80]),
          ),
        );
        label("H265");
        await server.streamVideo(nalsOf(S330_HEVC.idrSlice));
        expect(server.getCachedKeyframe(60000)).toBeNull();
      });
    });

    describe("codec change between sessions (H.265 → H.264)", () => {
      it("rebuilds a muxer that hasn't emitted with the new codec, including the both→video fallback", async () => {
        const opener = await startWarmSession("H265");
        const socket = await connectMuxed(server);
        await wait(30);
        expect(lastCall()).toEqual(
          expect.objectContaining({ mode: "both", videoCodec: "H265" }),
        );

        (server as any).beginMetadataSession(); // wedge recycle → new session
        fireVideo("H264");
        expect(lastCall()).toEqual(
          expect.objectContaining({ mode: "both", videoCodec: "H264" }),
        );
        expect((server as any).cachedVPS).toBeNull();

        await wait(120); // still no fMP4 → fallback uses the current codec
        expect(lastCall()).toEqual(
          expect.objectContaining({ mode: "video", videoCodec: "H264" }),
        );
        socket.destroy();
        opener.destroy();
      });

      it("disconnects consumers that already received old-codec fMP4 or raw bytes", async () => {
        const opener = await startWarmSession("H265");
        const socket = await connectMuxed(server);
        const socketClosed = closed(socket);
        await wait(30);
        emitFmp4();
        await wait(10);

        const raw = net.createConnection({ port: testPort, host: "127.0.0.1" });
        await new Promise((resolve) => raw.on("connect", resolve));
        raw.resume();
        const rawClosed = closed(raw);
        await wait(20);

        (server as any).beginMetadataSession();
        fireVideo("H264");
        await Promise.all([socketClosed, rawClosed]);
        expect((server as any).hintedVideoCodec).toBe("H264");
        opener.destroy();
      });
    });
  });
});
