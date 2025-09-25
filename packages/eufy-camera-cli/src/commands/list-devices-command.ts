import { BaseCommand } from "./base-command";
import { ParsedArgs, DeviceInfo } from "../interfaces";

/**
 * List devices command - lists all available camera devices
 */
export class ListDevicesCommand extends BaseCommand {
  readonly name = "list-devices";
  readonly description = "List all available camera devices";

  async execute(args: ParsedArgs): Promise<void> {
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

  private displayDevices(devices: any[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("📋 Available Eufy Security Devices");
    console.log("=".repeat(80));

    // Convert to our DeviceInfo format
    const deviceInfos: DeviceInfo[] = devices.map((device) => ({
      name: device.name || "Unknown Device",
      serialNumber: device.serialNumber || "Unknown",
      type: device.type || "Unknown",
      stationSerial: device.stationSerial,
      model: device.model,
      hardwareVersion: device.hardwareVersion,
      softwareVersion: device.softwareVersion,
    }));

    // Group devices by type
    const devicesByType = deviceInfos.reduce((acc, device) => {
      const type = device.type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(device);
      return acc;
    }, {} as Record<string, DeviceInfo[]>);

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
        `   eufy-camera stream --ws-host ${this.context.wsHost} --camera-serial ${exampleDevice.serialNumber}`
      );
      console.log("");
      console.log(`   # Get device info for ${exampleDevice.name}:`);
      console.log(
        `   eufy-camera device-info --ws-host ${this.context.wsHost} --camera-serial ${exampleDevice.serialNumber}`
      );
    }

    console.log("=".repeat(80) + "\n");
  }
}
