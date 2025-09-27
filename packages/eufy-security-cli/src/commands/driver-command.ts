import { BaseCommand } from "./base-command";
import { ParsedArgs } from "../interfaces";

/**
 * Driver command - handles driver-related operations (connect, status)
 */
export class DriverCommand extends BaseCommand {
  readonly name = "driver";
  readonly description = "Manage Eufy Security driver connections";

  async execute(args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand;

    if (!subcommand) {
      throw new Error("Driver command requires a subcommand. Use 'driver status' or 'driver connect'");
    }

    switch (subcommand) {
      case "connect":
        await this.executeConnect(args);
        break;
      case "status":
        await this.executeStatus(args);
        break;
      default:
        throw new Error(`Unknown driver subcommand: ${subcommand}. Valid subcommands: status, connect`);
    }
  }

  private async executeConnect(args: ParsedArgs): Promise<void> {
    let client;

    try {
      this.logger.info("🔗 Connecting to Eufy Security driver...");

      // Create client and establish WebSocket connection
      client = await this.createClient(args.wsHost);

      // The driver connection is already established by client.connect()
      // but let's verify and log it explicitly
      this.logger.info("🔗 Verifying driver connection...");

      // Verify connection is established
      const isConnected = client.isConnected();

      if (isConnected) {
        this.displayConnectSuccess();
      } else {
        throw new Error(
          "Connection established but driver reports as disconnected"
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("❌")) {
        // Re-throw our custom error messages as-is
        this.logger.error(error.message);
        throw error;
      }

      this.logger.error(
        "❌ Failed to connect to driver:",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `❌ Failed to connect to driver: ${
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

  private async executeStatus(args: ParsedArgs): Promise<void> {
    let client;

    try {
      this.logger.info("🔍 Checking driver connection status...");

      // Connect to WebSocket server
      client = await this.createClient(args.wsHost);

      // Check if driver is connected
      const isConnected = client.isConnected();

      // Display status
      this.displayStatus(isConnected);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("❌")) {
        // Re-throw our custom error messages as-is
        this.logger.error(error.message);
        throw error;
      }

      this.logger.error(
        "❌ Failed to check driver status:",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `❌ Failed to check driver status: ${
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

  private displayConnectSuccess(): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔗 Eufy Security Driver Connection");
    console.log("=".repeat(60));

    console.log("✅ Successfully connected to Eufy Security driver!");
    console.log("   Connection established and verified.");
    console.log("   The driver is ready to accept commands.");

    console.log("");
    console.log("💡 Next steps:");
    console.log("   • Use 'driver status' to check connection status");
    console.log("   • Use 'list-devices' to see available cameras");
    console.log("   • Use 'stream' to start streaming from a camera");

    console.log("=".repeat(60) + "\n");
  }

  private displayStatus(isConnected: boolean): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔍 Eufy Security Driver Status");
    console.log("=".repeat(60));

    if (isConnected) {
      console.log("✅ Status: CONNECTED");
      console.log(
        "   The Eufy Security driver is successfully connected and ready."
      );
      console.log(
        "   You can now use other CLI commands to interact with your devices."
      );
    } else {
      console.log("❌ Status: DISCONNECTED");
      console.log("   The Eufy Security driver is not connected.");
      console.log("   This may indicate:");
      console.log("   • The eufy-security-ws server is not running");
      console.log("   • Network connectivity issues");
      console.log("   • Authentication problems with Eufy services");
      console.log("   • Server configuration issues");
    }

    console.log("");
    console.log("💡 Troubleshooting:");
    if (!isConnected) {
      console.log("   1. Ensure the eufy-security-ws server is running");
      console.log("   2. Check server logs for error messages");
      console.log("   3. Verify network connectivity");
      console.log("   4. Confirm Eufy account credentials are correct");
    } else {
      console.log("   Driver is functioning normally.");
    }

    console.log("=".repeat(60) + "\n");
  }
}
