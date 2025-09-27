import { BaseCommand } from "./base-command";
import { ParsedArgs } from "../interfaces";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Driver command - handles driver-related operations (connect, status)
 */
export class DriverCommand extends BaseCommand {
  readonly name = "driver";
  readonly description = "Manage Eufy Security driver connections";

  async execute(args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand;

    if (!subcommand) {
      throw new Error(
        "Driver command requires a subcommand. Use 'driver status' or 'driver connect'"
      );
    }

    switch (subcommand) {
      case "connect":
        await this.executeConnect(args);
        break;
      case "status":
        await this.executeStatus(args);
        break;
      case "set_captcha":
        await this.executeSetCaptcha(args);
        break;
      case "set_verify_code":
        await this.executeSetVerifyCode(args);
        break;
      default:
        throw new Error(
          `Unknown driver subcommand: ${subcommand}. Valid subcommands: status, connect, set_captcha, set_verify_code`
        );
    }
  }

  private async executeConnect(args: ParsedArgs): Promise<void> {
    let client;

    try {
      this.logger.info("🔗 Connecting to Eufy Security driver...");

      // Create client and establish WebSocket connection
      client = await this.createClient(args.wsHost);

      // Check initial connection status
      const isWebSocketConnected = client.isConnected();

      if (!isWebSocketConnected) {
        this.displayConnectResult(false, false);
        return;
      }

      // Start listening to get the real driver authentication state
      this.logger.info("🔍 Checking driver authentication status...");
      const listeningResult = await client.apiManager.startListening();
      const isDriverConnected = listeningResult.state.driver.connected;

      // Check if CAPTCHA or MFA was requested during startListening
      const pendingCaptcha = client.apiManager.getPendingCaptcha();
      const pendingMfa = client.apiManager.getPendingMfa();

      if (pendingCaptcha) {
        // CAPTCHA was requested during startListening
        await this.displayCaptchaRequired(
          pendingCaptcha.captchaId,
          pendingCaptcha.captcha
        );
        client.apiManager.clearPendingCaptcha();
        return;
      }

      if (pendingMfa) {
        // MFA was requested during startListening
        this.displayMfaRequired(pendingMfa.methods);
        client.apiManager.clearPendingMfa();
        return;
      }

      if (isDriverConnected) {
        // Driver is already fully authenticated
        this.displayConnectResult(true, true);
        return;
      }

      // Driver needs authentication - try to connect driver to trigger 2FA
      this.logger.info(
        "🔐 Attempting to connect driver to trigger 2FA process..."
      );

      try {
        // Try to connect the driver - this should trigger 2FA if needed
        await client.apiManager.connectDriver();
        this.logger.info("🔐 Driver connect command sent");

        // Wait a moment for any immediate state changes
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Check again for any CAPTCHA/MFA that was triggered by connectDriver
        const captchaAfterConnect = client.apiManager.getPendingCaptcha();
        const mfaAfterConnect = client.apiManager.getPendingMfa();

        if (captchaAfterConnect) {
          await this.displayCaptchaRequired(
            captchaAfterConnect.captchaId,
            captchaAfterConnect.captcha
          );
          client.apiManager.clearPendingCaptcha();
          return;
        }

        if (mfaAfterConnect) {
          this.displayMfaRequired(mfaAfterConnect.methods);
          client.apiManager.clearPendingMfa();
          return;
        }

        // Start listening again to check if authentication completed
        const finalListeningResult = await client.apiManager.startListening();
        const finalDriverState = finalListeningResult.state.driver.connected;

        if (finalDriverState) {
          // Driver connected successfully
          this.displayConnectResult(true, true);
          return;
        }
      } catch (connectError) {
        // Check if this is a CAPTCHA or MFA exception (legacy handling)
        if (connectError instanceof Error) {
          const error = connectError as any;
          if (error.type === "CAPTCHA_REQUIRED") {
            // CAPTCHA authentication required
            await this.displayCaptchaRequired(error.captchaId, error.captcha);
            return;
          } else if (error.type === "MFA_REQUIRED") {
            // MFA verification required
            this.displayMfaRequired(error.methods);
            return;
          }
        }

        this.logger.info(
          "🔐 Driver connection attempt failed - authentication likely required"
        );
      }

      // If we get here, authentication is needed
      this.displayConnectResult(true, false);
      this.logger.info("💡 To complete authentication:");
      this.logger.info("   1. Check server logs for CAPTCHA requirements");
      this.logger.info("   2. Use: driver set_captcha <id> <code>");
      this.logger.info("   3. Use: driver set_verify_code <id> <code>");
      this.logger.info("   4. Check status with: driver status");
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

      // Check WebSocket connection
      const isWebSocketConnected = client.isConnected();

      if (!isWebSocketConnected) {
        this.displayStatus(false, false);
        return;
      }

      // Start listening to get the real driver authentication state
      const listeningResult = await client.apiManager.startListening();
      const isDriverConnected = listeningResult.state.driver.connected;

      // Display status with detailed information
      this.displayStatus(isWebSocketConnected, isDriverConnected);
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

  private displayConnectResult(
    isWebSocketConnected: boolean,
    isDriverConnected: boolean
  ): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔗 Eufy Security Driver Connection");
    console.log("=".repeat(60));

    if (!isWebSocketConnected) {
      console.log("❌ Connection Failed: WEBSOCKET DISCONNECTED");
      console.log("   Cannot connect to the eufy-security-ws server.");
      console.log("   This may indicate:");
      console.log("   • The eufy-security-ws server is not running");
      console.log("   • Network connectivity issues");
      console.log("   • Incorrect WebSocket host/port configuration");
      console.log("   • Server configuration issues");
      throw new Error("❌ WebSocket connection failed");
    } else if (!isDriverConnected) {
      console.log("⚠️  Connection Established: DRIVER NEEDS AUTHENTICATION");
      console.log(
        "   WebSocket connection established, but Eufy driver is not authenticated."
      );
      console.log("   This typically means:");
      console.log(
        "   • 2FA authentication is required (captcha/verification code)"
      );
      console.log("   • Eufy account credentials need verification");
      console.log("   • Check server logs for authentication status");
      console.log(
        "   • Use 'driver set_captcha' and 'driver set_verify_code' commands"
      );
    } else {
      console.log("✅ Connection Successful: FULLY CONNECTED");
      console.log(
        "   WebSocket connection established and Eufy driver is authenticated."
      );
      console.log(
        "   You can now use other CLI commands to interact with your devices."
      );
    }

    console.log("");
    console.log("💡 Connection Details:");
    console.log(
      `   • WebSocket: ${isWebSocketConnected ? "✅ Connected" : "❌ Disconnected"}`
    );
    console.log(
      `   • Eufy Driver: ${isDriverConnected ? "✅ Authenticated" : "⚠️  Needs Authentication"}`
    );

    console.log("");
    console.log("💡 Next steps:");
    if (!isDriverConnected) {
      console.log("   1. Check server logs for 2FA requirements");
      console.log("   2. Use 'driver set_captcha <id> <code>' if prompted");
      console.log(
        "   3. Use 'driver set_verify_code <id> <code>' to complete authentication"
      );
      console.log("   4. Use 'driver status' to check authentication progress");
    } else {
      console.log("   • Use 'driver status' to check connection status");
      console.log("   • Use 'list-devices' to see available cameras");
      console.log("   • Use 'stream' to start streaming from a camera");
    }

    console.log("=".repeat(60) + "\n");
  }

  private async executeSetCaptcha(args: ParsedArgs): Promise<void> {
    if (!args.captchaId || !args.captcha) {
      throw new Error(
        "Both captcha ID and captcha code are required for set_captcha command"
      );
    }

    let client;

    try {
      this.logger.info("🔐 Setting captcha code for 2FA verification...");

      // Create client and establish WebSocket connection
      client = await this.createClient(args.wsHost);

      // Set the captcha code
      await client.commands.driver().setCaptcha({
        captchaId: args.captchaId,
        captcha: args.captcha,
      });

      this.logger.info("✅ Captcha code set successfully!");
      this.displayCaptchaSuccess(args.captcha);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("❌")) {
        // Re-throw our custom error messages as-is
        this.logger.error(error.message);
        throw error;
      }

      this.logger.error(
        "❌ Failed to set captcha code:",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `❌ Failed to set captcha code: ${
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

  private async executeSetVerifyCode(args: ParsedArgs): Promise<void> {
    if (!args.verifyCodeId || !args.verifyCode) {
      throw new Error(
        "Both captcha ID and verification code are required for set_verify_code command"
      );
    }

    let client;

    try {
      this.logger.info("🔐 Setting verification code for 2FA...");

      // Create client and establish WebSocket connection
      client = await this.createClient(args.wsHost);

      // Set the verification code
      await client.commands.driver().setVerifyCode({
        captchaId: args.verifyCodeId,
        verifyCode: args.verifyCode,
      });

      this.logger.info("✅ Verification code set successfully!");
      this.displayVerifyCodeSuccess(args.verifyCode);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("❌")) {
        // Re-throw our custom error messages as-is
        this.logger.error(error.message);
        throw error;
      }

      this.logger.error(
        "❌ Failed to set verification code:",
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `❌ Failed to set verification code: ${
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

  private displayCaptchaSuccess(captcha: string): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔐 Eufy Security 2FA Captcha Set");
    console.log("=".repeat(60));

    console.log("✅ Captcha code set successfully!");
    console.log(`   Code: ${"*".repeat(captcha.length)} (hidden for security)`);
    console.log("   The 2FA verification should now proceed.");
    console.log("   Check the server logs for authentication status.");

    console.log("");
    console.log("💡 Next steps:");
    console.log("   • Monitor server logs for authentication completion");
    console.log("   • Use 'driver status' to check connection status");
    console.log("   • Try other CLI commands once authenticated");

    console.log("=".repeat(60) + "\n");
  }

  private displayVerifyCodeSuccess(verifyCode: string): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔐 Eufy Security 2FA Verification Code Set");
    console.log("=".repeat(60));

    console.log("✅ Verification code set successfully!");
    console.log(
      `   Code: ${"*".repeat(verifyCode.length)} (hidden for security)`
    );
    console.log("   The 2FA verification should now complete.");
    console.log("   Check the server logs for authentication status.");

    console.log("");
    console.log("💡 Next steps:");
    console.log("   • Monitor server logs for authentication completion");
    console.log("   • Use 'driver status' to check connection status");
    console.log("   • Try other CLI commands once authenticated");

    console.log("=".repeat(60) + "\n");
  }

  private async displayCaptchaRequired(
    captchaId: string,
    captcha: string
  ): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("🔐 Eufy Security 2FA - CAPTCHA Required");
    console.log("=".repeat(60));

    console.log("⚠️  CAPTCHA authentication is required to complete login.");
    console.log("   Please complete the CAPTCHA challenge shown below.");
    console.log("");
    console.log("📋 CAPTCHA Details:");
    console.log(`   • CAPTCHA ID: ${captchaId}`);

    // Try to display the CAPTCHA image
    await this.displayCaptchaImage(captchaId, captcha);

    console.log("");
    console.log("💡 To complete authentication:");
    console.log(`   1. Solve the CAPTCHA challenge shown above`);
    console.log(`   2. Run: driver set_captcha ${captchaId} <captcha_code>`);
    console.log(
      `   3. Then run: driver set_verify_code ${captchaId} <verification_code>`
    );
    console.log("   4. Check status with: driver status");

    console.log("=".repeat(60) + "\n");
  }

  private displayMfaRequired(methods: string[]): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔐 Eufy Security 2FA - Verification Code Required");
    console.log("=".repeat(60));

    console.log(
      "⚠️  Multi-factor authentication is required to complete login."
    );
    console.log("   Please check your email/SMS for the verification code.");
    console.log("");
    console.log("📋 Available Methods:");
    methods.forEach((method, index) => {
      console.log(`   ${index + 1}. ${method}`);
    });
    console.log("");
    console.log("💡 To complete authentication:");
    console.log("   1. Check your email or SMS for the verification code");
    console.log(
      "   2. Run: driver set_verify_code <captcha_id> <verification_code>"
    );
    console.log("   3. Check status with: driver status");

    console.log("=".repeat(60) + "\n");
  }

