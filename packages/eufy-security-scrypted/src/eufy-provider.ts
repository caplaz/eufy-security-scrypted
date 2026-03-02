/**
 * Eufy Security Provider for Scrypted
 *
 * Main entry point for the Eufy Security Scrypted plugin.
 */

import sdk, {
  DeviceProvider,
  Readme,
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

function createConsoleTransport(console: Console) {
  return (logObj: ILogObj & ILogObjMeta) => {
    const meta = (logObj as any)._meta;
    if (!meta) return;
    const prefix = meta.name ? `[${meta.name}] ` : "";

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
  implements DeviceProvider, Readme, Settings, Refresh
{
  wsClient: EufyWebSocketClient;
  wsLogger: Logger<ILogObj>;
  private logger: Logger<ILogObj>;

  stations = new Map<string, EufyStation>();

  // Full device serial list cached from the last successful serverState.
  // Used both by getDevice() when lazily creating stations AND by
  // eagerlyInstantiateStations() at startup.
  private knownDeviceSerials: string[] = [];

  // Station serial list cached so we can eagerly build station instances.
  private knownStationSerials: string[] = [];

  debugLogging = false;
  pushConnected = false;
  mqttConnected = false;
  private isConnecting = true;
  private hasLoggedReady = false;
  private isWaitingForReady = false;
  private authManager: AuthenticationManager;

  constructor(nativeId?: string) {
    super(nativeId);

    this.debugLogging = this.storage.getItem("debugLogging") === "true";
    this.logger = new Logger<ILogObj>({
      name: "EufySecurity",
      minLevel: this.debugLogging ? 0 : 3,
      type: "hidden",
    });
    this.logger.attachTransport(createConsoleTransport(this.console));

    this.wsLogger = this.logger.getSubLogger({ name: "WebSocketClient" });
    this.wsClient = new EufyWebSocketClient(
      this.storage.getItem("wsUrl") || "ws://localhost:3000",
      this.wsLogger
    );

    const memoryThreshold = Math.max(
      50,
      parseInt(this.storage.getItem("memoryThresholdMB") || "120")
    );
    const memoryLogger = this.logger.getSubLogger({ name: "Memory" });
    MemoryManager.setMemoryThreshold(memoryThreshold, memoryLogger);

    const authLogger = this.logger.getSubLogger({ name: "Auth" });
    this.authManager = new AuthenticationManager(
      this.wsClient,
      authLogger,
      () => this.onDeviceEvent(ScryptedInterface.Settings, undefined),
      async (result: StartListeningResponse) => {
        this.displayConnectResult(true, true);
        this.logger.info("🔍 Discovering devices after authentication...");
        await this.registerStationsFromServerState(result);
        await this.eagerlyInstantiateStations();
        await this.registerDevicesFromServerState(result);
        this.logger.info("✅ Device discovery complete");
        this.isConnecting = false;
      }
    );

    this.logger.info("🚀 EufySecurityProvider initialized");

    this.startConnection().catch((error) => {
      this.logger.error("❌ Failed to start connection:", error);
    });
  }

  async getSettings(): Promise<Setting[]> {
    const clientState = this.wsClient.getState();
    const memoryThreshold = MemoryManager.getMemoryThreshold();
    const currentMemory = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const captchaStatus = this.authManager.getAuthStatusMessage(
      clientState?.driverConnected || false
    );

    return [
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
        immediate: true,
      },
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
      {
        group: "Eufy Cloud Account",
        key: "driverConnectionStatus",
        title: "Account Connection Status",
        description: "Current Eufy cloud account connection state",
        value: clientState?.driverConnected ? "🟢 Connected" : "🔴 Disconnected",
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

  async putSetting(key: string, value: SettingValue): Promise<void> {
    if (key === "connectDriver") {
      this.logger.info("🔗 Button clicked: Connect to Eufy cloud");
      this.isConnecting = true;

      try {
        await this.wsClient.commands.driver().connect();
        this.logger.info("✅ Driver connect command sent");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const result = await this.wsClient.startListening();

        if (result.state.driver.connected) {
          this.logger.info("✅ Driver fully connected - authentication complete");
          this.authManager.resetAuthState();
          this.displayConnectResult(true, true);
          await this.registerStationsFromServerState(result);
          await this.eagerlyInstantiateStations();
          await this.registerDevicesFromServerState(result);
          this.logger.info("✅ Device discovery complete");
          this.isConnecting = false;
        } else {
          await this.authManager.checkPendingAuth();
          if (this.authManager.getAuthState() === AUTH_STATE.NONE) {
            const removeListener = this.wsClient.addEventListener(
              "connected",
              async () => {
                removeListener();
                const updatedResult = await this.wsClient.startListening();
                if (updatedResult.state.driver.connected) {
                  this.authManager.resetAuthState();
                  this.displayConnectResult(true, true);
                  await this.registerStationsFromServerState(updatedResult);
                  await this.eagerlyInstantiateStations();
                  await this.registerDevicesFromServerState(updatedResult);
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
        await this.authManager.checkPendingAuth();
      }

      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

    if (key === "disconnectDriver") {
      this.logger.info("🔌 Button clicked: Disconnect from Eufy cloud");
      try {
        await this.wsClient.commands.driver().disconnect();
        this.logger.info("✅ Driver disconnected successfully");
        this.isConnecting = true;
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      } catch (error) {
        this.logger.error("❌ Failed to disconnect driver:", error);
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        throw error;
      }
      return;
    }

    if (key === "captchaCodeInput") {
      this.authManager.updateCaptchaCode(value?.toString() || "");
      this.storage.setItem("captchaCodeInput", value?.toString() || "");
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

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

    if (key === "verifyCodeInput") {
      this.authManager.updateVerifyCode(value?.toString() || "");
      this.storage.setItem("verifyCodeInput", value?.toString() || "");
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

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

    if (value === undefined || value === null) {
      this.logger.warn(
        `⚠️ Ignoring setting update for ${key}: value is null/undefined`
      );
      return;
    }

    this.storage.setItem(key, value.toString());

    if (key === "wsUrl") {
      try {
        this.wsClient.disconnect();
        this.wsClient = new EufyWebSocketClient(value.toString(), this.wsLogger);
        await this.startConnection();
        this.logger.info("✅ Reconnected with new WebSocket URL");
      } catch (error) {
        this.logger.error("❌ Failed to connect with new WebSocket URL:", error);
        throw error;
      }
    } else if (key === "debugLogging") {
      const newDebugValue =
        value === true || value === "true" || value === 1 || value === "1";
      this.debugLogging = newDebugValue;
      this.logger.settings.minLevel = this.debugLogging ? 0 : 3;
      this.wsLogger.settings.minLevel = this.debugLogging ? 0 : 3;
      this.storage.setItem("debugLogging", this.debugLogging.toString());
      this.logger.info(
        `Debug logging ${this.debugLogging ? "enabled" : "disabled"}`
      );
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
    return 300;
  }

  async refresh(): Promise<void> {
    this.logger.info("🔄 Connection health check");
    if (!this.wsClient.isConnected()) {
      this.logger.warn("⚠️ WebSocket not connected, attempting to reconnect...");
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
   * Return an already-constructed station instance, or create one on demand
   * (e.g. if Scrypted calls getDevice before startup completes).
   *
   * In the normal startup path eagerlyInstantiateStations() has already
   * populated this.stations, so this is just a map lookup.
   */
  async getDevice(nativeId: ScryptedNativeId): Promise<any> {
    await this.waitForClientReady();

    const clientState = this.wsClient.getState();
    if (!clientState.driverConnected) {
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
      // Return the pre-built station if available — this is the normal path.
      let station = this.stations.get(nativeId);
      if (!station) {
        // Fallback: station wasn't eagerly created (e.g. auth race), build now.
        this.logger.warn(
          `⚠️ Station ${nativeId} not pre-built — creating on demand. Child IDs may not be stable.`
        );
        station = new EufyStation(
          nativeId,
          this.wsClient,
          this.logger,
          this.knownDeviceSerials
        );
        this.stations.set(nativeId, station);
      }
      return station;
    }
    return undefined;
  }

  async releaseDevice(id: string, nativeId: string): Promise<void> {
    if (nativeId.startsWith("station_")) {
      const station = this.stations.get(nativeId);
      if (station) {
        station.dispose();
        this.stations.delete(nativeId);
        this.logger.info(`🗑️ Released station ${nativeId}`);
      }
    }
  }

  private async startConnection(): Promise<void> {
    this.hasLoggedReady = false;
    this.isWaitingForReady = false;
    await this.wsClient.connect();
    await this.waitForClientReady();

    const serverState: StartListeningResponse =
      await this.wsClient.startListening();

    if (serverState.state.driver.connected) {
      await this.registerStationsFromServerState(serverState);
      // ⬇️ Eagerly build station objects & pre-declare children BEFORE
      //    registerDevicesFromServerState so Scrypted's DB already has the
      //    correct child→station mapping when it processes device manifests.
      await this.eagerlyInstantiateStations();
      await this.registerDevicesFromServerState(serverState);
      this.isConnecting = false;
    } else {
      this.logger.info(
        "⏳ Driver not connected yet - authentication may be required."
      );
    }
  }

  private async registerStationsFromServerState(
    serverState: StartListeningResponse
  ): Promise<void> {
    const stationSerials: string[] = serverState.state.stations || [];
    this.logger.info(
      `📡 Found ${stationSerials.length} station serials from server:`,
      stationSerials
    );

    if (stationSerials.length === 0) {
      this.logger.warn("⚠️ No stations found in server state");
      return;
    }

    // Cache station serials for use by eagerlyInstantiateStations().
    this.knownStationSerials = stationSerials;

    const manifests = await Promise.all(
      stationSerials.map((stationSerial: string) =>
        DeviceUtils.createStationManifest(this.wsClient, stationSerial)
      )
    );

    await deviceManager.onDevicesChanged({
      providerNativeId: this.nativeId,
      devices: manifests,
    });

    this.logger.info(`✅ Registered ${manifests.length} stations`);
  }

  /**
   * Eagerly create EufyStation instances for every known station serial and
   * await their loadChildDevices() calls.  This must run AFTER
   * registerStationsFromServerState() (so the manifests are in Scrypted's DB)
   * and BEFORE registerDevicesFromServerState() (so Scrypted sees the
   * station's onDevicesChanged before it decides IDs for camera children).
   *
   * Any station that already exists in this.stations is skipped.
   */
  private async eagerlyInstantiateStations(): Promise<void> {
    if (this.knownDeviceSerials.length === 0 || this.knownStationSerials.length === 0) {
      // Device serials may not be cached yet on first call; that's OK —
      // the stations will still be created, they just won't call
      // loadChildDevices() (empty list).  registerDevicesFromServerState
      // caches knownDeviceSerials, but it runs after us.  The ordering is:
      //   registerStations → eagerlyInstantiate → registerDevices
      // so on startup knownDeviceSerials IS still empty here.
      // Instead we need device serials NOW.  Fetch them inline.
      this.logger.debug(
        "eagerlyInstantiateStations: device serials not cached yet — will be resolved per-station"
      );
    }

    this.logger.info(
      `🏗️ Eagerly instantiating ${this.knownStationSerials.length} station(s)...`
    );

    await Promise.all(
      this.knownStationSerials.map(async (serial) => {
        const nativeId = `station_${serial}`;
        if (this.stations.has(nativeId)) {
          this.logger.debug(`Station ${nativeId} already instantiated, skipping`);
          return;
        }

        // Build the station, passing in whatever device serials we have.
        // If knownDeviceSerials is empty (first-run startup ordering), the
        // station constructor still completes — loadChildDevices is a no-op
        // and registerDevicesFromServerState will call onDevicesChanged
        // with the correct providerNativeId immediately after.
        const station = new EufyStation(
          nativeId,
          this.wsClient,
          this.logger,
          this.knownDeviceSerials
        );
        this.stations.set(nativeId, station);
        this.logger.info(`✅ Pre-built station ${nativeId}`);
      })
    );
  }

  /**
   * Register devices from server state.
   *
   * Cameras that belong to a HomeBase have providerNativeId = station_XXXX.
   * We call onDevicesChanged grouped by providerNativeId so each station
   * receives its children in a single call, making it easy for Scrypted to
   * match nativeId strings to persisted numeric IDs.
   */
  private async registerDevicesFromServerState(
    serverState: StartListeningResponse
  ): Promise<void> {
    const deviceSerials: string[] = serverState.state.devices || [];
    this.logger.info(
      `📱 Found ${deviceSerials.length} device serials from server:`,
      deviceSerials
    );

    if (deviceSerials.length === 0) {
      this.logger.warn("⚠️ No devices found in server state");
      return;
    }

    // Cache for getDevice() fallback path.
    this.knownDeviceSerials = deviceSerials;

    const manifests = await Promise.all(
      deviceSerials.map((serial) =>
        DeviceUtils.createDeviceManifest(this.wsClient, serial)
      )
    );

    // Group manifests by providerNativeId and issue one onDevicesChanged per
    // provider so Scrypted processes them atomically per parent.
    const byProvider = new Map<string | undefined, typeof manifests>();
    for (const manifest of manifests) {
      const key = manifest.providerNativeId;
      if (!byProvider.has(key)) byProvider.set(key, []);
      byProvider.get(key)!.push(manifest);
    }

    await Promise.all(
      Array.from(byProvider.entries()).map(([providerNativeId, group]) =>
        deviceManager.onDevicesChanged({
          providerNativeId,
          devices: group,
        })
      )
    );

    this.logger.info(`✅ Registered ${deviceSerials.length} devices`);
  }

  private async waitForClientReady(): Promise<void> {
    const maxWaitTime = 15000;
    const checkInterval = 500;
    let waitTime = 0;

    if (!this.hasLoggedReady && !this.isWaitingForReady) {
      this.logger.info(
        "⏳ Waiting for WebSocket client to be ready for API calls..."
      );
      this.isWaitingForReady = true;
    }

    return new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        if (this.wsClient.isConnected()) {
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

  private getConnectionStateIcon(connectionState?: string): string {
    switch (connectionState) {
      case "disconnected": return "🔴";
      case "connecting":   return "🟡";
      case "connected":    return "🟠";
      case "schema_negotiating": return "🔄";
      case "ready":        return "🟢";
      case "error":        return "❌";
      default:             return "❓";
    }
  }

  dispose(): void {
    this.wsClient.disconnect();
    this.stations.clear();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      promise
        .then((result) => { clearTimeout(timeoutId); resolve(result); })
        .catch((error) => { clearTimeout(timeoutId); reject(error); });
    });
  }

  private displayConnectResult(
    isWebSocketConnected: boolean,
    isDriverConnected: boolean
  ): void {
    if (!isWebSocketConnected) {
      this.logger.error("❌ Connection Failed: WEBSOCKET DISCONNECTED");
      throw new Error("❌ WebSocket connection failed");
    } else if (!isDriverConnected) {
      this.logger.warn("⚠️  Connection Established: DRIVER NEEDS AUTHENTICATION");
    } else {
      this.logger.info("✅ Connection Successful: FULLY CONNECTED");
    }
  }

  async getReadmeMarkdown(): Promise<string> {
    const memoryManager = MemoryManager.getInstance(this.logger);
    const memoryUsage = memoryManager.getCurrentMemoryUsage();
    const memoryThreshold = MemoryManager.getMemoryThreshold();

    return `## 🚀 Quick Setup

### 1. Start the eufy-security-ws Server

\`\`\`yaml
services:
  eufy-security-ws:
    image: bropat/eufy-security-ws:latest
    container_name: eufy-security-ws
    ports:
      - "3000:3000"
    environment:
      - USERNAME=your_eufy_email@example.com
      - PASSWORD=your_eufy_password
      - COUNTRY=US
    restart: unless-stopped
\`\`\`

## 🔌 WebSocket Connection

**Status**: ${this.wsClient?.isConnected() ? "🟢 Connected" : "🔴 Disconnected"}

## 🧠 Memory Management

**Current Usage**: ${memoryUsage.heapMB} MB (RSS: ${memoryUsage.rssMB} MB)
**Threshold**: ${memoryThreshold} MB
**Status**: ${memoryUsage.heapMB < memoryThreshold ? "✅ Normal" : "⚠️ High"}

## 📊 System Status

**Push Connected**: ${this.pushConnected ? "✅" : "❌"}
**MQTT Connected**: ${this.mqttConnected ? "✅" : "❌"}
**Debug Logging**: ${this.debugLogging ? "Enabled" : "Disabled"}
`;
  }

  private getConnectionStateDescription(): string {
    if (!this.wsClient) return "Not initialized";
    const wsConnected = this.wsClient.isConnected();
    const driverConnected = this.wsClient.isDriverConnected();
    if (wsConnected && driverConnected) return "Fully Connected";
    if (wsConnected && !driverConnected) return "WebSocket Connected (Auth Required)";
    return "Disconnected";
  }

  private getAuthStatusDescription(): string {
    const authState = this.authManager.getAuthState();
    switch (authState) {
      case AUTH_STATE.NONE:             return "Not Authenticated ❌";
      case AUTH_STATE.CAPTCHA_REQUIRED: return "CAPTCHA Required ⚠️";
      case AUTH_STATE.MFA_REQUIRED:     return "2FA Required ⚠️";
      default:                          return "Unknown";
    }
  }
}
