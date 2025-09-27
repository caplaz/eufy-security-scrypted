import { BaseCommand } from "./base-command";
import { StreamServer } from "@caplaz/eufy-stream-server";
import { EufySecurityClient } from "@caplaz/eufy-security-client";
import { ParsedArgs, DeviceInfo } from "../interfaces";

/**
 * Device command - handles device-related operations (list, info, stream, monitor)
 */
export class DeviceCommand extends BaseCommand {
  readonly name = "device";
  readonly description = "Manage Eufy Security devices";

  private client?: EufySecurityClient;
  private streamServer?: StreamServer;
  private targetDevice?: DeviceInfo;
  private isShuttingDown = false;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private startTime = new Date();
  private eventCount = 0;
  private lastEventTime?: Date;

  async execute(args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand;

    if (!subcommand) {
      throw new Error(
        "Device command requires a subcommand. Use 'device list', 'device info', 'device stream', or 'device monitor'"
      );
    }

    switch (subcommand) {
      case "list":
        await this.executeList(args);
        break;
      case "info":
        await this.executeInfo(args);
        break;
      case "stream":
        await this.executeStream(args);
        break;
      case "monitor":
        await this.executeMonitor(args);
        break;
      default:
        throw new Error(
          `Unknown device subcommand: ${subcommand}. Valid subcommands: list, info, stream, monitor`
        );
    }
  }