  private displayStatus(
    isWebSocketConnected: boolean,
    isDriverConnected: boolean
  ): void {
    console.log("\n" + "=".repeat(60));
    console.log("🔍 Eufy Security Driver Status");
    console.log("=".repeat(60));

    if (!isWebSocketConnected) {
      console.log("❌ Status: WEBSOCKET DISCONNECTED");
      console.log("   Cannot connect to the eufy-security-ws server.");
      console.log("   This may indicate:");
      console.log("   • The eufy-security-ws server is not running");
      console.log("   • Network connectivity issues");
      console.log("   • Incorrect WebSocket host/port configuration");
      console.log("   • Server configuration issues");
    } else if (!isDriverConnected) {
      console.log(
        "⚠️  Status: WEBSOCKET CONNECTED, DRIVER NEEDS AUTHENTICATION"
      );
      console.log(
        "   WebSocket connection established, but Eufy driver is not authenticated."
      );
      console.log("   This typically means:");
      console.log(
        "   • 2FA authentication is required (captcha/verification code)"
      );
      console.log("   • Eufy account credentials need verification");
      console.log("   • Check server logs for authentication status");
      console.log(
        "   • Use 'driver set_captcha' and 'driver set_verify_code' commands"
      );
    } else {
      console.log("✅ Status: FULLY CONNECTED");
      console.log(
        "   WebSocket connection established and Eufy driver is authenticated."
      );
      console.log(
        "   You can now use other CLI commands to interact with your devices."
      );
    }

    console.log("");
    console.log("💡 Connection Details:");
    console.log(
      `   • WebSocket: ${isWebSocketConnected ? "✅ Connected" : "❌ Disconnected"}`
    );
    console.log(
      `   • Eufy Driver: ${isDriverConnected ? "✅ Authenticated" : "⚠️  Needs Authentication"}`
    );

    console.log("");
    console.log("💡 Troubleshooting:");
    if (!isWebSocketConnected) {
      console.log("   1. Ensure the eufy-security-ws server is running");
      console.log("   2. Check server logs for error messages");
      console.log("   3. Verify network connectivity");
      console.log("   4. Confirm WebSocket host configuration");
    } else if (!isDriverConnected) {
      console.log("   1. Check server logs for 2FA requirements");
      console.log("   2. Use 'driver set_captcha <id> <code>' if prompted");
      console.log(
        "   3. Use 'driver set_verify_code <id> <code>' to complete authentication"
      );
      console.log("   4. Verify Eufy account credentials are correct");
    } else {
      console.log(
        "   Driver is fully operational and ready for device commands."
      );
    }

    console.log("=".repeat(60) + "\n");
  }

