/**
 * Eufy Security Provider for Scrypted
 *
 * Main entry point for the Eufy Security Scrypted plugin. This class serves as the
 * central coordinator for all Eufy device interactions within the Scrypted ecosystem.
 *
 * Core Responsibilities:
 * - WebSocket connection management to eufy-security-ws server
 * - Device discovery and automatic registration with Scrypted
 * - Station management and device hierarchy maintenance
 * - Authentication handling (captcha, 2FA) with user-friendly UI
 * - Memory management coordination across all devices
 * - Settings management with real-time status monitoring
 * - Driver connection lifecycle management
 *
 * Architecture:
 * - Implements Scrypted's DeviceProvider interface for device management
 * - Implements Settings interface for configuration UI
 * - Implements Refresh interface for connection health monitoring
 * - Uses singleton MemoryManager for system-wide resource coordination
 * - Provides centralized logging and debug control
 *
 * The provider automatically handles the complex authentication flow required
 * by Eufy's cloud services, including captcha challenges and 2FA verification,
 * presenting a user-friendly interface through Scrypted's settings system.
 *
 * @implements {DeviceProvider}
 * @implements {Settings}
 * @implements {Refresh}
 * @public
 * @since 1.0.0
 */

import sdk, {
  DeviceProvider,
  Refresh,
  ScryptedDeviceBase,
  ScryptedInterface,
  ScryptedNativeId,
  Setting,
  SettingValue,
  Settings,
} from "@scrypted/sdk";
import {
  EufyWebSocketClient,
  StartListeningResponse,
} from "@caplaz/eufy-security-client";
import { Logger } from "tslog";
import { EufyStation } from "./eufy-station";
import {
  createDebugLogger,
  initializeDebugLogger,
  setDebugEnabled,
} from "./utils/debug-logger";
import { DeviceUtils } from "./utils/device-utils";
import { MemoryManager } from "./utils/memory-manager";

const { deviceManager } = sdk;

