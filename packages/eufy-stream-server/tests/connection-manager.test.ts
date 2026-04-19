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
});