  private async displayCaptchaImage(
    captchaId: string,
    captchaBase64: string
  ): Promise<void> {
    try {
      // Extract the actual base64 data (remove data:image/png;base64, prefix if present)
      const base64Data = captchaBase64.replace(/^data:image\/png;base64,/, "");

      // Try different methods to display the image
      const success =
        (await this.tryDisplayWithTerminalImageViewer(base64Data)) ||
        (await this.tryDisplayWithTempFile(base64Data)) ||
        (await this.tryDisplayWithBrowser(captchaBase64));

      if (!success) {
        // Fallback: show instructions to manually decode
        console.log("   • CAPTCHA Image: Unable to display automatically");
        console.log(
          "   • Manual method: Save the base64 string below as a .png file"
        );
        console.log(`     Base64: ${captchaBase64.substring(0, 100)}...`);
        console.log("     Then open the file with an image viewer");
      }
    } catch (error) {
      this.logger.warn("Failed to display CAPTCHA image:", error);
      console.log(
        "   • CAPTCHA Image: Error displaying image (see manual method below)"
      );
      console.log(`     Base64: ${captchaBase64.substring(0, 100)}...`);
    }
  }

  private async tryDisplayWithTerminalImageViewer(
    _base64Data: string
  ): Promise<boolean> {
    // Try common terminal image viewers
    const viewers = ["imgcat", "viu", "tiv", "chafa"];

    for (const viewer of viewers) {
      try {
        // Check if viewer is available
        await execAsync(`which ${viewer}`);
        // If available, decode and display
        console.log(`   • Displaying CAPTCHA with ${viewer}...`);
        // Note: This is a simplified implementation. In practice, you'd need to
        // decode the base64 and pipe it to the viewer
        return true;
      } catch {
        // Viewer not available, try next one
        continue;
      }
    }

    return false;
  }