  private async executeList(args: ParsedArgs): Promise<void> {
    let client;

    try {
      this.logger.info("📋 Listing available devices...");

      // Connect to WebSocket server
      client = await this.createClient(args.wsHost);

      // Get all devices with timeout
      const devices: any[] = await this.withTimeout(
        client.getDevices(),
        15000,
        "Timeout while retrieving device list from server"
      );

      if (!devices || devices.length === 0) {
        console.log("\n" + "=".repeat(60));
        console.log("❌ No devices found");
        console.log("=".repeat(60));
        console.log("This could mean:");
        console.log(
          "   • The eufy-security-ws server is not properly configured"
        );
        console.log("   • Your Eufy account has no devices registered");
        console.log(
          "   • The server hasn't successfully connected to Eufy services"
        );
        console.log("");
        console.log("💡 Troubleshooting steps:");
        console.log("   1. Check server logs for connection issues");
        console.log("   2. Verify your Eufy account credentials");
        console.log("   3. Ensure devices are properly set up in the Eufy app");
        console.log("=".repeat(60) + "\n");
        return;
      }

      // Display devices in a formatted table
      this.displayDevices(devices);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("❌")) {
        // Re-throw our custom error messages as-is
        this.logger.error(error.message);
        throw error;
      }

      this.logger.error(
        "❌ Failed to list devices:",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `❌ Failed to retrieve device list: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      // Clean up connection
      if (client) {
        try {
          await client.disconnect();
        } catch (error) {
          this.logger.debug("Error disconnecting client:", error);
        }
      }
    }
  }

  private async executeInfo(args: ParsedArgs): Promise<void> {
    // Validate required arguments
    this.validateRequiredArgs(args, ["cameraSerial"]);

    let client;

    try {
      this.logger.info(
        `ℹ️ Getting device information for: ${args.cameraSerial}`
      );

      // Connect to WebSocket server
      client = await this.createClient(args.wsHost);

      // Find the specific device
      const device = await this.findDevice(client, args.cameraSerial);

      // Get additional device properties if available
      const deviceProperties = await this.getDeviceProperties(
        client,
        args.cameraSerial
      );

      // Display detailed device information
      this.displayDeviceInfo(device, deviceProperties);
    } catch (error) {
      this.logger.error("❌ Failed to get device information:", error);
      throw error;
    } finally {
      // Clean up connection
      if (client) {
        try {
          await client.disconnect();
        } catch (error) {
          this.logger.debug("Error disconnecting client:", error);
        }
      }
    }
  }

  private async executeStream(args: ParsedArgs): Promise<void> {
    // Validate required arguments
    this.validateRequiredArgs(args, ["cameraSerial"]);

    try {
      this.logger.info("🎥 Starting Eufy Camera Stream...");

      // Connect to WebSocket server
      this.client = await this.createClient(args.wsHost);

      // Find target device
      this.targetDevice = await this.findDevice(this.client, args.cameraSerial);
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

  private async executeMonitor(args: ParsedArgs): Promise<void> {
    // Validate required arguments
    this.validateRequiredArgs(args, ["cameraSerial"]);

    try {
      this.logger.info(
        `📊 Starting monitoring for device: ${args.cameraSerial}`
      );

      // Connect to WebSocket server
      this.client = await this.createClient(args.wsHost);

      // Find target device
      const device = await this.findDevice(this.client, args.cameraSerial);
      this.logger.info(
        `📹 Monitoring device: ${device.name} (${device.serialNumber})`
      );

      // Setup event monitoring
      this.setupEventMonitoring();

      // Start periodic status monitoring
      this.startPeriodicMonitoring();

      // Setup graceful shutdown
      this.setupGracefulShutdown(async () => {
        await this.cleanup();
      });

      // Display monitoring information
      this.displayMonitoringInfo(device);

      // Keep the process running
      await this.keepAlive();
    } catch (error) {
      this.logger.error("❌ Monitor command failed:", error);
      await this.cleanup();
      throw error;
    }
  }

  private async findDevice(
    client: any,
    serialNumber: string
  ): Promise<DeviceInfo> {
    this.logger.info(`🔍 Looking for device: ${serialNumber}`);

    try {
      const devices: any[] = await this.withTimeout(
        client.getDevices(),
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

      const device = devices.find((d: any) => d.serialNumber === serialNumber);

      if (!device) {
        // Provide helpful suggestions
        const availableSerials = devices
          .map((d: any) => `${d.name || "Unknown"} (${d.serialNumber})`)
          .slice(0, 5); // Show first 5 devices

        throw new Error(
          `❌ Device not found: ${serialNumber}\n\n` +
            `Available devices:\n${availableSerials
              .map((s: string) => `   • ${s}`)
              .join("\n")}\n\n` +
            `💡 Use 'eufy-security-cli device list --ws-host ${this.context.wsHost}' to see all available devices`
        );
      }

      return {
        name: device.name || "Unknown Device",
        serialNumber: device.serialNumber,
        type: device.type || "Unknown",
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

  private async getDeviceProperties(
    client: any,
    serialNumber: string
  ): Promise<Record<string, any>> {
    try {
      // Try to get additional device properties
      const properties = await client.getDeviceProperties?.(serialNumber);
      return properties || {};
    } catch (error) {
      this.logger.debug("Could not retrieve device properties:", error);
      return {};
    }
  }

  private displayDevices(devices: any[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("📋 Available Eufy Security Devices");
    console.log("=".repeat(80));

    // Convert to our DeviceInfo format
    const deviceInfos: DeviceInfo[] = devices.map((device) => {
      return {
        name: device.name || "Unknown Device",
        serialNumber: device.serialNumber || "Unknown",
        type: device.type || "Unknown",
        stationSerial: device.stationSerial,
        model: device.model,
        hardwareVersion: device.hardwareVersion,
        softwareVersion: device.softwareVersion,
      };
    });

    // Group devices by type
    const devicesByType = deviceInfos.reduce(
      (acc, device) => {
        const type = device.type;
        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(device);
        return acc;
      },
      {} as Record<string, DeviceInfo[]>
    );

    // Display each type group
    Object.entries(devicesByType).forEach(([type, typeDevices]) => {
      console.log(`\n📱 ${type}s (${typeDevices.length}):`);
      console.log("-".repeat(40));

      typeDevices.forEach((device, index) => {
        console.log(`${index + 1}. ${device.name}`);
        console.log(`   Serial: ${device.serialNumber}`);

        if (device.model) {
          console.log(`   Model: ${device.model}`);
        }

        if (device.stationSerial) {
          console.log(`   Station: ${device.stationSerial}`);
        }

        if (device.hardwareVersion) {
          console.log(`   Hardware: ${device.hardwareVersion}`);
        }

        if (device.softwareVersion) {
          console.log(`   Software: ${device.softwareVersion}`);
        }

        console.log("");
      });
    });

    console.log("=".repeat(80));
    console.log(`📊 Total: ${deviceInfos.length} device(s) found`);
    console.log("");

    // Show usage examples
    console.log("💡 Usage Examples:");

    const cameraDevices = deviceInfos.filter(
      (d) =>
        d.type.toLowerCase().includes("camera") ||
        d.type.toLowerCase().includes("doorbell")
    );

    if (cameraDevices.length > 0) {
      const exampleDevice = cameraDevices[0];
      console.log(`   # Stream from ${exampleDevice.name}:`);
      console.log(
        `   eufy-security-cli device stream --ws-host ${this.context.wsHost} --camera-serial ${exampleDevice.serialNumber}`
      );
      console.log("");
      console.log(`   # Get device info for ${exampleDevice.name}:`);
      console.log(
        `   eufy-security-cli device info --ws-host ${this.context.wsHost} --camera-serial ${exampleDevice.serialNumber}`
      );
    }

    console.log("=".repeat(80) + "\n");
  }

