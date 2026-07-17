import * as net from "net";
import { ConnectionManager } from "../src/connection-manager";
import { createTestLogger } from "./test-utils";

const makeSocket = (): net.Socket => {
  const socket = new net.Socket();
  jest.spyOn(socket, "removeAllListeners").mockReturnValue(socket);
  jest.spyOn(socket, "destroy").mockReturnValue(socket);
  jest.spyOn(socket, "setNoDelay").mockReturnValue(socket);
  jest.spyOn(socket, "setKeepAlive").mockReturnValue(socket);
  return socket;
};

describe("ConnectionManager", () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager(createTestLogger());
  });

  afterEach(() => {
    manager.close();
    jest.clearAllMocks();
  });

  describe("disconnectClient", () => {
    it("returns false for an unknown connectionId", () => {
      const result = manager.disconnectClient("nonexistent");

      expect(result).toBe(false);
    });

    it("returns true and removes the connection for a known connectionId", () => {
      const socket = makeSocket();
      manager.handleConnection(socket);

      expect(manager.getActiveConnectionCount()).toBe(1);
      const stats = manager.getConnectionStats();
      const connectionId = Object.keys(stats)[0];

      const result = manager.disconnectClient(connectionId);

      expect(result).toBe(true);
      expect(manager.getActiveConnectionCount()).toBe(0);
    });

    it("emits clientDisconnected when disconnecting a known connection", () => {
      const socket = makeSocket();
      manager.handleConnection(socket);

      const stats = manager.getConnectionStats();
      const connectionId = Object.keys(stats)[0];

      const disconnectListener = jest.fn();
      manager.on("clientDisconnected", disconnectListener);

      manager.disconnectClient(connectionId);

      expect(disconnectListener).toHaveBeenCalledWith(connectionId);
    });
  });

  describe("write backpressure", () => {
    const setWritableLength = (socket: net.Socket, bytes: number) => {
      // Unconnected test sockets report writable=false; force them
      // writable so the backpressure check is what decides the outcome.
      Object.defineProperty(socket, "writable", {
        value: true,
        configurable: true,
      });
      Object.defineProperty(socket, "writableLength", {
        value: bytes,
        configurable: true,
      });
    };

    it("disconnects a client whose socket buffer exceeds the high-water mark", () => {
      const stalled = makeSocket();
      const writeSpy = jest.spyOn(stalled, "write").mockReturnValue(true);
      manager.handleConnection(stalled);
      // Simulate a consumer that stopped reading: bytes pile up in the
      // kernel/Node buffer. Without a cap this grows without bound.
      setWritableLength(stalled, 8 * 1024 * 1024);

      const result = manager.broadcast(Buffer.from("frame"));

      expect(result).toBe(false);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(manager.getActiveConnectionCount()).toBe(0);
    });

    it("keeps writing to clients under the high-water mark", () => {
      const healthy = makeSocket();
      const writeSpy = jest.spyOn(healthy, "write").mockReturnValue(true);
      manager.handleConnection(healthy);
      setWritableLength(healthy, 1024);

      const result = manager.broadcast(Buffer.from("frame"));

      expect(result).toBe(true);
      expect(writeSpy).toHaveBeenCalled();
      expect(manager.getActiveConnectionCount()).toBe(1);
    });

    it("applies the same cap on sendToClient", () => {
      const stalled = makeSocket();
      const writeSpy = jest.spyOn(stalled, "write").mockReturnValue(true);
      manager.handleConnection(stalled);
      const connectionId = Object.keys(manager.getConnectionStats())[0];
      setWritableLength(stalled, 8 * 1024 * 1024);

      const result = manager.sendToClient(connectionId, Buffer.from("hdr"));

      expect(result).toBe(false);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(manager.getActiveConnectionCount()).toBe(0);
    });
  });
});
