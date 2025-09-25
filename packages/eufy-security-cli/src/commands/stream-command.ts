import { BaseCommand } from "./base-command";
import { StreamServer } from "eufy-stream-server";
import { EufySecurityClient } from "@scrypted/eufy-security-client";
import { ParsedArgs, DeviceInfo } from "../interfaces";

/**
 * Stream command - starts streaming from a camera device
 */
export class StreamCommand extends BaseCommand {
  readonly name = "stream";
  readonly description = "Start streaming from a camera device";

  private client?: EufySecurityClient;
  private streamServer?: StreamServer;
  private targetDevice?: DeviceInfo;
  private isShuttingDown = false;

  async execute(args: ParsedArgs): Promise<void> {
    // Validate required arguments
    this.validateRequiredArgs(args, ["cameraSerial"]);

    try {
      this.logger.info("🎥 Starting Eufy Camera Stream...");

      // Connect to WebSocket server
      this.client = await this.createClient(args.wsHost);

      // Find target device
      this.targetDevice = await this.findDevice(args.cameraSerial);
      this.logger.info(
        `📹 Found device: ${this.targetDevice.name} (${this.targetDevice.serialNumber})`
      );

      // Start TCP server
      await this.startTcpServer(args.port || 8080);

      // Setup graceful shutdown
      this.setupGracefulShutdown(async () => {
        await this.cleanup();
      });

      // Display connection information
      this.displayConnectionInfo(this.targetDevice);

      // Keep the process running
      await this.keepAlive();
    } catch (error) {
      this.logger.error("❌ Stream command failed:", error);
      await this.cleanup();
      throw error;
    }
  }

  private async findDevice(serialNumber: string): Promise<DeviceInfo> {
    this.logger.info(`🔍 Looking for camera: ${serialNumber}`);

    if (!this.client) {
      throw new Error("Client not initialized");
    }

    try {
      const devices: any[] = await this.withTimeout(
        this.client.getDevices(),
        15000,
        "Timeout while retrieving device list from server"
      );

      if (!devices || devices.length === 0) {
        throw new Error(
          `❌ No devices found on the server. Please ensure:\n` +
            `   • The eufy-security-ws server is properly configured\n` +
            `   • Your Eufy account has devices registered\n` +
            `   • The server has successfully connected to Eufy services`
        );
      }

      const device = devices.find((d) => d.serialNumber === serialNumber);

      if (!device) {
        // Provide helpful suggestions
        const availableSerials = devices
          .map((d) => `${d.name || "Unknown"} (${d.serialNumber})`)
          .slice(0, 5); // Show first 5 devices

        throw new Error(
          `❌ Camera device not found: ${serialNumber}\n\n` +
            `Available devices:\n${availableSerials
              .map((s: string) => `   • ${s}`)
              .join("\n")}\n\n` +
            `💡 Use 'eufy-security-cli list-devices --ws-host ${this.context.wsHost}' to see all available devices`
        );
      }

      return {
        name: device.name || "Unknown Camera",
        serialNumber: device.serialNumber,
        type: device.type || "Camera",
        stationSerial: device.stationSerial,
        model: device.model,
        hardwareVersion: device.hardwareVersion,
        softwareVersion: device.softwareVersion,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("❌")) {
        // Re-throw our custom error messages as-is
        throw error;
      }

      // Wrap other errors with context
      throw new Error(
        `❌ Failed to retrieve device information: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async startTcpServer(port: number): Promise<void> {
    this.logger.info("🌐 Starting TCP server...");

    if (!this.client || !this.targetDevice) {
      throw new Error("Client or target device not initialized");
    }

    try {
      // Create the StreamServer with WebSocket client and device serial
      this.streamServer = new StreamServer({
        port: port,
        debug: this.context.verbose || false,
        wsClient: (this.client as any).apiManager,
        serialNumber: this.targetDevice.serialNumber,
      });

      // Set up event handlers
      this.streamServer.on(
        "clientConnected",
        (connectionId: string, connectionInfo: any) => {
          this.logger.info(
            `🔌 Client connected: ${connectionId} from ${connectionInfo.remoteAddress}:${connectionInfo.remotePort}`
          );
        }
      );

      this.streamServer.on("clientDisconnected", (connectionId: string) => {
        this.logger.info(`🔌 Client disconnected: ${connectionId}`);
      });

      this.streamServer.on("error", (error: Error) => {
        this.logger.error("❌ Stream server error:", error);
      });

      this.streamServer.on("videoStreamed", (data: any) => {
        this.logger.debug(`📹 Streamed video frame: ${data.data.length} bytes`);
      });

      // Start the server
      await this.streamServer.start();

      const serverPort = this.streamServer.getPort();
      this.logger.info(`✅ TCP server started on port ${serverPort}`);
    } catch (error) {
      // Provide specific error messages for TCP server startup failures
      if (error instanceof Error) {
        if (error.message.includes("EADDRINUSE")) {
          throw new Error(
            `❌ Port ${port} is already in use. Please:\n` +
              `   • Use a different port: --port <other-port>\n` +
              `   • Stop the process using port ${port}: lsof -ti:${port} | xargs kill`
          );
        } else if (error.message.includes("EACCES")) {
          throw new Error(
            `❌ Permission denied for port ${port}. Please:\n` +
              `   • Use a port above 1024: --port <port-above-1024>\n` +
              `   • Run with elevated privileges (not recommended)\n` +
              `   • Use automatic port assignment: --port 0`
          );
        }
      }

      throw new Error(
        `❌ Failed to start TCP server: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private displayConnectionInfo(device: DeviceInfo): void {
    const port = this.streamServer?.getPort();

    console.log("\n" + "=".repeat(60));
    console.log("🎥 Eufy Camera Stream Ready");
    console.log("=".repeat(60));
    console.log(`📹 Camera: ${device.name}`);
    console.log(`🔢 Serial: ${device.serialNumber}`);
    console.log(`📼 Output Format: Raw H.264`);
    console.log(`🎵 Audio: Not supported`);

    if (port) {
      console.log(`🌐 TCP Server: localhost:${port}`);
      console.log("");
      console.log("📺 Connect with media players:");
      console.log("   📹 Raw H.264 Format:");
      console.log(`   ffplay tcp://localhost:${port}`);
      console.log(`   vlc tcp://localhost:${port}`);
    }

    console.log("");
    console.log("ℹ️  Stream will start automatically when a client connects");
    console.log(
      "⏱️  Stream will stop automatically when the last client disconnects"
    );
    console.log("🛑 Press Ctrl+C to stop the streamer");
    console.log("=".repeat(60) + "\n");
  }

  private async keepAlive(): Promise<void> {
    // Keep the process running until shutdown
    return new Promise((resolve) => {
      const checkShutdown = () => {
        if (this.isShuttingDown) {
          resolve();
        } else {
          setTimeout(checkShutdown, 1000);
        }
      };
      checkShutdown();
    });
  }

  private async cleanup(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("🧹 Cleaning up resources...");

    try {
      // Stop TCP server (this will also stop the livestream)
      if (this.streamServer) {
        await this.streamServer.stop();
        this.logger.debug("Stream server stopped");
      }

      // Disconnect client
      if (this.client) {
        await this.client.disconnect();
        this.logger.debug("WebSocket client disconnected");
      }

      this.logger.info("✅ Cleanup completed");
    } catch (error) {
      this.logger.error("❌ Error during cleanup:", error);
    }
  }
}