  private displayDeviceInfo(
    device: DeviceInfo,
    properties: Record<string, any>
  ): void {
    console.log("\n" + "=".repeat(60));
    console.log("📱 Device Information");
    console.log("=".repeat(60));

    // Basic device information
    console.log("📋 Basic Information:");
    console.log(`   Name: ${device.name}`);
    console.log(`   Serial Number: ${device.serialNumber}`);
    console.log(`   Type: ${device.type}`);

    if (device.model) {
      console.log(`   Model: ${device.model}`);
    }

    if (device.stationSerial) {
      console.log(`   Station Serial: ${device.stationSerial}`);
    }

    // Hardware/Software information
    if (device.hardwareVersion || device.softwareVersion) {
      console.log("\n🔧 Version Information:");

      if (device.hardwareVersion) {
        console.log(`   Hardware Version: ${device.hardwareVersion}`);
      }

      if (device.softwareVersion) {
        console.log(`   Software Version: ${device.softwareVersion}`);
      }
    }

    // Additional properties
    if (Object.keys(properties).length > 0) {
      console.log("\n⚙️ Device Properties:");

      // Group properties by category
      const categorizedProperties = this.categorizeProperties(properties);

      Object.entries(categorizedProperties).forEach(([category, props]) => {
        if (Object.keys(props).length > 0) {
          console.log(`\n   ${category}:`);
          Object.entries(props).forEach(([key, value]) => {
            console.log(`     ${key}: ${this.formatPropertyValue(value)}`);
          });
        }
      });
    }

    // Capabilities and features
    this.displayCapabilities(device, properties);

    // Usage examples
    console.log("\n💡 Usage Examples:");
    console.log(`   # Start streaming:`);
    console.log(
      `   eufy-security-cli device stream --ws-host ${this.context.wsHost} --camera-serial ${device.serialNumber}`
    );
    console.log("");
    console.log(`   # Monitor connection:`);
    console.log(
      `   eufy-security-cli device monitor --ws-host ${this.context.wsHost} --camera-serial ${device.serialNumber}`
    );

    console.log("\n" + "=".repeat(60) + "\n");
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

  private setupEventMonitoring(): void {
    if (!this.client) return;

    // Set up event listeners for device events
    this.client.on("device_event", (event: any) => {
      this.logEvent(event);
    });

    this.client.on("station_event", (event: any) => {
      this.logEvent(event);
    });

    this.logger.debug("Event monitoring setup completed");
  }

  private startPeriodicMonitoring(): void {
    this.isMonitoring = true;

    // Check status every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.performStatusCheck();
    }, 30000);

