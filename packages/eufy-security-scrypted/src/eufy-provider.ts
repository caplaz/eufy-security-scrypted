/**
 * Eufy Security Provider for Scrypted
 *
 * Main entry point for the Eufy Security Scrypted plugin. This class serves as the
 * central coordinator for all Eufy device interactions within the Scrypted ecosystem.
 *
 * Core Responsibilities:
 * - WebSocket connection management to eufy-security-ws server
 * - Device discovery and automatic registration with Scrypted
 * - Station hierarchy maintenance
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
import { Logger, ILogObj } from "tslog";
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
  // Core dependencies
  wsClient: EufyWebSocketClient;
  wsLogger: Logger<ILogObj>;

  // Device management
  stations = new Map<string, EufyStation>();

  // Settings state
  debugLogging = false;

  // Connection state tracking
  pushConnected = false;
  mqttConnected = false;

  // Authentication state (direct from WebSocket events)
  authState: "none" | "captcha_required" | "mfa_required" = "none";
  captchaData: { captchaId: string; captcha: string } | null = null;
  mfaData: { methods: string[] } | null = null;

  // Current authentication input values (not persisted)
  currentCaptchaCode = "";
  currentVerifyCode = "";

  /**
   * Construct a new EufySecurityProvider.
   * @param nativeId - Optional Scrypted nativeId for the provider.
   */
  constructor(nativeId?: string) {
    super(nativeId);

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

    // Initialize system memory threshold from storage
    const memoryThreshold = Math.max(
      50,
      parseInt(this.storage.getItem("memoryThresholdMB") || "120")
    );
    const debugLogger = createDebugLogger("MemoryManager");
    MemoryManager.setMemoryThreshold(memoryThreshold, debugLogger);

    // Set up authentication event listeners
    this.setupAuthEventListeners();

    this.console.log("🚀 EufySecurityProvider initialized");

    // Start connection automatically
    this.startConnection().catch((error) => {
      this.console.error("❌ Failed to start connection:", error);
    });
  }

  /**
   * Get the settings for this provider.
   * @returns {Promise<Setting[]>} Array of Scrypted Setting objects.
   */
  async getSettings(): Promise<Setting[]> {
    const clientState = this.wsClient.getState();

    // Get some additional status information
    const memoryThreshold = MemoryManager.getMemoryThreshold();
    const currentMemory = Math.round(process.memoryUsage().rss / 1024 / 1024);

    // Check authentication status
    const captchaStatus =
      this.authState === "captcha_required"
        ? "🔐 CAPTCHA required - check settings below"
        : this.authState === "mfa_required"
          ? "🔐 2FA code required - check settings below"
          : clientState?.driverConnected
            ? "✅ Authenticated"
            : "⚠️ Not connected - click Connect Account button";

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
        description:
          "Push notification connection (requires push service in eufy-security-ws)",
        value: this.pushConnected
          ? "🟢 Connected"
          : "🔴 Disconnected (may be normal)",
        type: "string",
        readonly: true,
      },
      {
        group: "Eufy Cloud Account",
        key: "mqttConnectionStatus",
        title: "MQTT Connection",
        description:
          "MQTT connection for real-time updates (requires MQTT in eufy-security-ws)",
        value: this.mqttConnected
          ? "🟢 Connected"
          : "🔴 Disconnected (may be normal)",
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

      // CAPTCHA Authentication UI
      ...(this.authState === "captcha_required" && this.captchaData
        ? [
            {
              group: "Eufy Cloud Account",
              key: "captchaImage",
              title: "CAPTCHA Challenge",
              description: "Solve the CAPTCHA to continue authentication",
              value: `<div style="text-align: center; padding: 20px;"><img src="${this.captchaData.captcha.startsWith("data:") ? this.captchaData.captcha : `data:image/png;base64,${this.captchaData.captcha}`}" alt="CAPTCHA" style="max-width: 100%; border: 2px solid #ccc; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"/></div>`,
              type: "html" as const,
              readonly: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "captchaCodeInput",
              title: "CAPTCHA Code",
              description: `ID: ${this.captchaData.captchaId} - Enter the code from the image above`,
              value: this.currentCaptchaCode,
              placeholder: "Enter CAPTCHA code",
              immediate: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "submitCaptchaButton",
              title: "Submit CAPTCHA",
              description: "Click to submit the CAPTCHA code entered above",
              value: "Submit CAPTCHA Code",
              type: "button" as const,
            },
          ]
        : []),

      // MFA Authentication UI
      ...(this.authState === "mfa_required"
        ? [
            {
              group: "Eufy Cloud Account",
              key: "verifyCodeInput",
              title: "2FA Verification Code",
              description: this.mfaData?.methods?.length
                ? `Methods: ${this.mfaData.methods.join(", ")} - Enter your 6-digit code`
                : "Check your email or SMS for the 6-digit verification code",
              value: this.currentVerifyCode,
              placeholder: "Enter 6-digit code",
              immediate: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "submitVerifyCodeButton",
              title: "Submit 2FA Code",
              description:
                "Click to submit the verification code entered above",
              value: "Submit Verification Code",
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
    // Handle button clicks (they can have null values)
    if (key === "connectDriver") {
      this.console.log("🔗 Button clicked: Connect to Eufy cloud");

      try {
        // Send connect command to the driver
        await this.wsClient.commands.driver().connect();
        this.console.log("✅ Driver connect command sent");

        // Wait a moment for the server to process the connect command
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Check current state and pending authentication
        const result = await this.wsClient.startListening();

        if (result.state.driver.connected) {
          // Successfully connected
          this.console.log(
            "✅ Driver fully connected - authentication complete"
          );
          this.authState = "none";
          this.displayConnectResult(true, true);

          // Register devices after successful connection
          this.console.log("🔍 Discovering devices...");
          await this.registerStationsFromServerState(result);
          await this.registerDevicesFromServerState(result);
          this.console.log("✅ Device discovery complete");
        } else {
          // Not connected - check for pending authentication
          this.console.log(
            "⚠️ Driver not connected - checking for authentication challenges"
          );
          await this.checkPendingAuth();

          // If no pending auth was found, the connection might just need more time
          if (this.authState === "none") {
            this.console.log(
              "💡 No authentication challenges detected. The connection may be in progress."
            );
            this.console.log(
              "💡 If you have 2FA enabled, you may need to check your email or app."
            );
            this.console.log("");
            this.console.log("🔍 Troubleshooting tips:");
            this.console.log(
              "   1. Check the eufy-security-ws container logs for errors"
            );
            this.console.log(
              "   2. Verify your Eufy account credentials in the container config"
            );
            this.console.log(
              "   3. Ensure the container has internet access to connect to Eufy cloud"
            );
            this.console.log(
              "   4. Try restarting the eufy-security-ws container"
            );
            this.console.log("");
            this.console.log("   Container logs command:");
            this.console.log("   docker logs eufy-security-ws");

            // Set up a listener for when connection succeeds
            const removeListener = this.wsClient.addEventListener(
              "connected",
              async () => {
                removeListener();
                this.console.log("✅ Driver connected event received");
                this.authState = "none";

                // Get updated state and register devices
                const updatedResult = await this.wsClient.startListening();
                if (updatedResult.state.driver.connected) {
                  this.displayConnectResult(true, true);
                  await this.registerStationsFromServerState(updatedResult);
                  await this.registerDevicesFromServerState(updatedResult);
                  this.console.log("✅ Device discovery complete");
                }
                this.onDeviceEvent(ScryptedInterface.Settings, undefined);
              },
              { source: "driver" }
            );
          }
        }
      } catch (error) {
        this.console.error("❌ Connection failed:", error);
        // Check if it's an authentication error
        await this.checkPendingAuth();
      }

      // Refresh the settings UI to show updated connection state
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    if (key === "disconnectDriver") {
      this.console.log("🔌 Button clicked: Disconnect from Eufy cloud");
      try {
        await this.wsClient.commands.driver().disconnect();
        this.console.log("✅ Driver disconnected successfully");

        // Refresh the settings UI to show updated connection state
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.console.error("❌ Failed to disconnect driver:", error);

        // Refresh the settings UI even on error to show any state changes
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    // Handle CAPTCHA code input (called on every keystroke with immediate:true)
    if (key === "captchaCodeInput") {
      this.currentCaptchaCode = value?.toString() || "";
      this.storage.setItem("captchaCodeInput", this.currentCaptchaCode);
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    // Handle CAPTCHA submit button
    if (key === "submitCaptchaButton") {
      const captchaCode = this.currentCaptchaCode;
      this.console.log("🔐 Submitting CAPTCHA code");

      if (!captchaCode || captchaCode.trim() === "") {
        throw new Error("❌ Please enter the CAPTCHA code before submitting");
      }

      if (!this.captchaData) {
        throw new Error("No CAPTCHA data available");
      }

      try {
        await this.wsClient.commands.driver().setCaptcha({
          captchaId: this.captchaData.captchaId,
          captcha: captchaCode.trim(),
        });
        this.console.log("✅ CAPTCHA submitted successfully");

        // Clear the CAPTCHA data and code
        this.captchaData = null;
        this.currentCaptchaCode = "";
        this.storage.removeItem("captchaCodeInput");
        this.wsClient.clearPendingCaptcha();

        // Check post-CAPTCHA state
        await this.checkPostCaptchaState();

        // Refresh the settings UI
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.console.error("❌ CAPTCHA submission failed:", error);
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    // Handle verification code input (called on every keystroke with immediate:true)
    if (key === "verifyCodeInput") {
      this.currentVerifyCode = value?.toString() || "";
      this.storage.setItem("verifyCodeInput", this.currentVerifyCode);
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    // Handle verification code submit button
    if (key === "submitVerifyCodeButton") {
      const verifyCode = this.currentVerifyCode;
      this.console.log("🔐 Submitting 2FA verification code");

      if (!verifyCode || verifyCode.trim() === "") {
        throw new Error(
          "❌ Please enter the verification code before submitting"
        );
      }

      const captchaId = this.captchaData?.captchaId || "";

      try {
        await this.wsClient.commands.driver().setVerifyCode({
          captchaId,
          verifyCode: verifyCode.trim(),
        });
        this.console.log("✅ Verification code submitted successfully");

        // Clear the MFA data and code
        this.mfaData = null;
        this.currentVerifyCode = "";
        this.storage.removeItem("verifyCodeInput");
        this.wsClient.clearPendingMfa();

        // Check post-verification state
        await this.checkPostVerificationState();

        // Refresh the settings UI
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.console.error("❌ Verification code submission failed:", error);
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    if (key === "requestNewCode") {
      this.console.log("🔄 Button clicked: Request new verification code");
      try {
        // Try to re-trigger the MFA process
        await this.wsClient.commands.driver().connect();
        this.console.log("✅ New verification code requested successfully");

        // Refresh the settings UI to show updated state
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.console.error(
          "❌ Failed to request new verification code:",
          error
        );

        // Refresh the settings UI to show any state changes
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    // Handle regular settings (require non-null values)
    if (value === undefined || value === null) {
      this.console.warn(
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

        // Reinitialize auth event listeners with new client
        this.setupAuthEventListeners();

        await this.startConnection();
        this.console.log("✅ Reconnected with new WebSocket URL");
      } catch (error) {
        this.console.error(
          "❌ Failed to connect with new WebSocket URL:",
          error
        );
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

      this.storage.setItem("debugLogging", this.debugLogging.toString());
      this.console.log(
        `Debug logging ${this.debugLogging ? "enabled" : "disabled"}`
      );
      // Refresh the settings UI to reflect the immediate change
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    } else if (key === "memoryThresholdMB") {
      const memMB = Math.max(50, parseInt(value as string) || 120);
      this.storage.setItem("memoryThresholdMB", memMB.toString());
      MemoryManager.setMemoryThreshold(
        memMB,
        createDebugLogger("MemoryManager")
      );
      this.console.log(`Memory threshold updated to ${memMB}MB`);
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }
  }
  async getRefreshFrequency(): Promise<number> {
    return 300; // 5 minutes
  }

  /**
   * Refresh the provider (connection health check).
   * @returns {Promise<void>}
   */
  async refresh(): Promise<void> {
    this.console.log("🔄 Connection health check");

    if (!this.wsClient.isConnected()) {
      this.console.warn(
        "⚠️ WebSocket not connected, attempting to reconnect..."
      );
      try {
        await this.startConnection();
        this.console.log("✅ Successfully reconnected");
      } catch (error) {
        this.console.error("❌ Failed to reconnect:", error);
        throw error;
      }
    } else {
      this.console.log("✅ WebSocket connection healthy");
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
      this.console.warn(
        `⚠️ Driver not connected, cannot create device ${nativeId}`
      );
      return undefined;
    }

    if (nativeId && nativeId.startsWith("station_")) {
      this.console.log(`Getting station ${nativeId}`);

      // Return existing station or create new EufyStation
      let station = this.stations.get(nativeId);
      if (!station) {
        station = new EufyStation(nativeId, this.wsClient);
        this.stations.set(nativeId, station);
        this.console.log(`Created new station ${nativeId}`);
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
        this.console.log(`🗑️ Released station ${nativeId}`);
      }
    }
  }

  /**
   * Start the WebSocket connection and register stations/devices from server state.
   * @returns {Promise<void>}
   */
  private async startConnection(): Promise<void> {
    await this.wsClient.connect();
    await this.waitForClientReady();

    const serverState: StartListeningResponse =
      await this.wsClient.startListening();

    // Only register stations and devices if the driver is connected
    if (serverState.state.driver.connected) {
      // Register stations and devices from server state
      // IMPORTANT: Register stations first so they exist as parents for devices
      await this.registerStationsFromServerState(serverState);
      await this.registerDevicesFromServerState(serverState);
    } else {
      this.console.warn(
        "⚠️ Driver not connected, skipping device registration"
      );
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
    this.console.log(
      `📡 Found ${stationSerials.length} station serials from server:`,
      stationSerials
    );

    if (stationSerials.length === 0) {
      this.console.warn("⚠️ No stations found in server state");
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

    this.console.log(
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
    this.console.log(
      `📱 Found ${deviceSerials.length} device serials from server:`,
      deviceSerials
    );

    if (deviceSerials.length === 0) {
      this.console.warn("⚠️ No devices found in server state");
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

    this.console.log(
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

    this.console.log(
      "⏳ Waiting for WebSocket client to be ready for API calls..."
    );

    return new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        // Check if client is ready for API calls - isConnected() calls stateManager.isReady()
        if (this.wsClient.isConnected()) {
          this.console.log("✅ WebSocket client ready for API calls");
          resolve();
        } else if (waitTime >= maxWaitTime) {
          const state = this.wsClient.getState();
          reject(
            new Error(
              `Timeout waiting for client to be ready. Current state: ${state.connection}`
            )
          );
        } else {
          waitTime += checkInterval;
          setTimeout(checkReady, checkInterval);
        }
      };
      checkReady();
    });
  }

  /**
   * Set up authentication event listeners for CAPTCHA and MFA
   */
  private setupAuthEventListeners(): void {
    // Listen for CAPTCHA requests
    this.wsClient.addEventListener(
      "captcha request",
      (event) => {
        this.console.log("🔐 CAPTCHA requested");
        this.captchaData = {
          captchaId: event.captchaId,
          captcha: event.captcha,
        };
        this.authState = "captcha_required";
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      },
      { source: "driver" }
    );

    // Listen for MFA requests
    this.wsClient.addEventListener(
      "verify code",
      (event) => {
        this.console.log("🔐 2FA verification requested");
        this.mfaData = { methods: event.methods || [] };
        this.authState = "mfa_required";
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      },
      { source: "driver" }
    );

    // Listen for driver connected events
    this.wsClient.addEventListener(
      "connected",
      () => {
        this.console.log("✅ Driver connected");
        this.authState = "none";
        this.captchaData = null;
        this.mfaData = null;
        this.currentCaptchaCode = "";
        this.currentVerifyCode = "";
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      },
      { source: "driver" }
    );
  }

  /**
   * Check for pending authentication challenges (CAPTCHA or 2FA) after connection attempt.
   * Updates the UI if authentication is required.
   */
  private async checkPendingAuth(): Promise<void> {
    const pendingCaptcha = this.wsClient.getPendingCaptcha();
    if (pendingCaptcha) {
      this.captchaData = pendingCaptcha;
      this.authState = "captcha_required";
      this.wsClient.clearPendingCaptcha();
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    const pendingMfa = this.wsClient.getPendingMfa();
    if (pendingMfa) {
      this.mfaData = pendingMfa;
      this.authState = "mfa_required";
      this.wsClient.clearPendingMfa();
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }
  }

  /**
   * Check authentication state after CAPTCHA submission.
   * May transition to 2FA if required, or complete authentication and discover devices.
   */
  private async checkPostCaptchaState(): Promise<void> {
    const pendingMfa = this.wsClient.getPendingMfa();
    if (pendingMfa) {
      this.mfaData = pendingMfa;
      this.authState = "mfa_required";
      this.wsClient.clearPendingMfa();
      return;
    }

    const listeningResult = await this.wsClient.startListening();
    if (listeningResult.state.driver.connected) {
      this.authState = "none";
      this.displayConnectResult(true, true);

      // Register devices after successful authentication
      this.console.log("🔍 Discovering devices after authentication...");
      await this.registerStationsFromServerState(listeningResult);
      await this.registerDevicesFromServerState(listeningResult);
      this.console.log("✅ Device discovery complete");
    }
  }

  /**
   * Check authentication state after 2FA verification code submission.
   * Completes authentication and discovers devices if successful.
   */
  private async checkPostVerificationState(): Promise<void> {
    const listeningResult = await this.wsClient.startListening();
    if (listeningResult.state.driver.connected) {
      this.authState = "none";
      this.displayConnectResult(true, true);

      // Register devices after successful authentication
      this.console.log("🔍 Discovering devices after authentication...");
      await this.registerStationsFromServerState(listeningResult);
      await this.registerDevicesFromServerState(listeningResult);
      this.console.log("✅ Device discovery complete");
    }
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
      this.console.error("❌ Connection Failed: WEBSOCKET DISCONNECTED");
      this.console.error("   Cannot connect to the eufy-security-ws server.");
      this.console.error("   This may indicate:");
      this.console.error("   • The eufy-security-ws server is not running");
      this.console.error("   • Network connectivity issues");
      this.console.error("   • Incorrect WebSocket host/port configuration");
      this.console.error("   • Server configuration issues");
      throw new Error("❌ WebSocket connection failed");
    } else if (!isDriverConnected) {
      this.console.warn(
        "⚠️  Connection Established: DRIVER NEEDS AUTHENTICATION"
      );
      this.console.warn(
        "   WebSocket connection established, but Eufy driver is not authenticated."
      );
      this.console.warn("   This typically means:");
      this.console.warn(
        "   • 2FA authentication is required (captcha/verification code)"
      );
      this.console.warn("   • Eufy account credentials need verification");
      this.console.warn(
        "   • Check the settings page for authentication prompts"
      );
    } else {
      this.console.log("✅ Connection Successful: FULLY CONNECTED");
      this.console.log(
        "   WebSocket connection established and Eufy driver is authenticated."
      );
      this.console.log(
        "   You can now use other Scrypted features to interact with your devices."
      );
    }
  }
}