export class EufySecurityProvider
  extends ScryptedDeviceBase
  implements DeviceProvider, Settings, Refresh
{
  private wsClient: EufyWebSocketClient;
  private stations = new Map<string, EufyStation>();
  private debugLogging: boolean = false;
  private logger = createDebugLogger("Provider");
  private wsLogger: Logger<any>;
  private pushConnected: boolean = false;
  private mqttConnected: boolean = false;

  /**
   * Construct a new EufySecurityProvider.
   * @param nativeId - Optional Scrypted nativeId for the provider.
   */
  constructor(nativeId?: string) {
    super(nativeId);

    // Initialize system memory threshold from storage
    const memoryThreshold = Math.max(
      50,
      parseInt(this.storage.getItem("memoryThresholdMB") || "120")
    );
    MemoryManager.setMemoryThreshold(memoryThreshold, this.logger);

    // Initialize the global debug logger with this provider's console
    this.debugLogging = this.storage.getItem("debugLogging") === "true";
    initializeDebugLogger(this.console, this.debugLogging);

    // Create a logger for the WebSocket client
    this.wsLogger = new Logger({
      name: "EufyWebSocketClient",
      minLevel: this.debugLogging ? 0 : 3, // 0 = silly, 3 = info
    });

    this.wsClient = new EufyWebSocketClient(
      this.storage.getItem("wsUrl") || "ws://localhost:3000",
      this.wsLogger
    );

    // Set up captcha event handling
    this.setupCaptchaHandling();

    this.logger.i("🚀 EufySecurityProvider initialized");

    // Start connection automatically
    this.startConnection().catch((error) => {
      this.logger.e("❌ Failed to start connection:", error);
    });
  }

  /**
   * Get the settings for this provider.
   * @returns {Promise<Setting[]>} Array of Scrypted Setting objects.
   */
  async getSettings(): Promise<Setting[]> {
    // Get current client state for monitoring
    const clientState = this.wsClient.getState();

    // Get some additional status information
    const memoryThreshold = MemoryManager.getMemoryThreshold();
    const currentMemory = Math.round(process.memoryUsage().rss / 1024 / 1024);

    // Check if we have pending captcha
    const hasPendingCaptcha = !!this.storage.getItem("currentCaptchaId");
    const captchaStatus = hasPendingCaptcha
      ? "🔐 Captcha required - check settings below"
      : clientState?.driverConnected
        ? "✅ No captcha required"
        : "⚠️ Authentication needed - check server logs for details";

    return [
      // WebSocket Server Connection Settings
      {
        group: "WebSocket Server Connection",
        key: "wsUrl",
        title: "WebSocket URL",
        description: "URL of the eufy-security-ws container",
        value: this.storage.getItem("wsUrl") || "ws://localhost:3000",
        placeholder: "ws://localhost:3000",
      },
      {
        group: "WebSocket Server Connection",
        key: "debugLogging",
        title: "Debug Logging",
        description: "Enable verbose logging for troubleshooting",
        value: this.debugLogging,
        type: "boolean",
        immediate: true, // Apply immediately without restart
      },

      // Memory Management Settings
      {
        group: "Memory Management",
        key: "currentMemoryMB",
        title: "Current Memory Usage",
        description: `Current RSS memory usage vs threshold (${memoryThreshold}MB)`,
        value: `${currentMemory}MB ${currentMemory > memoryThreshold ? "⚠️" : "✅"}`,
        type: "string",
        readonly: true,
      },
      {
        group: "Memory Management",
        key: "memoryThresholdMB",
        title: "Memory Threshold (MB)",
        description:
          "System-wide memory threshold for buffer cleanup across all devices (default: 120MB)",
        type: "number",
        value: parseInt(this.storage.getItem("memoryThresholdMB") || "120"),
      },

      // Eufy Cloud Account Settings
      {
        group: "Eufy Cloud Account",
        key: "driverConnectionStatus",
        title: "Account Connection Status",
        description: "Current Eufy cloud account connection state",
        value: clientState?.driverConnected
          ? "🟢 Connected"
          : "🔴 Disconnected",
        type: "string",
        readonly: true,
      },
      {
        group: "Eufy Cloud Account",
        key: "pushConnectionStatus",
        title: "Push Notifications",
        description: "Push notification connection status",
        value: this.pushConnected ? "🟢 Connected" : "🔴 Disconnected",
        type: "string",
        readonly: true,
      },
      {
        group: "Eufy Cloud Account",
        key: "mqttConnectionStatus",
        title: "MQTT Connection",
        description: "MQTT connection status for real-time updates",
        value: this.mqttConnected ? "🟢 Connected" : "🔴 Disconnected",
        type: "string",
        readonly: true,
      },
      {
        group: "Eufy Cloud Account",
        key: "captchaStatus",
        title: "Authentication Status",
        description: "Current authentication/captcha status",
        value: captchaStatus,
        type: "string",
        readonly: true,
      },
      // Dynamic connect/disconnect buttons based on connection status
      ...(clientState?.driverConnected
        ? [
            {
              group: "Eufy Cloud Account",
              key: "disconnectDriver",
              title: "Disconnect from Eufy Cloud",
              description: "Disconnect from Eufy cloud services",
              value: "Disconnect Account",
              type: "button" as const,
            },
          ]
        : [
            {
              group: "Eufy Cloud Account",
              key: "connectDriver",
              title: "Connect to Eufy Cloud",
              description: "Establish connection to Eufy cloud services",
              value: "Connect Account",
              type: "button" as const,
            },
          ]),
      // Enhanced captcha display and input controls (only show when a captcha is present)
      ...(this.storage.getItem("currentCaptchaImage")
        ? [
            {
              group: "Eufy Cloud Account",
              key: "captchaImageDisplay",
              title: "Current Captcha",
              description: "Visual captcha challenge",
              value: (() => {
                const captchaData = this.storage.getItem(
                  "currentCaptchaImage"
                )!;
                const version =
                  this.storage.getItem("currentCaptchaImageVersion") || "";
                const imageSrc = captchaData.startsWith("data:")
                  ? captchaData
                  : `data:image/png;base64,${captchaData}`;
                return `<div style="text-align: center; margin: 10px 0;">
            <img src="${imageSrc}" 
                 style="max-width: 300px; border: 2px solid #ddd; border-radius: 8px; background: white;" 
                 alt="Captcha Image" />
            <div style="margin-top: 8px; font-size: 12px; color: #666;">
              Enter the characters shown above in the \"Captcha Code\" field
            </div>
            <div style="display:none" data-captcha-version="${version}"></div>
          </div>`;
              })(),
              type: "html" as const,
              readonly: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "captchaInput",
              title: "Captcha Code",
              description: "Enter captcha code when prompted during login",
              value: this.storage.getItem("pendingCaptcha") || "",
              placeholder: "Enter captcha code...",
              type: "string" as const,
              immediate: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "submitCaptcha",
              title: "Submit Captcha",
              description: "Submit the entered captcha code",
              value: "Submit Captcha",
              type: "button" as const,
            },
          ]
        : []),
      // Show 2FA controls only when MFA is pending
      ...(this.storage.getItem("mfaPending") ||
      this.storage.getItem("currentCaptchaId")
        ? [
            {
              group: "Eufy Cloud Account",
              key: "verifyCodeInput",
              title: "2FA Verification Code",
              description: "Enter 2FA verification code when prompted",
              value: this.storage.getItem("pendingVerifyCode") || "",
              placeholder: "Enter 6-digit code...",
              type: "string" as const,
              immediate: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "submitVerifyCode",
              title: "Submit 2FA Code",
              description: "Submit the entered 2FA verification code",
              value: "Submit 2FA Code",
              type: "button" as const,
            },
            {
              group: "Eufy Cloud Account",
              key: "requestVerifyCode",
              title: "Request New 2FA Code",
              description: "Request a new 2FA verification code to be sent",
              value: "Request New Code",
              type: "button" as const,
            },
          ]
        : []),

      // WebSocket Server Status Monitoring (Read-only) - Complete ClientState interface data
      {
        group: "WebSocket Server Status",
        key: "connectionState",
        title: "Connection State",
        description: "Current connection lifecycle state",
        value: `${this.getConnectionStateIcon(clientState?.connection)} ${
          clientState?.connection || "Unknown"
        }`,
        type: "string" as const,
        readonly: true,
      },
      {
        group: "WebSocket Server Status",
        key: "wsConnected",
        title: "WebSocket Connected",
        description: "Whether WebSocket connection is established",
        value: clientState?.wsConnected ? "🟢 Connected" : "🔴 Disconnected",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "WebSocket Server Status",
        key: "schemaSetupComplete",
        title: "Schema Setup Complete",
        description: "Whether API schema negotiation is complete",
        value: clientState?.schemaSetupComplete ? "✅ Complete" : "⏳ Pending",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "WebSocket Server Status",
        key: "schemaInfo",
        title: "Schema Negotiation",
        description: "API version compatibility and negotiation results",
        value: clientState?.schemaInfo
          ? `v${clientState.schemaInfo.negotiatedSchema} (compatible: ${
              clientState.schemaInfo.isCompatible ? "✅" : "❌"
            })`
          : "Not negotiated",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "WebSocket Server Status",
        key: "lastError",
        title: "Last Error",
        description: "Most recent error that occurred, if any",
        value: clientState?.lastError
          ? `❌ ${clientState.lastError.message}`
          : "✅ None",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "WebSocket Server Status",
        key: "reconnectAttempts",
        title: "Reconnect Attempts",
        description: "Number of reconnection attempts made",
        value: clientState?.reconnectAttempts || 0,
        type: "number" as const,
        readonly: true,
      },
      {
        group: "WebSocket Server Status",
        key: "eventListenerCount",
        title: "Event Listeners",
        description: "Number of registered event listeners",
        value: clientState?.eventListenerCount || 0,
        type: "number" as const,
        readonly: true,
      },
    ];
  }

  /**
   * Update a setting for this provider.
   * @param key - Setting key to update.
   * @param value - New value for the setting.
   * @returns {Promise<void>}
   */
  async putSetting(key: string, value: SettingValue): Promise<void> {
    // Debug logging for all putSetting calls
    this.logger.i(
      `🎛️ putSetting: key="${key}", value="${value}", type=${typeof value}`
    );

    // Handle button clicks (they can have null values)
    if (key === "connectDriver") {
      this.logger.i("🔗 Button clicked: Connect to Eufy cloud");

      // Check client state before connection
      const beforeState = this.wsClient.getState();
      this.logger.i("📊 Client state before connect:", beforeState);

      let client;

      try {
        this.logger.i("🔗 Connecting to Eufy Security driver...");

        // Use the existing WebSocket client for auth operations instead of creating a new one
        const client = this.wsClient;

        // Check if WebSocket is connected
        const isWebSocketConnected = client.isConnected();

        if (!isWebSocketConnected) {
          this.displayConnectResult(false, false);
          return;
        }

        // Start listening to get the real driver authentication state
        this.logger.i("🔍 Checking driver authentication status...");
        const listeningResult = await client.startListening();
        const isDriverConnected = listeningResult.state.driver.connected;

        // Get additional connection status information
        this.logger.d("🔍 Checking detailed connection status...");
        const pushResponse = await client.commands.driver().isPushConnected();
        const mqttResponse = await client.commands.driver().isMqttConnected();

        // Store the connection status for settings display
        this.pushConnected = pushResponse.connected;
        this.mqttConnected = mqttResponse.connected;

        this.logger.i(
          `📊 Connection status: Driver=${isDriverConnected}, Push=${this.pushConnected}, MQTT=${this.mqttConnected}`
        );

        // Check if CAPTCHA or MFA was requested during startListening
        const pendingCaptcha = client.getPendingCaptcha();
        const pendingMfa = client.getPendingMfa();

        this.logger.d(
          `🔍 After startListening - Captcha: ${!!pendingCaptcha}, MFA: ${!!pendingMfa}`
        );

        if (pendingCaptcha) {
          // CAPTCHA was requested during startListening
          this.logger.i("🔐 CAPTCHA detected after startListening");
          await this.displayCaptchaRequired(
            pendingCaptcha.captchaId,
            pendingCaptcha.captcha
          );
          client.clearPendingCaptcha();
          return;
        }

        if (pendingMfa) {
          // MFA was requested during startListening
          // Mark MFA pending so settings will show the verification controls
          this.storage.setItem("mfaPending", "true");
          this.displayMfaRequired(pendingMfa);
          client.clearPendingMfa();
          return;
        }

        if (isDriverConnected) {
          // Driver is already fully authenticated
          this.displayConnectResult(true, true);
          return;
        }

        // Driver needs authentication - try to connect driver to trigger 2FA
        this.logger.i(
          "🔐 Attempting to connect driver to trigger 2FA process..."
        );

        try {
          // Try to connect the driver - this should trigger 2FA if needed
          await client.commands.driver().connect();
          this.logger.i("🔐 Driver connect command sent");

          // Wait a moment for any immediate state changes
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // Check again for any CAPTCHA/MFA that was triggered by connectDriver
          const captchaAfterConnect = client.getPendingCaptcha();
          const mfaAfterConnect = client.getPendingMfa();

          this.logger.d(
            `🔍 After connect - Captcha: ${!!captchaAfterConnect}, MFA: ${!!mfaAfterConnect}`
          );

          if (captchaAfterConnect) {
            this.logger.i("🔐 CAPTCHA detected after connect command");
            await this.displayCaptchaRequired(
              captchaAfterConnect.captchaId,
              captchaAfterConnect.captcha
            );
            client.clearPendingCaptcha();
            return;
          }

          if (mfaAfterConnect) {
            this.storage.setItem("mfaPending", "true");
            this.displayMfaRequired(mfaAfterConnect);
            client.clearPendingMfa();
            return;
          }

          // Start listening again to check if authentication completed
          const finalListeningResult = await client.startListening();
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
              this.displayMfaRequired({ methods: error.methods });
              return;
            }
          }

          this.logger.i(
            "🔐 Driver connection attempt failed - authentication likely required"
          );
        }

        // If we get here, authentication is needed
        this.displayConnectResult(true, false);
        this.logger.i("💡 To complete authentication:");
        this.logger.i("   1. Check the settings page for CAPTCHA requirements");
        this.logger.i("   2. Use the CAPTCHA input field if prompted");
        this.logger.i("   3. Use the 2FA verification code field");
        this.logger.i("   4. Check status with the connection status display");
        this.logger.i(
          "   5. If no CAPTCHA appears, the account may need different authentication"
        );
        this.logger.i(
          "      Try checking the eufy-security-ws server logs for more details"
        );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("❌")) {
          // Re-throw our custom error messages as-is
          this.logger.e(error.message);
          throw error;
        }

        this.logger.e(
          "❌ Failed to connect to driver:",
          error instanceof Error ? error.message : String(error)
        );
        throw new Error(
          `❌ Failed to connect to driver: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      } finally {
        // Clean up connection - only if we created a separate client (not using existing wsClient)
        // Since we're now using the existing wsClient, no cleanup needed here
      }

      // Refresh the settings UI to show updated connection state
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    if (key === "disconnectDriver") {
      this.logger.i("🔌 Button clicked: Disconnect from Eufy cloud");
      try {
        await this.wsClient.commands.driver().disconnect();
        this.logger.i("✅ Driver disconnected successfully");

        // Refresh the settings UI to show updated connection state
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.logger.e("❌ Failed to disconnect driver:", error);

        // Refresh the settings UI even on error to show any state changes
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    // Buttons may send a null value; handle submit actions here before the
    // generic null/undefined early-return below so button clicks are processed.
    if (key === "submitCaptcha") {
      // It's common for the input field update to arrive slightly after the
      // button click (race). Poll briefly for the stored pending captcha so
      // the submit works even if the input putSetting arrives just after.
      let captchaCode = this.storage.getItem("pendingCaptcha");
      const captchaId = this.storage.getItem("currentCaptchaId");

      if (!captchaCode) {
        // Wait up to 500ms, checking every 50ms
        for (let i = 0; i < 10 && !captchaCode; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          captchaCode = this.storage.getItem("pendingCaptcha");
        }
      }

      if (!captchaCode || !captchaId) {
        this.logger.w("⚠️ No captcha code or captcha ID available");
        throw new Error(
          "Please enter a captcha code first, or no captcha was requested"
        );
      }

      this.logger.i("📝 Submitting captcha code...");
      try {
        await this.wsClient.commands.driver().setCaptcha({
          captchaId,
          captcha: captchaCode,
        });
        this.logger.i("✅ Captcha submitted successfully");
        // Clear stored captcha data
        this.storage.removeItem("pendingCaptcha");
        this.storage.removeItem("currentCaptchaId");
        this.storage.removeItem("currentCaptchaImage");
        // Clear MFA pending flag as the flow progresses
        this.storage.removeItem("mfaPending");
        // Clear version/token so settings HTML will update to removed state
        this.storage.removeItem("currentCaptchaImageVersion");

        // After successful captcha submission, check if MFA is now required or if driver connected
        this.logger.d(
          "🔍 Checking authentication status after captcha submission..."
        );
        const postCaptchaMfa = this.wsClient.getPendingMfa();
        if (postCaptchaMfa) {
          this.logger.i("🔐 MFA required after captcha submission");
          this.storage.setItem("mfaPending", "true");
          this.displayMfaRequired(postCaptchaMfa);
          this.wsClient.clearPendingMfa();
          return; // Don't refresh UI yet, displayMfaRequired will do it
        }

        // Check if driver is now connected after captcha
        const listeningResult = await this.wsClient.startListening();
        if (listeningResult.state.driver.connected) {
          this.logger.i("✅ Driver connected successfully after captcha");
          this.displayConnectResult(true, true);
          return; // Don't refresh UI, displayConnectResult handles it
        }

        // If we get here, authentication may still be incomplete
        this.logger.w(
          "⚠️ Captcha submitted but authentication not complete - may need MFA or additional steps"
        );

        // Refresh the settings UI to remove captcha display
        this.logger.d("ℹ️ Triggering settings refresh after captcha submit");
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);

        // Some Scrypted UI instances may miss a single event during rapid
        // state changes; trigger a second refresh shortly after to be sure.
        setTimeout(() => {
          this.logger.d(
            "ℹ️ Triggering delayed settings refresh (post-captcha)"
          );
          try {
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          } catch (e) {
            this.logger.w("⚠️ Delayed settings refresh failed:", e);
          }
        }, 200);
      } catch (error) {
        this.logger.e("❌ Failed to submit captcha:", error);

        // Refresh the settings UI even on error
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    if (key === "requestVerifyCode") {
      this.logger.i("🔄 Button clicked: Request new 2FA verification code");
      try {
        // Try to re-trigger the MFA process by calling connect again
        // This may cause the server to send a new verification code
        await this.wsClient.commands.driver().connect();
        this.logger.i("✅ Requested new 2FA verification code");

        // Check if new MFA info is available
        const newMfa = this.wsClient.getPendingMfa();
        if (newMfa) {
          this.displayMfaRequired(newMfa);
          this.wsClient.clearPendingMfa();
        }

        // Refresh the settings UI
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.logger.e("❌ Failed to request new 2FA code:", error);

        // Refresh the settings UI even on error
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    if (key === "submitVerifyCode") {
      // Allow a short window for the verification input to be stored if the
      // button click races the input update (same poll approach as captcha)
      let verifyCode = this.storage.getItem("pendingVerifyCode");
      if (!verifyCode) {
        for (let i = 0; i < 10 && !verifyCode; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          verifyCode = this.storage.getItem("pendingVerifyCode");
        }
      }

      if (!verifyCode) {
        this.logger.w("⚠️ No verification code available");
        throw new Error("Please enter a 2FA verification code first");
      }

      this.logger.i("🔐 Submitting 2FA verification code...");
      try {
        const captchaId = this.storage.getItem("currentCaptchaId");
        this.logger.i(`🔍 Using captchaId: ${captchaId} for 2FA submission`);
        if (!captchaId) {
          this.logger.w(
            "⚠️ No captchaId available for 2FA - this may be expected for MFA-only flows"
          );
          // For MFA-only flows, we might not have a captchaId
          // Let's try without it or see if we can get it from the client
        }

        await this.wsClient.commands.driver().setVerifyCode({
          captchaId: captchaId || "",
          verifyCode,
        });
        this.logger.i("✅ 2FA verification code submitted successfully");
        // Clear stored verification code
        this.storage.removeItem("pendingVerifyCode");
        // Clear MFA pending flag on successful verification
        this.storage.removeItem("mfaPending");

        // Refresh the settings UI
        this.logger.d(
          "ℹ️ Triggering settings refresh after verify-code submit"
        );
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);

        // Delayed refresh as well to ensure UI picks up the change
        setTimeout(() => {
          this.logger.d("ℹ️ Triggering delayed settings refresh (post-verify)");
          try {
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          } catch (e) {
            this.logger.w("⚠️ Delayed settings refresh failed:", e);
          }
        }, 200);
      } catch (error) {
        this.logger.e("❌ Failed to submit 2FA verification code:", error);
        this.logger.e("❌ Error details:", JSON.stringify(error, null, 2));
        // Refresh the settings UI even on error
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    // Handle regular settings (require non-null values)
    if (value === undefined || value === null) {
      this.logger.w(
        `⚠️ Ignoring setting update for ${key}: value is null/undefined`
      );
      return;
    }

    // Store the setting value
    this.storage.setItem(key, value.toString());

    if (key === "wsUrl") {
      try {
        // Reconnect with new URL
        this.wsClient.disconnect();
        this.wsClient = new EufyWebSocketClient(
          value.toString(),
          this.wsLogger
        );
        await this.startConnection();
        this.logger.i("✅ Reconnected with new WebSocket URL");
      } catch (error) {
        this.logger.e("❌ Failed to connect with new WebSocket URL:", error);
        throw error;
      }
    } else if (key === "debugLogging") {
      // Handle boolean conversion more robustly
      const newDebugValue =
        value === true || value === "true" || value === 1 || value === "1";
      this.debugLogging = newDebugValue;

      // Update global debug setting immediately
      setDebugEnabled(this.debugLogging);

      // Update WebSocket logger level
      this.wsLogger.settings.minLevel = this.debugLogging ? 0 : 3;

      // Update the stored value
      this.storage.setItem("debugLogging", this.debugLogging.toString());

      this.logger.i(
        `✅ Debug logging ${this.debugLogging ? "enabled" : "disabled"} (immediate)`
      );

      // Refresh the settings UI to reflect the immediate change
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    } else if (key === "memoryThresholdMB") {
      const memMB = Math.max(50, parseInt(value as string) || 120);
      this.storage.setItem("memoryThresholdMB", memMB.toString());
      // Update the MemoryManager singleton directly
      MemoryManager.setMemoryThreshold(memMB, this.logger);
      this.logger.i(`✅ Memory threshold updated to ${memMB}MB system-wide`);

      // Refresh the settings UI to indicate successful save
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }
    // Handle captcha and 2FA inputs
    else if (key === "captchaInput") {
      // Store the captcha input for later submission
      this.storage.setItem("pendingCaptcha", value as string);
      this.logger.d("✅ Captcha input stored");
    } else if (key === "verifyCodeInput") {
      // Store the verification code input for later submission
      const verifyValue = (value as string) || "";
      this.storage.setItem("pendingVerifyCode", verifyValue);
      this.logger.d("✅ 2FA verification code input stored", verifyValue);
    } else {
      // Unknown setting key - this is not necessarily an error
      this.logger.d(`ℹ️ Setting updated: ${key} = ${value}`);
    }

    // Successfully saved setting
    this.logger.i(`✅ Setting "${key}" saved successfully`);
  }

  /**
   * Get the refresh frequency for this provider.
   * @returns {Promise<number>} Refresh interval in ms.
   */
  async getRefreshFrequency(): Promise<number> {
    return 300; // 5 minutes
  }

  /**
   * Refresh the provider (connection health check).
   * @returns {Promise<void>}
   */
  async refresh(): Promise<void> {
    this.logger.d("🔄 Connection health check");

    if (!this.wsClient.isConnected()) {
      this.logger.w("⚠️ WebSocket not connected, attempting to reconnect...");
      try {
        await this.startConnection();
        this.logger.i("✅ Successfully reconnected");
      } catch (error) {
        this.logger.e("❌ Failed to reconnect:", error);
        throw error;
      }
    } else {
      this.logger.d("✅ WebSocket connection healthy");
    }
  }

  /**
   * Get or create a device (station or child device) by nativeId.
   * @param nativeId - Scrypted nativeId for the device.
   * @returns {Promise<EufyStation | any | undefined>} The device instance or undefined if not found.
   */
  async getDevice(nativeId: ScryptedNativeId): Promise<any> {
    // Wait for client to be ready on restore (schema negotiation, etc.)
    await this.waitForClientReady();

    // Check if driver is connected before creating devices
    const clientState = this.wsClient.getState();
    if (!clientState.driverConnected) {
      this.logger.w(
        `⚠️ Driver not connected, cannot create device ${nativeId}`
      );
      return undefined;
    }

    if (nativeId && nativeId.startsWith("station_")) {
      this.logger.d(`Getting station ${nativeId}`);

      // Return existing station or create new EufyStation
      let station = this.stations.get(nativeId);
      if (!station) {
        station = new EufyStation(nativeId, this.wsClient);
        this.stations.set(nativeId, station);
        this.logger.i(`Created new station ${nativeId}`);
      }
      return station;
    }
    return undefined;
  }

  /**
   * Release a device (station or child device) by nativeId.
   * @param id - Device id (unused).
   * @param nativeId - Scrypted nativeId for the device.
   * @returns {Promise<void>}
   */
  async releaseDevice(id: string, nativeId: string): Promise<void> {
    // Handle station release
    if (nativeId.startsWith("station_")) {
      const station = this.stations.get(nativeId);
      if (station) {
        station.dispose();
        this.stations.delete(nativeId);
        this.logger.i(`🗑️ Released station ${nativeId}`);
      }
    }
  }

  /**
   * Start the WebSocket connection and register stations/devices from server state.
   * @returns {Promise<void>}
   */
  private async startConnection(): Promise<void> {
    await this.wsClient.connect();

    // Wait for client to be ready (schema negotiation, etc.)
    await this.waitForClientReady();

    const serverState: StartListeningResponse =
      await this.wsClient.startListening();

    this.logger.d(
      "🔍 Raw startListening response:",
      JSON.stringify(serverState, null, 2)
    );

    // Only register stations and devices if the driver is connected
    if (serverState.state.driver.connected) {
      // Register stations and devices from server state
      // IMPORTANT: Register stations first so they exist as parents for devices
      await this.registerStationsFromServerState(serverState);
      await this.registerDevicesFromServerState(serverState);
    } else {
      this.logger.w("⚠️ Driver not connected, skipping device registration");
    }
  }

  /**
   * Register stations from the server state.
   * @param serverState - StartListeningResponse from the server.
   * @returns {Promise<void>}
   */
  private async registerStationsFromServerState(
    serverState: StartListeningResponse
  ): Promise<void> {
    // Extract station serial numbers from server state (string array)
    const stationSerials: string[] = serverState.state.stations || [];
    this.logger.i(
      `📡 Found ${stationSerials.length} station serials from server:`,
      stationSerials
    );

    if (stationSerials.length === 0) {
      this.logger.w("⚠️ No stations found in server state");
      return;
    }

    // Create manifests for each station serial number
    const manifests = stationSerials.map(async (stationSerial: string) => {
      return DeviceUtils.createStationManifest(this.wsClient, stationSerial);
    });

    await deviceManager.onDevicesChanged({
      providerNativeId: this.nativeId,
      devices: await Promise.all(manifests),
    });

    this.logger.i(
      `✅ Registered ${manifests.length} stations from server state`
    );
  }

  /**
   * Register devices from the server state.
   * @param serverState - StartListeningResponse from the server.
   * @returns {Promise<void>}
   */
  private async registerDevicesFromServerState(
    serverState: StartListeningResponse
  ): Promise<void> {
    // Extract device serial numbers from server state (string array)
    const deviceSerials: string[] = serverState.state.devices || [];
    this.logger.i(
      `📱 Found ${deviceSerials.length} device serials from server:`,
      deviceSerials
    );

    if (deviceSerials.length === 0) {
      this.logger.w("⚠️ No devices found in server state");
      return;
    }

    deviceSerials.forEach((deviceSerial) =>
      DeviceUtils.createDeviceManifest(this.wsClient, deviceSerial).then(
        (manifest) =>
          deviceManager.onDevicesChanged({
            providerNativeId: manifest.providerNativeId,
            devices: [manifest],
          })
      )
    );

    this.logger.i(
      `✅ Registered ${deviceSerials.length} devices from server state`
    );
  }

  /**
   * Wait for the WebSocket client to be ready for API calls.
   * @returns {Promise<void>}
   */
  private async waitForClientReady(): Promise<void> {
    const maxWaitTime = 15000; // 15 seconds max wait (increased from 10)
    const checkInterval = 500; // Check every 500ms
    let waitTime = 0;

    this.logger.d(
      "⏳ Waiting for WebSocket client to be ready for API calls..."
    );

    return new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        // Check if client is ready for API calls - isConnected() calls stateManager.isReady()
        if (this.wsClient.isConnected()) {
          this.logger.d("✅ WebSocket client ready for API calls");
          resolve();
        } else if (waitTime >= maxWaitTime) {
          const state = this.wsClient.getState();
          this.logger.d("❌ Client state on timeout:", state);
          reject(
            new Error(
              `Timeout waiting for client to be ready. Current state: ${state.connection}`
            )
          );
        } else {
          if (waitTime % 2000 === 0) {
            // Log every 2 seconds in debug mode
            const state = this.wsClient.getState();
            this.logger.d(
              `⏳ Still waiting... Current state: ${state.connection}`
            );
          }
          waitTime += checkInterval;
          setTimeout(checkReady, checkInterval);
        }
      };
      checkReady();
    });
  }

  /**
   * Set up captcha and 2FA event handling for driver authentication.
   */
  private setupCaptchaHandling(): void {
    // Listen for captcha requests from the driver
    this.wsClient.addEventListener(
      "captcha request",
      (event) => {
        this.logger.i("🔐 Captcha requested for driver authentication");
        this.logger.i(`Captcha ID: ${event.captchaId}`);
        this.logger.i(
          `Captcha Image: received (${event.captcha.length} chars)`
        );

        // Store captcha ID for later use
        this.storage.setItem("currentCaptchaId", event.captchaId);

        // Store captcha image data for display (base64 encoded)
        this.storage.setItem("currentCaptchaImage", event.captcha);

        // Store a version/timestamp to force settings UI to detect a change
        const version = Date.now().toString();
        this.storage.setItem("currentCaptchaImageVersion", version);
        this.logger.d(`✅ Stored captcha image version: ${version}`);

        this.logger.i(
          "💡 Please check the Driver Management settings to enter the captcha code"
        );

        // Refresh the settings UI to show the captcha image
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      },
      { source: "driver" }
    );

    // Listen for driver connected events
    this.wsClient.addEventListener(
      "connected",
      (event) => {
        this.logger.i("🟢 Driver connected event received:", event);
      },
      { source: "driver" }
    );

    // Listen for driver disconnected events
    this.wsClient.addEventListener(
      "disconnected",
      (event) => {
        this.logger.i("🔌 Driver disconnected event received:", event);
      },
      { source: "driver" }
    );

    this.logger.d("✅ Captcha and driver event handling configured");
  }

  /**
   * Get an appropriate icon for the connection state.
   * @param connectionState - The connection state to get an icon for.
   * @returns {string} Emoji icon representing the state.
   */
  private getConnectionStateIcon(connectionState?: string): string {
    switch (connectionState) {
      case "disconnected":
        return "🔴";
      case "connecting":
        return "🟡";
      case "connected":
        return "🟠";
      case "schema_negotiating":
        return "🔄";
      case "ready":
        return "🟢";
      case "error":
        return "❌";
      default:
        return "❔";
    }
  }

  /**
   * Dispose of the provider and clean up resources.
   */
  dispose(): void {
    this.wsClient.disconnect();
    this.stations.clear();
  }

  /**
   * Execute a promise with a timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Display the result of a connection attempt
   */
  private displayConnectResult(
    isWebSocketConnected: boolean,
    isDriverConnected: boolean
  ): void {
    if (!isWebSocketConnected) {
      this.logger.e("❌ Connection Failed: WEBSOCKET DISCONNECTED");
      this.logger.e("   Cannot connect to the eufy-security-ws server.");
      this.logger.e("   This may indicate:");
      this.logger.e("   • The eufy-security-ws server is not running");
      this.logger.e("   • Network connectivity issues");
      this.logger.e("   • Incorrect WebSocket host/port configuration");
      this.logger.e("   • Server configuration issues");
      throw new Error("❌ WebSocket connection failed");
    } else if (!isDriverConnected) {
      this.logger.w("⚠️  Connection Established: DRIVER NEEDS AUTHENTICATION");
      this.logger.w(
        "   WebSocket connection established, but Eufy driver is not authenticated."
      );
      this.logger.w("   This typically means:");
      this.logger.w(
        "   • 2FA authentication is required (captcha/verification code)"
      );
      this.logger.w("   • Eufy account credentials need verification");
      this.logger.w("   • Check the settings page for authentication prompts");
    } else {
      this.logger.i("✅ Connection Successful: FULLY CONNECTED");
      this.logger.i(
        "   WebSocket connection established and Eufy driver is authenticated."
      );
      this.logger.i(
        "   You can now use other Scrypted features to interact with your devices."
      );
    }
  }

  /**
   * Display CAPTCHA authentication requirements
   */
  private async displayCaptchaRequired(
    captchaId: string,
    captcha: string
  ): Promise<void> {
    this.logger.i("🔐 CAPTCHA authentication is required to complete login.");
    this.logger.i(`   CAPTCHA ID: ${captchaId}`);

    // Store captcha ID for later use
    this.storage.setItem("currentCaptchaId", captchaId);
    // Store captcha image data for display (base64 encoded)
    this.storage.setItem("currentCaptchaImage", captcha);

    // Also store a version to force the settings HTML to change even if the
    // image data is identical (some UIs may not refresh if the value is
    // byte-for-byte identical). Embedding this in the HTML forces an update.
    const version = Date.now().toString();
    this.storage.setItem("currentCaptchaImageVersion", version);
    this.logger.d(
      `✅ displayCaptchaRequired stored captcha version: ${version}`
    );

    this.logger.i("💡 To complete authentication:");
    this.logger.i("   1. Check the settings page for the CAPTCHA image");
    this.logger.i("   2. Solve the CAPTCHA challenge shown in settings");
    this.logger.i("   3. Enter the code in the 'Captcha Code' field");
    this.logger.i("   4. Click 'Submit Captcha'");
    this.logger.i("   5. Then enter 2FA verification code if prompted");

    // Refresh the settings UI to show the captcha image
    this.onDeviceEvent(ScryptedInterface.Settings, undefined);
  }

  /**
   * Display MFA authentication requirements
   */
  private displayMfaRequired(mfaData: {
    methods: string[];
    captchaId?: string;
  }): void {
    this.logger.i(
      "🔐 Multi-factor authentication is required to complete login."
    );
    this.logger.i(`   Methods received: ${mfaData.methods.length} methods`);
    if (mfaData.methods.length === 0) {
      this.logger.w(
        "⚠️ No MFA methods provided - this may indicate an issue with the MFA request"
      );
      this.logger.w(
        "   Please check the eufy-security-ws server logs for more details"
      );
      this.logger.w("   You may need to restart the authentication process");
    } else {
      this.logger.i(
        "   Please check your email/SMS for the verification code."
      );
      this.logger.i("   Available Methods:");
      mfaData.methods.forEach((method, index) => {
        this.logger.i(`   ${index + 1}. ${method}`);
      });
    }

    // Store the captchaId if provided for MFA verification
    if (mfaData.captchaId) {
      this.storage.setItem("currentCaptchaId", mfaData.captchaId);
      this.logger.i(`🔑 Stored MFA captchaId: ${mfaData.captchaId}`);
    }

    // Clear any previously stored verification code to ensure the input field starts empty
    this.storage.removeItem("pendingVerifyCode");

    this.logger.i("💡 To complete authentication:");
    this.logger.i("   1. Check your email or SMS for the verification code");
    this.logger.i("   2. Enter the code in the '2FA Verification Code' field");
    this.logger.i("   3. Click 'Submit 2FA Code'");
    this.logger.i("   4. Check the connection status for completion");

    // Refresh the settings UI to show the MFA prompt
    this.onDeviceEvent(ScryptedInterface.Settings, undefined);
  }
}