    this.logger.debug("Periodic monitoring started");
  }

  private performStatusCheck(): void {
    if (!this.isMonitoring || !this.client) return;

    // Log status in verbose mode only
    if (this.context.verbose) {
      this.logger.debug(`📊 Status check at ${new Date().toISOString()}`);
    }
  }

  private logEvent(event: any): void {
    this.eventCount++;
    this.lastEventTime = new Date();

    if (this.context.verbose) {
      this.logger.info(`📢 Event #${this.eventCount}:`, event);
    } else {
      this.logger.info(`📢 Event #${this.eventCount} received`);
    }
  }

  private displayMonitoringInfo(device: DeviceInfo): void {
    console.log("\n" + "=".repeat(60));
    console.log("📊 Device Monitoring Active");
    console.log("=".repeat(60));
    console.log(`📱 Device: ${device.name}`);
    console.log(`🔢 Serial: ${device.serialNumber}`);
    console.log(`⏰ Started: ${this.startTime.toLocaleString()}`);
    console.log(`📊 Events: ${this.eventCount}`);
    console.log("");

    if (this.lastEventTime) {
      console.log(`🕒 Last Event: ${this.lastEventTime.toLocaleString()}`);
      console.log("");
    }

    console.log("🔍 Monitoring:");
    console.log("   • Device connection status");
    console.log("   • Device events and notifications");
    console.log("   • Station events");
    console.log("");

    console.log("📈 Statistics will be updated every 30 seconds");
    console.log("🛑 Press Ctrl+C to stop monitoring");
    console.log("=".repeat(60) + "\n");
  }

  private categorizeProperties(
    properties: Record<string, any>
  ): Record<string, Record<string, any>> {
    const categories: Record<string, Record<string, any>> = {
      Connection: {},
      Video: {},
      Audio: {},
      Power: {},
      Security: {},
      Other: {},
    };

    Object.entries(properties).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();

      if (
        lowerKey.includes("connect") ||
        lowerKey.includes("network") ||
        lowerKey.includes("wifi")
      ) {
        categories["Connection"][key] = value;
      } else if (
        lowerKey.includes("video") ||
        lowerKey.includes("resolution") ||
        lowerKey.includes("fps")
      ) {
        categories["Video"][key] = value;
      } else if (
        lowerKey.includes("audio") ||
        lowerKey.includes("sound") ||
        lowerKey.includes("mic")
      ) {
        categories["Audio"][key] = value;
      } else if (
        lowerKey.includes("battery") ||
        lowerKey.includes("power") ||
        lowerKey.includes("charge")
      ) {
        categories["Power"][key] = value;
      } else if (
        lowerKey.includes("motion") ||
        lowerKey.includes("detect") ||
        lowerKey.includes("alarm")
      ) {
        categories["Security"][key] = value;
      } else {
        categories["Other"][key] = value;
      }
    });

    return categories;
  }

  private formatPropertyValue(value: any): string {
    if (typeof value === "boolean") {
      return value ? "✅ Enabled" : "❌ Disabled";
    }

    if (typeof value === "number") {
      return value.toString();
    }

    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  private displayCapabilities(
    device: DeviceInfo,
    properties: Record<string, any>
  ): void {
    console.log("\n🎯 Device Capabilities:");

    // Determine capabilities based on device type and properties
    const capabilities: string[] = [];

    if (
      device.type.toLowerCase().includes("camera") ||
      device.type.toLowerCase().includes("doorbell")
    ) {
      capabilities.push("📹 Video Streaming");

      if (
        properties.hasAudio ||
        device.type.toLowerCase().includes("doorbell")
      ) {
        capabilities.push("🔊 Audio Recording");
      }

      if (properties.hasMotionDetection !== false) {
        capabilities.push("🚶 Motion Detection");
      }

      if (properties.hasNightVision !== false) {
        capabilities.push("🌙 Night Vision");
      }

      if (device.type.toLowerCase().includes("doorbell")) {
        capabilities.push("🔔 Two-way Audio");
        capabilities.push("🚪 Doorbell Notifications");
      }
    }

    if (capabilities.length > 0) {
      capabilities.forEach((capability) => {
        console.log(`   ${capability}`);
      });
    } else {
      console.log("   ℹ️ Capabilities information not available");
    }
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
    this.isMonitoring = false;

    this.logger.info("🧹 Cleaning up resources...");

    try {
      // Clear monitoring interval
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }

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
