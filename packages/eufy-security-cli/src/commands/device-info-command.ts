import { BaseCommand } from "./base-command";
import { ParsedArgs, DeviceInfo } from "../interfaces";

/**
 * Device info command - shows detailed information about a specific device
 */
export class DeviceInfoCommand extends BaseCommand {
  readonly name = "device-info";
  readonly description = "Show detailed information about a device";

  async execute(args: ParsedArgs): Promise<void> {
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

  private async findDevice(
    client: any,
    serialNumber: string
  ): Promise<DeviceInfo> {
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
            `💡 Use 'eufy-security-cli list-devices --ws-host ${this.context.wsHost}' to see all available devices`
        );
      }

      return {
        name: device.name || "Unknown Device",
        serialNumber: device.serialNumber || "Unknown",
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
      `   eufy-security-cli stream --ws-host ${this.context.wsHost} --camera-serial ${device.serialNumber}`
    );
    console.log("");
    console.log(`   # Monitor connection:`);
    console.log(
      `   eufy-security-cli monitor --ws-host ${this.context.wsHost} --camera-serial ${device.serialNumber}`
    );

    console.log("\n" + "=".repeat(60) + "\n");
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
}