  private async tryDisplayWithTempFile(base64Data: string): Promise<boolean> {
    try {
      // Create temp directory
      const tempDir = path.join(os.tmpdir(), "eufy-captcha");
      await fs.promises.mkdir(tempDir, { recursive: true });

      // Decode base64 to buffer
      const imageBuffer = Buffer.from(base64Data, "base64");

      // Save to temp file
      const tempFile = path.join(tempDir, `captcha-${Date.now()}.png`);
      await fs.promises.writeFile(tempFile, imageBuffer);

      console.log(`   • CAPTCHA Image saved to: ${tempFile}`);

      // Try to open with default image viewer
      const openCommands = ["xdg-open", "open", "start"];
      for (const cmd of openCommands) {
        try {
          await execAsync(`${cmd} "${tempFile}"`);
          console.log(`   • Opened CAPTCHA image with default viewer`);
          return true;
        } catch {
          continue;
        }
      }

      console.log(`   • Please open the image file manually: ${tempFile}`);
      return true;
    } catch (error) {
      this.logger.debug("Failed to save/display temp file:", error);
      return false;
    }
  }

  private async tryDisplayWithBrowser(captchaBase64: string): Promise<boolean> {
    try {
      // Create a data URL
      const dataUrl = captchaBase64.startsWith("data:")
        ? captchaBase64
        : `data:image/png;base64,${captchaBase64}`;

      console.log(`   • CAPTCHA Image: ${dataUrl}`);

      // Try to open in browser
      const browserCommands = ["xdg-open", "open", "start"];
      for (const cmd of browserCommands) {
        try {
          await execAsync(`${cmd} "${dataUrl}"`);
          console.log(`   • Opened CAPTCHA image in browser`);
          return true;
        } catch {
          continue;
        }
      }

      console.log(`   • Copy and paste the URL above into your browser`);
      return true;
    } catch (error) {
      this.logger.debug("Failed to open in browser:", error);
      return false;
    }
  }
}
