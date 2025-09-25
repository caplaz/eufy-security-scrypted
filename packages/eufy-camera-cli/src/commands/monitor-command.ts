import { BaseCommand } from "./base-command";
import { ParsedArgs, DeviceInfo } from "../interfaces";

/**
 * Monitor command - monitors camera connection status and events
 */
export class MonitorCommand extends BaseCommand {
  readonly name = "monitor";
  readonly description = "Monitor camera connection status and events";

  private client?: any;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private startTime = new Date();
  private eventCount = 0;
  private lastEventTime?: Date;

  async execute(args: ParsedArgs): Promise<void> {
    // Validate required arguments
    this.validateRequiredArgs(args, ["cameraSerial"]);

    try {
      this.logger.info(
        `📊 Starting monitoring for device: ${args.cameraSerial}`
      );

      // Connect to WebSocket server
      this.client = await this.createClient(args.wsHost);

      // Find target device
      const device = await this.findDevice(args.cameraSerial);
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

  private async findDevice(serialNumber: string): Promise<DeviceInfo> {
    this.logger.info(`🔍 Looking for device: ${serialNumber}`);

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
            `💡 Use 'eufy-camera list-devices --ws-host ${this.context.wsHost}' to see all available devices`
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

  private setupEventMonitoring(): void {
    if (!this.client) return;

    this.logger.info("🎧 Setting up event monitoring...");

    // Monitor connection events
    this.client.on("connected", () => {
      this.logEvent(
        "🟢 WebSocket Connected",
        "Connection established to server"
      );
    });

    this.client.on("disconnected", () => {
      this.logEvent("🔴 WebSocket Disconnected", "Connection lost to server");
    });

    this.client.on("connectionError", (event: any) => {
      this.logEvent(
        "❌ Connection Error",
        `Error: ${event.error?.message || "Unknown error"}`
      );
    });

    // Monitor device events
    this.client.on("deviceEvent", (event: any) => {
      this.logEvent(
        "📱 Device Event",
        `Type: ${event.type}, Data: ${JSON.stringify(event.data)}`
      );
    });

    // Monitor stream events
    this.client.on("streamStarted", (event: any) => {
      this.logEvent("▶️ Stream Started", `Device: ${event.deviceSerial}`);
    });

    this.client.on("streamStopped", (event: any) => {
      this.logEvent("⏹️ Stream Stopped", `Device: ${event.deviceSerial}`);
    });

    this.client.on("streamData", (event: any) => {
      if (this.context.verbose) {
        this.logEvent(
          "📊 Stream Data",
          `Type: ${event.type}, Size: ${event.data?.length || 0} bytes`
        );
      }
    });

    this.client.on("streamError", (event: any) => {
      this.logEvent(
        "❌ Stream Error",
        `Error: ${event.error?.message || "Unknown error"}`
      );
    });

    this.logger.info("✅ Event monitoring configured");
  }

  private startPeriodicMonitoring(): void {
    this.isMonitoring = true;

    this.logger.info("⏰ Starting periodic status monitoring...");

    // Monitor every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.performStatusCheck();
    }, 30000);

    // Perform initial status check
    setTimeout(() => this.performStatusCheck(), 1000);
  }

  private async performStatusCheck(): Promise<void> {
    if (!this.client || !this.isMonitoring) return;

    try {
      // Check connection status
      const isConnected = this.client.isConnected?.() || false;

      // Get current time and uptime
      const now = new Date();
      const uptime = now.getTime() - this.startTime.getTime();

      // Log status update
      if (this.context.verbose) {
        this.logger.info(
          `📊 Status Check - Connected: ${isConnected ? "✅" : "❌"}, ` +
            `Uptime: ${this.formatDuration(uptime)}, ` +
            `Events: ${this.eventCount}, ` +
            `Last Event: ${
              this.lastEventTime
                ? this.formatDuration(
                    now.getTime() - this.lastEventTime.getTime()
                  ) + " ago"
                : "None"
            }`
        );
      }

      // Try to get device status if available
      try {
        const deviceStatus = await this.client.getDeviceStatus?.(
          this.client.targetDevice?.serialNumber
        );
        if (deviceStatus && this.context.verbose) {
          this.logEvent(
            "📊 Device Status",
            JSON.stringify(deviceStatus, null, 2)
          );
        }
      } catch (error) {
        // Device status not available - this is normal for many devices
        this.logger.debug("Device status not available:", error);
      }
    } catch (error) {
      this.logger.error("❌ Status check failed:", error);
    }
  }

  private logEvent(type: string, details: string): void {
    this.eventCount++;
    this.lastEventTime = new Date();

    const timestamp = this.lastEventTime.toISOString();
    console.log(`[${timestamp}] ${type}: ${details}`);

    if (this.context.verbose) {
      this.logger.debug(`Event #${this.eventCount}: ${type} - ${details}`);
    }
  }

  private displayMonitoringInfo(device: DeviceInfo): void {
    console.log("\n" + "=".repeat(60));
    console.log("📊 Eufy Camera Monitor");
    console.log("=".repeat(60));
    console.log(`📹 Device: ${device.name}`);
    console.log(`🔢 Serial: ${device.serialNumber}`);
    console.log(`🕐 Started: ${this.startTime.toISOString()}`);
    console.log("");
    console.log("📡 Monitoring Events:");
    console.log("   • Connection status changes");
    console.log("   • Device events and notifications");
    console.log("   • Stream lifecycle events");
    console.log("   • Error conditions");
    console.log("");
    console.log("ℹ️  Events will be displayed in real-time below");
    console.log("🛑 Press Ctrl+C to stop monitoring");
    console.log("=".repeat(60) + "\n");
  }

  private async keepAlive(): Promise<void> {
    // Keep the process running until shutdown
    return new Promise((resolve) => {
      const checkShutdown = () => {
        if (!this.isMonitoring) {
          resolve();
        } else {
          setTimeout(checkShutdown, 1000);
        }
      };
      checkShutdown();
    });
  }

  private async cleanup(): Promise<void> {
    this.isMonitoring = false;
    this.logger.info("🧹 Stopping monitoring...");

    try {
      // Stop periodic monitoring
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
        this.logger.debug("Periodic monitoring stopped");
      }

      // Disconnect client
      if (this.client) {
        await this.client.disconnect();
        this.logger.debug("WebSocket client disconnected");
      }

      // Display final statistics
      const endTime = new Date();
      const totalUptime = endTime.getTime() - this.startTime.getTime();

      console.log("\n" + "=".repeat(60));
      console.log("📊 Monitoring Session Summary");
      console.log("=".repeat(60));
      console.log(`🕐 Duration: ${this.formatDuration(totalUptime)}`);
      console.log(`📈 Total Events: ${this.eventCount}`);
      console.log(`⏰ Ended: ${endTime.toISOString()}`);
      console.log("=".repeat(60) + "\n");

      this.logger.info("✅ Monitoring cleanup completed");
    } catch (error) {
      this.logger.error("❌ Error during cleanup:", error);
    }
  }
}
