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
  AUTH_STATE,
  AuthenticationManager,
  EufyWebSocketClient,
  StartListeningResponse,
} from "@caplaz/eufy-security-client";
import { Logger, ILogObj, ILogObjMeta } from "tslog";
import { EufyStation } from "./eufy-station";
import { DeviceUtils } from "./utils/device-utils";
import { MemoryManager } from "./utils/memory-manager";

const { deviceManager } = sdk;

/**
 * Create a transport function for routing tslog output to a Scrypted console
 */
function createConsoleTransport(console: Console) {
  return (logObj: ILogObj & ILogObjMeta) => {
    const meta = (logObj as any)._meta;
    if (!meta) return;
    const prefix = meta.name ? `[${meta.name}] ` : "";

    // Extract all non-meta properties as the log arguments
    const args = Object.keys(logObj)
      .filter((key) => key !== "_meta" && key !== "toJSON")
      .map((key) => (logObj as any)[key]);

    const msg = args
      .map((a: any) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
      .join(" ");

    const level = meta.logLevelName?.toLowerCase();
    if (level === "warn") console.warn(`${prefix}${msg}`);
    else if (level === "error" || level === "fatal")
      console.error(`${prefix}${msg}`);
    else console.log(`${prefix}${msg}`);
  };
}

export class EufySecurityProvider
  extends ScryptedDeviceBase
  implements DeviceProvider, Settings, Refresh
{
  // Core dependencies
  wsClient: EufyWebSocketClient;
  wsLogger: Logger<ILogObj>;
  private logger: Logger<ILogObj>;

  // Device management
  stations = new Map<string, EufyStation>();

  // Settings state
  debugLogging = false;

  // Connection state tracking
  pushConnected = false;
  mqttConnected = false;

  // Connection in progress flag (true during initial startup or reconnection)
  private isConnecting = true;

  // Track if we've already logged the ready state to avoid spam
  private hasLoggedReady = false;
  private isWaitingForReady = false;

  // Authentication manager (handles all auth logic)
  private authManager: AuthenticationManager;

  /**
   * Construct a new EufySecurityProvider.
   * @param nativeId - Optional Scrypted nativeId for the provider.
   */
  constructor(nativeId?: string) {
    super(nativeId);

    // Initialize the root logger with this provider's console
    // This controls the global debug setting for all sublogs
    this.debugLogging = this.storage.getItem("debugLogging") === "true";
    this.logger = new Logger<ILogObj>({
      name: "EufySecurity",
      minLevel: this.debugLogging ? 0 : 3, // 0=all, 3=info+
      type: "hidden",
    });
    this.logger.attachTransport(createConsoleTransport(this.console));

    // Create a logger for the WebSocket client using the same console
    // (WebSocket events are part of the provider's responsibility)
    this.wsLogger = this.logger.getSubLogger({ name: "WebSocketClient" });
    this.wsClient = new EufyWebSocketClient(
      this.storage.getItem("wsUrl") || "ws://localhost:3000",
      this.wsLogger
    );

    // Initialize system memory threshold from storage
    const memoryThreshold = Math.max(
      50,
      parseInt(this.storage.getItem("memoryThresholdMB") || "120")
    );
    const memoryLogger = this.logger.getSubLogger({ name: "Memory" });
    MemoryManager.setMemoryThreshold(memoryThreshold, memoryLogger);

    // Initialize authentication manager
    const authLogger = this.logger.getSubLogger({ name: "Auth" });
    this.authManager = new AuthenticationManager(
      this.wsClient,
      authLogger,
      () => this.onDeviceEvent(ScryptedInterface.Settings, undefined),
      async (result: StartListeningResponse) => {
        this.displayConnectResult(true, true);
        this.logger.info("🔍 Discovering devices after authentication...");
        await this.registerStationsFromServerState(result);
        await this.registerDevicesFromServerState(result);
        this.logger.info("✅ Device discovery complete");

        // Mark connection as complete
        this.isConnecting = false;
      }
    );

    this.logger.info("🚀 EufySecurityProvider initialized");

    // Start connection automatically
    this.startConnection().catch((error) => {
      this.logger.error("❌ Failed to start connection:", error);
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
    const captchaStatus = this.authManager.getAuthStatusMessage(
      clientState?.driverConnected || false
    );

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
      ...(this.authManager.getAuthState() === "captcha_required" &&
      this.authManager.getCaptchaData()
        ? [
            {
              group: "Eufy Cloud Account",
              key: "captchaImage",
              title: "CAPTCHA Challenge",
              description: "Solve the CAPTCHA to continue authentication",
              value: `<div style="text-align: center; padding: 20px;"><img src="${this.authManager.getCaptchaData()!.captcha.startsWith("data:") ? this.authManager.getCaptchaData()!.captcha : `data:image/png;base64,${this.authManager.getCaptchaData()!.captcha}`}" alt="CAPTCHA" style="max-width: 100%; border: 2px solid #ccc; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"/></div>`,
              type: "html" as const,
              readonly: true,
            },
            {
              group: "Eufy Cloud Account",
              key: "captchaCodeInput",
              title: "CAPTCHA Code",
              description: `ID: ${this.authManager.getCaptchaData()!.captchaId} - Enter the code from the image above`,
              value: this.authManager.getCurrentCaptchaCode(),
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
      ...(this.authManager.getAuthState() === AUTH_STATE.MFA_REQUIRED
        ? [
            {
              group: "Eufy Cloud Account",
              key: "verifyCodeInput",
              title: "2FA Verification Code",
              description: this.authManager.getMfaData()?.methods?.length
                ? `Methods: ${this.authManager.getMfaData()!.methods.join(", ")} - Enter your 6-digit code`
                : "Check your email or SMS for the 6-digit verification code",
              value: this.authManager.getCurrentVerifyCode(),
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
      this.logger.info("🔗 Button clicked: Connect to Eufy cloud");

      // Mark connection as in progress
      this.isConnecting = true;

      try {
        // Send connect command to the driver
        await this.wsClient.commands.driver().connect();
        this.logger.info("✅ Driver connect command sent");

        // Wait a moment for the server to process the connect command
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Check current state and pending authentication
        const result = await this.wsClient.startListening();

        if (result.state.driver.connected) {
          // Successfully connected
          this.logger.info(
            "✅ Driver fully connected - authentication complete"
          );
          this.authManager.resetAuthState();
          this.displayConnectResult(true, true);

          // Register devices after successful connection
          this.logger.info("🔍 Discovering devices...");
          await this.registerStationsFromServerState(result);
          await this.registerDevicesFromServerState(result);
          this.logger.info("✅ Device discovery complete");

          // Mark connection as complete
          this.isConnecting = false;
        } else {
          // Not connected - check for pending authentication
          this.logger.info(
            "⚠️ Driver not connected - checking for authentication challenges"
          );
          await this.authManager.checkPendingAuth();

          // If no pending auth was found, the connection might just need more time
          if (this.authManager.getAuthState() === AUTH_STATE.NONE) {
            this.logger.info(
              "💡 No authentication challenges detected. The connection may be in progress."
            );
            this.logger.info(
              "💡 If you have 2FA enabled, you may need to check your email or app."
            );
            this.logger.info("");
            this.logger.info("🔍 Troubleshooting tips:");
            this.logger.info(
              "   1. Check the eufy-security-ws container logs for errors"
            );
            this.logger.info(
              "   2. Verify your Eufy account credentials in the container config"
            );
            this.logger.info(
              "   3. Ensure the container has internet access to connect to Eufy cloud"
            );
            this.logger.info(
              "   4. Try restarting the eufy-security-ws container"
            );
            this.logger.info("");
            this.logger.info("   Container logs command:");
            this.logger.info("   docker logs eufy-security-ws");

            // Set up a listener for when connection succeeds
            const removeListener = this.wsClient.addEventListener(
              "connected",
              async () => {
                removeListener();
                this.logger.info("✅ Driver connected event received");
                this.authManager.resetAuthState();

                // Get updated state and register devices
                const updatedResult = await this.wsClient.startListening();
                if (updatedResult.state.driver.connected) {
                  this.displayConnectResult(true, true);
                  await this.registerStationsFromServerState(updatedResult);
                  await this.registerDevicesFromServerState(updatedResult);
                  this.logger.info("✅ Device discovery complete");

                  // Mark connection as complete
                  this.isConnecting = false;
                }
                this.onDeviceEvent(ScryptedInterface.Settings, undefined);
              },
              { source: "driver" }
            );
          }
        }
      } catch (error) {
        this.logger.error("❌ Connection failed:", error);
        // Check if it's an authentication error
        await this.authManager.checkPendingAuth();
      }

      // Refresh the settings UI to show updated connection state
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    if (key === "disconnectDriver") {
      this.logger.info("🔌 Button clicked: Disconnect from Eufy cloud");
      try {
        await this.wsClient.commands.driver().disconnect();
        this.logger.info("✅ Driver disconnected successfully");

        // Mark as ready for new connection
        this.isConnecting = true;

        // Refresh the settings UI to show updated connection state
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.logger.error("❌ Failed to disconnect driver:", error);

        // Refresh the settings UI even on error to show any state changes
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    // Handle CAPTCHA code input (called on every keystroke with immediate:true)
    if (key === "captchaCodeInput") {
      this.authManager.updateCaptchaCode(value?.toString() || "");
      this.storage.setItem("captchaCodeInput", value?.toString() || "");
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    // Handle CAPTCHA submit button
    if (key === "submitCaptchaButton") {
      try {
        await this.authManager.submitCaptcha();
        this.storage.removeItem("captchaCodeInput");
      } catch (error) {
        this.logger.error("❌ CAPTCHA submission failed:", error);
      }
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    // Handle verification code input (called on every keystroke with immediate:true)
    if (key === "verifyCodeInput") {
      this.authManager.updateVerifyCode(value?.toString() || "");
      this.storage.setItem("verifyCodeInput", value?.toString() || "");
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    // Handle verification code submit button
    if (key === "submitVerifyCodeButton") {
      try {
        await this.authManager.submitVerifyCode();
        this.storage.removeItem("verifyCodeInput");
      } catch (error) {
        this.logger.error("❌ Verification code submission failed:", error);
      }
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    if (key === "requestNewCode") {
      try {
        await this.authManager.requestNewCode();
      } catch (error) {
        this.logger.error("❌ Failed to request new code:", error);
      }
      return;
    }

    // Handle regular settings (require non-null values)
    if (value === undefined || value === null) {
      this.logger.warn(
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

        // Note: Auth manager was initialized with the old wsClient
        // For full reconnection support, we'd need to recreate the auth manager
        // or make it support client replacement. For now, this edge case is acceptable.

        await this.startConnection();
        this.logger.info("✅ Reconnected with new WebSocket URL");
      } catch (error) {
        this.logger.error(
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

      // Update root logger minLevel - this propagates to all sub-loggers via tslog's hierarchy
      this.logger.settings.minLevel = this.debugLogging ? 0 : 3;

      // Update WebSocket logger level
      this.wsLogger.settings.minLevel = this.debugLogging ? 0 : 3;

      this.storage.setItem("debugLogging", this.debugLogging.toString());
      this.logger.info(
        `Debug logging ${this.debugLogging ? "enabled" : "disabled"}`
      );
      // Refresh the settings UI to reflect the immediate change
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    } else if (key === "memoryThresholdMB") {
      const memMB = Math.max(50, parseInt(value as string) || 120);
      this.storage.setItem("memoryThresholdMB", memMB.toString());
      const memoryLogger = this.logger.getSubLogger({ name: "MemoryManager" });
      memoryLogger.attachTransport(createConsoleTransport(this.console));
      MemoryManager.setMemoryThreshold(memMB, memoryLogger);
      this.logger.info(`Memory threshold updated to ${memMB}MB`);
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
    this.logger.info("🔄 Connection health check");

    if (!this.wsClient.isConnected()) {
      this.logger.warn(
        "⚠️ WebSocket not connected, attempting to reconnect..."
      );
      try {
        await this.startConnection();
        this.logger.info("✅ Successfully reconnected");
      } catch (error) {
        this.logger.error("❌ Failed to reconnect:", error);
        throw error;
      }
    } else {
      this.logger.info("✅ WebSocket connection healthy");
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
      // During connection, this is expected - devices will be registered after auth
      if (this.isConnecting) {
        this.logger.debug(
          `⏳ Driver connecting, device ${nativeId} will be available after authentication`
        );
      } else {
        this.logger.warn(
          `⚠️ Driver not connected, cannot create device ${nativeId}`
        );
      }
      return undefined;
    }

    if (nativeId && nativeId.startsWith("station_")) {
      this.logger.info(`Getting station ${nativeId}`);

      // Return existing station or create new EufyStation
      let station = this.stations.get(nativeId);
      if (!station) {
        station = new EufyStation(nativeId, this.wsClient, this.logger);
        this.stations.set(nativeId, station);
        this.logger.info(`Created new station ${nativeId}`);
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
        this.logger.info(`🗑️ Released station ${nativeId}`);
      }
    }
  }

  /**
   * Start the WebSocket connection and register stations/devices from server state.
   * @returns {Promise<void>}
   */
  private async startConnection(): Promise<void> {
    // Reset ready flags when starting a new connection
    this.hasLoggedReady = false;
    this.isWaitingForReady = false;
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

      // Connection completed successfully
      this.isConnecting = false;
    } else {
      this.logger.info(
        "⏳ Driver not connected yet - authentication may be required. Check settings to connect."
      );
      // Keep isConnecting = true until successful connection
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
    this.logger.info(
      `📡 Found ${stationSerials.length} station serials from server:`,
      stationSerials
    );

    if (stationSerials.length === 0) {
      this.logger.warn("⚠️ No stations found in server state");
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

    this.logger.info(
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
    this.logger.info(
      `📱 Found ${deviceSerials.length} device serials from server:`,
      deviceSerials
    );

    if (deviceSerials.length === 0) {
      this.logger.warn("⚠️ No devices found in server state");
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

    this.logger.info(
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

    // Only log if we haven't already logged AND we're not currently waiting
    if (!this.hasLoggedReady && !this.isWaitingForReady) {
      this.logger.info(
        "⏳ Waiting for WebSocket client to be ready for API calls..."
      );
      this.isWaitingForReady = true;
    }

    return new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        // Check if client is ready for API calls - isConnected() calls stateManager.isReady()
        if (this.wsClient.isConnected()) {
          // Only log once when transitioning to ready
          if (!this.hasLoggedReady) {
            this.logger.info("✅ WebSocket client ready for API calls");
            this.hasLoggedReady = true;
            this.isWaitingForReady = false;
          }
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
      this.logger.error("❌ Connection Failed: WEBSOCKET DISCONNECTED");
      this.logger.error("   Cannot connect to the eufy-security-ws server.");
      this.logger.error("   This may indicate:");
      this.logger.error("   • The eufy-security-ws server is not running");
      this.logger.error("   • Network connectivity issues");
      this.logger.error("   • Incorrect WebSocket host/port configuration");
      this.logger.error("   • Server configuration issues");
      throw new Error("❌ WebSocket connection failed");
    } else if (!isDriverConnected) {
      this.logger.warn(
        "⚠️  Connection Established: DRIVER NEEDS AUTHENTICATION"
      );
      this.logger.warn(
        "   WebSocket connection established, but Eufy driver is not authenticated."
      );
      this.logger.warn("   This typically means:");
      this.logger.warn(
        "   • 2FA authentication is required (captcha/verification code)"
      );
      this.logger.warn("   • Eufy account credentials need verification");
      this.logger.warn(
        "   • Check the settings page for authentication prompts"
      );
    } else {
      this.logger.info("✅ Connection Successful: FULLY CONNECTED");
      this.logger.info(
        "   WebSocket connection established and Eufy driver is authenticated."
      );
      this.logger.info(
        "   You can now use other Scrypted features to interact with your devices."
      );
    }
  }
}
