/**
 * Eufy Security Provider for Scrypted
 *
 * Main entry point for the Eufy Security Scrypted plugin. This class serves as the
 * central coordinator for all Eufy device interactions within the Scrypted ecosystem.
 * Integrates with the eufy-stream-server for efficient H.264 video streaming.
 *
 * Core Responsibilities:
 * - WebSocket connection management to eufy-security-ws server
 * - Device discovery and automatic registration with Scrypted
 * - Station management and device hierarchy maintenance
 * - Authentication handling (captcha, 2FA) with user-friendly UI
 * - Stream server integration for video streaming
 * - Settings management with real-time status monitoring
 * - Driver connection lifecycle management
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
} from "@scrypted/eufy-security-client";
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

    // Create a logger for the WebSocket client with reasonable verbosity
    this.wsLogger = new Logger({
      name: "EufyWebSocketClient",
      minLevel: 4, // warn level and above (warn, error, fatal)
    });

    this.wsClient = new EufyWebSocketClient(
      this.storage.getItem("wsUrl") || "ws://localhost:3000",
      this.wsLogger
    );

    // Set up captcha event handling
    this.setupCaptchaHandling();

    this.logger.i("🚀 EufySecurityProvider initialized");

    // Only attempt connection if explicitly enabled or if we have credentials
    const shouldConnect = this.storage.getItem("autoConnect") !== "false";
    if (shouldConnect) {
      this.startConnection().catch((error) => {
        this.logger.w(
          "⚠️ WebSocket connection failed - server may not be running"
        );
      });
    } else {
      this.logger.i("🔌 Auto-connect disabled - manual connection required");
    }
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
      : "✅ No captcha required";

    return [
      {
        key: "wsUrl",
        title: "WebSocket URL",
        description: "URL of the eufy-security-ws container",
        value: this.storage.getItem("wsUrl") || "ws://localhost:3000",
        placeholder: "ws://localhost:3000",
      },
      {
        key: "debugLogging",
        title: "Debug Logging",
        description: "Enable verbose logging for troubleshooting",
        value: this.debugLogging,
        type: "boolean",
        immediate: true, // Apply immediately without restart
      },
      {
        key: "autoConnect",
        title: "Auto Connect",
        description:
          "Automatically attempt to connect to Eufy services on startup",
        value: this.storage.getItem("autoConnect") !== "false", // Default to true
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

      // Driver Management
      {
        group: "Driver Management",
        key: "driverConnectionStatus",
        title: "Driver Connection Status",
        description: "Current Eufy cloud driver connection state",
        value: clientState?.driverConnected
          ? "🟢 Connected"
          : "🔴 Disconnected",
        type: "string",
        readonly: true,
      },
      {
        group: "Driver Management",
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
              group: "Driver Management",
              key: "disconnectDriver",
              title: "Disconnect from Eufy Cloud",
              description: "Disconnect from Eufy cloud services",
              value: "Disconnect Driver",
              type: "button" as const,
            },
          ]
        : [
            {
              group: "Driver Management",
              key: "connectDriver",
              title: "Connect to Eufy Cloud",
              description: "Establish connection to Eufy cloud services",
              value: "Connect Driver",
              type: "button" as const,
            },
          ]),
      {
        group: "Driver Management",
        key: "captchaInput",
        title: "Captcha Code",
        description: "Enter captcha code when prompted during login",
        value: this.storage.getItem("pendingCaptcha") || "",
        placeholder: "Enter captcha code...",
        type: "string" as const,
      },
      // Enhanced captcha display with HTML type for image rendering
      ...(this.storage.getItem("currentCaptchaImage")
        ? [
            {
              group: "Driver Management",
              key: "captchaImageDisplay",
              title: "Current Captcha",
              description: "Visual captcha challenge",
              value: `<div style="text-align: center; margin: 10px 0;">
            <img src="data:image/png;base64,${this.storage.getItem("currentCaptchaImage")}" 
                 style="max-width: 300px; border: 2px solid #ddd; border-radius: 8px; background: white;" 
                 alt="Captcha Image" />
            <div style="margin-top: 8px; font-size: 12px; color: #666;">
              Enter the characters shown above in the "Captcha Code" field
            </div>
          </div>`,
              type: "html" as const,
              readonly: true,
            },
          ]
        : []),
      {
        group: "Driver Management",
        key: "submitCaptcha",
        title: "Submit Captcha",
        description: "Submit the entered captcha code",
        value: "Submit Captcha",
        type: "button" as const,
        // Only show submit button if we have a captcha
        ...(this.storage.getItem("currentCaptchaId") ? {} : { readonly: true }),
      },
      {
        group: "Driver Management",
        key: "verifyCodeInput",
        title: "2FA Verification Code",
        description: "Enter 2FA verification code when prompted",
        value: this.storage.getItem("pendingVerifyCode") || "",
        placeholder: "Enter 6-digit code...",
        type: "string" as const,
      },
      {
        group: "Driver Management",
        key: "submitVerifyCode",
        title: "Submit 2FA Code",
        description: "Submit the entered 2FA verification code",
        value: "Submit 2FA Code",
        type: "button" as const,
      },

      // Client Status Monitoring (Read-only) - Complete ClientState interface data
      {
        group: "Client Status",
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
        group: "Client Status",
        key: "wsConnected",
        title: "WebSocket Connected",
        description: "Whether WebSocket connection is established",
        value: clientState?.wsConnected ? "🟢 Connected" : "🔴 Disconnected",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "Client Status",
        key: "schemaSetupComplete",
        title: "Schema Setup Complete",
        description: "Whether API schema negotiation is complete",
        value: clientState?.schemaSetupComplete ? "✅ Complete" : "⏳ Pending",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "Client Status",
        key: "driverConnected",
        title: "Driver Connected",
        description: "Whether Eufy driver is connected and ready",
        value: clientState?.driverConnected
          ? "🟢 Connected"
          : "🔴 Disconnected",
        type: "string" as const,
        readonly: true,
      },
      {
        group: "Client Status",
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
        group: "Client Status",
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
        group: "Client Status",
        key: "reconnectAttempts",
        title: "Reconnect Attempts",
        description: "Number of reconnection attempts made",
        value: clientState?.reconnectAttempts || 0,
        type: "number" as const,
        readonly: true,
      },
      {
        group: "Client Status",
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

      try {
        this.logger.i("📡 Sending driver.connect() command...");
        const response = await this.wsClient.commands.driver().connect();
        this.logger.i("📄 Driver connect response:", response);

        // Wait a bit for events to be triggered (captcha requests, etc.)
        this.logger.i(
          "⏳ Waiting for authentication events (captcha, etc.)..."
        );
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3 seconds

        // Check client state after waiting
        const afterState = this.wsClient.getState();
        this.logger.i("📊 Client state after connect + wait:", afterState);

        if (afterState.driverConnected) {
          this.logger.i("✅ Driver is now connected!");
        } else {
          this.logger.w(
            "⚠️ Driver not connected - likely needs authentication (captcha/2FA)"
          );
          this.logger.i(
            "💡 Check the settings page for captcha image or authentication prompts"
          );
        }

        this.logger.i("✅ Driver connection process completed");

        // Refresh the settings UI to show updated connection state
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.logger.e("❌ Failed to connect driver:", error);

        // Refresh the settings UI even on error to show any state changes
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
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

    if (value !== undefined && value !== null) {
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
        } catch (error) {
          this.logger.e("Failed to connect with new WebSocket URL:", error);
        }
        // Refresh the settings UI to indicate the change was saved
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } else if (key === "debugLogging") {
        this.debugLogging = value === true || value === "true";
        // Update global debug setting immediately
        setDebugEnabled(this.debugLogging);
        // Update WebSocket logger level - allow warnings/errors but not info/debug
        this.wsLogger.settings.minLevel = this.debugLogging ? 2 : 4;
        this.logger.i(
          `Debug logging ${this.debugLogging ? "enabled" : "disabled"}`
        );
        // Refresh the settings UI to indicate the change was saved
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } else if (key === "autoConnect") {
        const autoConnectEnabled = value === true || value === "true";
        this.storage.setItem("autoConnect", autoConnectEnabled.toString());
        this.logger.i(
          `Auto-connect ${autoConnectEnabled ? "enabled" : "disabled"}`
        );
        // If auto-connect is disabled and we're currently trying to connect, we might want to stop
        // But for now, just log the change - the connection logic will check this setting
        // Refresh the settings UI to indicate the change was saved
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } else if (key === "memoryThresholdMB") {
        const memMB = Math.max(50, parseInt(value as string) || 120);
        this.storage.setItem("memoryThresholdMB", memMB.toString());
        // Update the MemoryManager singleton directly
        MemoryManager.setMemoryThreshold(memMB, this.logger);
        this.logger.i(`Memory threshold updated to ${memMB}MB system-wide`);
        // Refresh the settings UI to indicate the change was saved
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      }
      // Other button handlers for captcha
      else if (key === "captchaInput") {
        // Store the captcha input for later submission
        this.storage.setItem("pendingCaptcha", value as string);
        this.logger.d("Captcha input stored");
        // Refresh the settings UI to indicate the change was saved
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } else if (key === "submitCaptcha") {
        const captchaCode = this.storage.getItem("pendingCaptcha");
        const captchaId = this.storage.getItem("currentCaptchaId");

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

          // Refresh the settings UI to remove captcha display
          this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        } catch (error) {
          this.logger.e("❌ Failed to submit captcha:", error);

          // Refresh the settings UI even on error
          this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          throw error;
        }
      } else if (key === "verifyCodeInput") {
        // Store the verification code input for later submission
        this.storage.setItem("pendingVerifyCode", value as string);
        this.logger.d("2FA verification code input stored");
        // Refresh the settings UI to indicate the change was saved
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } else if (key === "submitVerifyCode") {
        const verifyCode = this.storage.getItem("pendingVerifyCode");

        if (!verifyCode) {
          this.logger.w("⚠️ No verification code available");
          throw new Error("Please enter a 2FA verification code first");
        }

        this.logger.i("🔐 Submitting 2FA verification code...");
        try {
          const captchaId = this.storage.getItem("currentCaptchaId");
          if (!captchaId) {
            throw new Error(
              "No captcha ID available - captcha may be required first"
            );
          }

          await this.wsClient.commands.driver().setVerifyCode({
            captchaId,
            verifyCode,
          });
          this.logger.i("✅ 2FA verification code submitted successfully");
          // Clear stored verification code
          this.storage.removeItem("pendingVerifyCode");

          // Refresh the settings UI
          this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        } catch (error) {
          this.logger.e("❌ Failed to submit 2FA verification code:", error);

          // Refresh the settings UI even on error
          this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          throw error;
        }
      }
    }
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

    if (nativeId && nativeId.startsWith("station_")) {
      this.logger.d(`Getting station ${nativeId}`);

      // Return existing station or create new EufyStation
      let station = this.stations.get(nativeId);
      if (!station) {
        station = new EufyStation(nativeId, this.console, this.wsClient);
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
        // station.dispose(); // Station doesn't have dispose method, just clean up
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
    try {
      this.logger.d("🔌 Attempting WebSocket connection...");
      await this.wsClient.connect();

      // Wait for client to be ready (schema negotiation, etc.)
      await this.waitForClientReady();

      const serverState: StartListeningResponse =
        await this.wsClient.startListening();

      this.logger.d(
        "🔍 Raw startListening response:",
        JSON.stringify(serverState, null, 2)
      );

      // Register stations and devices from server state
      // IMPORTANT: Register stations first so they exist as parents for devices
      await this.registerStationsFromServerState(serverState);
      await this.registerDevicesFromServerState(serverState);

      this.logger.i("✅ WebSocket connection established successfully");
    } catch (error: any) {
      // Provide cleaner error messages for connection failures
      if (
        error.code === "ECONNREFUSED" ||
        error.message?.includes("ECONNREFUSED") ||
        error.name === "AggregateError"
      ) {
        this.logger.w(
          "⚠️ WebSocket connection refused - server not running or unreachable (127.0.0.1:3000)"
        );
      } else {
        // Only log the error message, not the full error object
        const errorMsg = error.message || "Unknown error";
        this.logger.e(`❌ WebSocket connection failed: ${errorMsg}`);
      }
      // Don't re-throw the error to prevent framework-level logging of full error details
      return;
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
        this.logger.i(`Captcha Image: ${event.captcha}`);

        // Store captcha ID for later use
        this.storage.setItem("currentCaptchaId", event.captchaId);

        // Store captcha image data for display (base64 encoded)
        this.storage.setItem("currentCaptchaImage", event.captcha);

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
        this.logger.i("🔴 Driver disconnected event received:", event);
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
}
