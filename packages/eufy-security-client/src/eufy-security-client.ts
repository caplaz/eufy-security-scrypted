/**
 * Eufy Security Client - High-level client interface for CLI usage
 *
 * This class provides a simplified interface for CLI applications to interact
 * with the Eufy Security WebSocket API. It wraps the ApiManager and provides
 * methods that match the expected CLI interface.
 */

import { ApiManager } from "./api-manager";
import { DEVICE_EVENTS } from "./device/constants";
import { getDeviceTypeName } from "./utils/device-detection";
import { Logger, ILogObj } from "tslog";
import { EventEmitter } from "events";

/**
 * Device information interface containing essential device metadata
 *
 * @interface DeviceInfo
 * @public
 */
export interface DeviceInfo {
  /** Human-readable device name */
  name: string;
  /** Unique device serial number identifier */
  serialNumber: string;
  /** Device type (e.g., "Camera", "Doorbell", "Battery Doorbell") */
  type: string;
  /** Serial number of the associated station (optional) */
  stationSerial?: string;
  /** Device model identifier (optional) */
  model?: string;
  /** Hardware version string (optional) */
  hardwareVersion?: string;
  /** Software/firmware version string (optional) */
  softwareVersion?: string;
}

/**
 * Configuration options for EufySecurityClient
 */
export interface EufySecurityClientConfig {
  /** WebSocket server URL (e.g., 'ws://localhost:3000') */
  wsUrl: string;
  /** Optional external logger instance compatible with tslog (e.g., ConsoleLogger from @caplaz/eufy-security-scrypted) */
  logger?: Logger<ILogObj>;
}

/**
 * High-level Eufy Security Client for CLI applications
 */
export class EufySecurityClient extends EventEmitter {
  private apiManager: ApiManager;
  private logger: Logger<ILogObj>;
  private devices: Map<string, DeviceInfo> = new Map();
  private isConnectedFlag = false;

  /**
   * Creates a new EufySecurityClient instance
   *
   * @param config - Configuration object containing WebSocket URL and optional logger
   *
   * @example
   * ```typescript
   * const client = new EufySecurityClient({
   *   wsUrl: "ws://localhost:3000"
   * });
   *
   * // With custom logger
   * const client = new EufySecurityClient({
   *   wsUrl: "ws://localhost:3000",
   *   logger: customLogger
   * });
   * ```
   */
  constructor(config: EufySecurityClientConfig) {
    super();

    // Use external logger if provided, otherwise create internal tslog logger
    this.logger =
      config.logger ??
      new Logger<ILogObj>({
        name: "EufySecurityClient",
        minLevel: 3, // Info level
      });

    // Create the API manager
    this.apiManager = new ApiManager(config.wsUrl, this.logger);

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Wait for the client to be ready (schema negotiation complete)
   *
   * @private
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 10000)
   * @throws {Error} When timeout is reached before client becomes ready
   */
  private async waitForReady(timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();

    while (!this.apiManager.isConnected()) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error("Timeout waiting for client to be ready");
      }

      // Wait 100ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Connect to the WebSocket server and initialize the client
   *
   * Establishes WebSocket connection, performs schema negotiation, connects to the driver,
   * starts listening for events, and loads available devices.
   *
   * @throws {Error} If connection, schema negotiation, or driver connection fails
   *
   * @example
   * ```typescript
   * await client.connect();
   * console.log('Client connected and ready');
   * ```
   */
  async connect(): Promise<void> {
    try {
      // Connect to WebSocket
      await this.apiManager.connect();

      // Wait for client to be ready (schema negotiation complete)
      await this.waitForReady();

      // Connect to driver
      await this.apiManager.connectDriver();

      // Start listening for events
      await this.apiManager.startListening();

      // Load devices
      await this.loadDevices();

      this.isConnectedFlag = true;
    } catch (error) {
      this.logger.error("Failed to connect:", error);
      throw error;
    }
  }

  /**
   * Disconnect from the WebSocket server and cleanup resources
   *
   * Gracefully closes the WebSocket connection and resets internal state.
   *
   * @example
   * ```typescript
   * await client.disconnect();
   * console.log('Client disconnected');
   * ```
   */
  async disconnect(): Promise<void> {
    this.isConnectedFlag = false;
    this.apiManager.disconnect();
  }

  /**
   * Check if client is connected and ready for operations
   *
   * @returns true if WebSocket is connected and client is ready for API calls
   *
   * @example
   * ```typescript
   * if (client.isConnected()) {
   *   const devices = await client.getDevices();
   * }
   * ```
   */
  isConnected(): boolean {
    return this.isConnectedFlag && this.apiManager.isConnected();
  }

  /**
   * Connect to the Eufy driver
   *
   * Establishes connection to the Eufy cloud driver. This is called automatically
   * by connect(), but can be called separately for more granular control.
   *
   * @throws {Error} If client not ready or driver connection fails
   *
   * @example
   * ```typescript
   * await client.connectDriver();
   * console.log('Driver connected');
   * ```
   */
  async connectDriver(): Promise<void> {
    if (!this.apiManager.isConnected()) {
      throw new Error("Client not connected. Call connect() first.");
    }

    await this.apiManager.connectDriver();
  }

  /**
   * Get all available devices from the connected Eufy account
   *
   * @returns Promise resolving to array of device information objects
   * @throws {Error} If client is not connected
   *
   * @example
   * ```typescript
   * const devices = await client.getDevices();
   * devices.forEach(device => {
   *   console.log(`Device: ${device.name} (${device.serialNumber})`);
   * });
   * ```
   */
  async getDevices(): Promise<DeviceInfo[]> {
    if (!this.isConnected()) {
      throw new Error("Client not connected. Call connect() first.");
    }

    return Array.from(this.devices.values());
  }

  /**
   * Start live streaming from a specific device
   *
   * @param deviceSerial - Serial number of the device to start streaming from
   * @throws {Error} If client is not connected or device is not found
   *
   * @example
   * ```typescript
   * await client.startStream("T8210N20123456789");
   *
   * // Listen for stream data
   * client.on('streamData', (data) => {
   *   console.log(`Received ${data.type} data: ${data.buffer.length} bytes`);
   * });
   * ```
   */
  async startStream(deviceSerial: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("Client not connected. Call connect() first.");
    }

    const device = this.devices.get(deviceSerial);
    if (!device) {
      throw new Error(`Device not found: ${deviceSerial}`);
    }

    try {
      const deviceCommand = this.apiManager.commands.device(deviceSerial);
      await deviceCommand.startLivestream();
      this.logger.info(`Started stream for device: ${deviceSerial}`);
    } catch (error) {
      this.logger.error(
        `Failed to start stream for device ${deviceSerial}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Stop live streaming from a specific device
   *
   * @param deviceSerial - Serial number of the device to stop streaming from
   * @throws {Error} If client is not connected or device is not found
   *
   * @example
   * ```typescript
   * await client.stopStream("T8210N20123456789");
   * console.log('Streaming stopped');
   * ```
   */
  async stopStream(deviceSerial: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("Client not connected. Call connect() first.");
    }

    const device = this.devices.get(deviceSerial);
    if (!device) {
      throw new Error(`Device not found: ${deviceSerial}`);
    }

    try {
      // First check if device is actually streaming
      const deviceCommand = this.apiManager.commands.device(deviceSerial);
      const streamingStatus = await deviceCommand.isLivestreaming();

      if (!streamingStatus.livestreaming) {
        this.logger.debug(`Device ${deviceSerial} is not currently streaming`);
        return;
      }

      // Only stop if actually streaming
      await deviceCommand.stopLivestream();
      this.logger.info(`Stopped stream for device: ${deviceSerial}`);
    } catch (error) {
      this.logger.error(
        `Failed to stop stream for device ${deviceSerial}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get pending CAPTCHA information
   *
   * Returns CAPTCHA information from the last CAPTCHA request event.
   * This is used by the CLI to display CAPTCHA information to the user.
   *
   * @returns CAPTCHA information or null if no CAPTCHA is pending
   */
  getPendingCaptcha(): { captchaId: string; captcha: string } | null {
    return this.apiManager.getPendingCaptcha();
  }

  /**
   * Clear pending CAPTCHA information
   *
   * Clears any stored CAPTCHA information after it has been used.
   */
  clearPendingCaptcha(): void {
    this.apiManager.clearPendingCaptcha();
  }

  /**
   * Get pending MFA information
   *
   * Returns MFA information from the last MFA request event.
   * This is used by the CLI to display MFA information to the user.
   *
   * @returns MFA information or null if no MFA is pending
   */
  getPendingMfa(): { methods: string[] } | null {
    return this.apiManager.getPendingMfa();
  }

  /**
   * Clear pending MFA information
   *
   * Clears any stored MFA information after it has been used.
   */
  clearPendingMfa(): void {
    this.apiManager.clearPendingMfa();
  }

  /**
   * Enhanced command API with more elegant fluent interface
   */
  get commands() {
    return this.apiManager.commands;
  }

  // Private methods

  /**
   * Set up event handlers for API manager events
   *
   * Configures listeners for device events, stream events, and data events.
   * Transforms API manager events into client-friendly events.
   *
   * @private
   */
  private setupEventHandlers(): void {
    // Listen for device events to populate device list
    this.apiManager.addEventListener("device added", (event) => {
      this.addDevice(event);
    });

    this.apiManager.addEventListener("device removed", (event) => {
      // The event structure may vary, so we'll handle it safely
      const serialNumber =
        (event as any).serialNumber || (event as any).device?.serialNumber;
      if (serialNumber) {
        this.removeDevice(serialNumber);
      }
    });

    // Forward stream events
    this.apiManager.addEventListener("livestream started", (event) => {
      this.logger.info("🎬 Livestream started event received:", event);
      // Emit as streamStarted for compatibility
      super.emit("streamStarted", event);
    });

    this.apiManager.addEventListener("livestream stopped", (event) => {
      this.logger.info("⏹️ Livestream stopped event received:", event);
      // Emit as streamStopped for compatibility
      super.emit("streamStopped", event);
    });

    this.apiManager.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA,
      (event) => {
        const bufferSize = event.buffer?.data?.length || 0;
        this.logger.debug(
          `📹 Video data received: ${bufferSize} bytes from device ${event.serialNumber}`
        );

        // Convert JSONBuffer to Buffer for compatibility
        const buffer = event.buffer
          ? Buffer.from(event.buffer.data)
          : Buffer.alloc(0);

        // Emit as streamData for compatibility, including video metadata
        super.emit("streamData", {
          type: "video",
          buffer: buffer,
          deviceSerial: event.serialNumber,
          metadata: event.metadata, // Pass through video metadata with dimensions
        });
      }
    );

    this.apiManager.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA,
      (event) => {
        const bufferSize = event.buffer?.data?.length || 0;
        this.logger.debug(
          `🎵 Audio data received: ${bufferSize} bytes from device ${event.serialNumber}`
        );

        // Convert JSONBuffer to Buffer for compatibility
        const buffer = event.buffer
          ? Buffer.from(event.buffer.data)
          : Buffer.alloc(0);

        // Emit as streamData for compatibility
        super.emit("streamData", {
          type: "audio",
          buffer: buffer,
          deviceSerial: event.serialNumber,
        });
      }
    );
  }

  /**
   * Load and cache device information from the server
   *
   * Retrieves device list from server response and fetches detailed properties
   * for each device. Handles errors gracefully by adding devices with minimal info.
   *
   * @private
   * @throws {Error} If server communication fails
   */
  private async loadDevices(): Promise<void> {
    try {
      // Get the start_listening response which should contain device list
      const startListeningResult = await this.apiManager.commands
        .server()
        .startListening();

      this.logger.info(
        "Start listening result:",
        JSON.stringify(startListeningResult, null, 2)
      );

      if (startListeningResult?.state?.devices) {
        const deviceSerials = startListeningResult.state.devices;
        this.logger.info(
          `Found ${deviceSerials.length} device(s):`,
          deviceSerials
        );

        // For each device serial, get the device properties
        for (const serialNumber of deviceSerials) {
          try {
            const deviceCommand = this.apiManager.commands.device(serialNumber);
            const deviceProps = await deviceCommand.getProperties();

            // Log only the keys to avoid massive binary data output
            this.logger.info(
              `Device ${serialNumber} property keys:`,
              Object.keys(deviceProps || {})
            );

            if (deviceProps?.properties) {
              this.logger.info(
                `Device ${serialNumber} nested property keys:`,
                Object.keys(deviceProps.properties).slice(0, 20) // Show first 20 keys
              );
            }

            // Extract properties from the nested structure
            const props = deviceProps?.properties || {};

            // Create device info from properties
            const deviceInfo: DeviceInfo = {
              name:
                (props as any)?.name ||
                (props as any)?.deviceName ||
                `Device ${serialNumber}`,
              serialNumber: serialNumber,
              type: this.getDeviceTypeName(
                (props as any)?.type || (props as any)?.deviceType || 0
              ),
              stationSerial:
                (props as any)?.stationSerial ||
                (props as any)?.station_sn ||
                "",
              model:
                (props as any)?.model ||
                (props as any)?.deviceModel ||
                "Unknown",
              hardwareVersion:
                (props as any)?.hardwareVersion ||
                (props as any)?.main_hw_version ||
                "Unknown",
              softwareVersion:
                (props as any)?.softwareVersion ||
                (props as any)?.main_sw_version ||
                "Unknown",
            };

            this.devices.set(serialNumber, deviceInfo);
            this.logger.info(
              `Added device: ${deviceInfo.name} (${deviceInfo.serialNumber})`
            );
          } catch (deviceError) {
            this.logger.warn(
              `Failed to get properties for device ${serialNumber}:`,
              deviceError
            );

            // Add device with minimal info
            const device: DeviceInfo = {
              name: `Device ${serialNumber}`,
              serialNumber: serialNumber,
              type: "Unknown",
              stationSerial: "",
              model: "Unknown",
              hardwareVersion: "Unknown",
              softwareVersion: "Unknown",
            };

            this.devices.set(serialNumber, device);
            this.logger.info(
              `Added device with minimal info: ${device.name} (${device.serialNumber})`
            );
          }
        }
      } else {
        this.logger.warn("No devices found in start_listening response");
      }

      this.logger.info(
        `Device loading completed. Total devices: ${this.devices.size}`
      );
    } catch (error) {
      this.logger.error("Failed to load devices:", error);
      throw error;
    }
  }

  /**
   * Add a device to the internal device cache
   *
   * @private
   * @param deviceData - Device data from server event
   */
  private addDevice(deviceData: any): void {
    const device: DeviceInfo = {
      name: deviceData.name || "Unknown Device",
      serialNumber: deviceData.serialNumber,
      type: this.getDeviceTypeName(deviceData.type),
      stationSerial: deviceData.stationSerial,
      model: deviceData.model,
      hardwareVersion: deviceData.hardwareVersion,
      softwareVersion: deviceData.softwareVersion,
    };

    this.devices.set(device.serialNumber, device);
    this.logger.debug(`Added device: ${device.name} (${device.serialNumber})`);
  }

  /**
   * Remove a device from the internal device cache
   *
   * @private
   * @param serialNumber - Serial number of device to remove
   */
  private removeDevice(serialNumber: string): void {
    if (this.devices.has(serialNumber)) {
      const device = this.devices.get(serialNumber);
      this.devices.delete(serialNumber);
      this.logger.debug(`Removed device: ${device?.name} (${serialNumber})`);
    }
  }

  /**
   * Convert device type number to human-readable name
   *
   * @private
   * @param type - Numeric device type from server
   * @returns Human-readable device type name
   */
  private getDeviceTypeName(type: number): string {
    return getDeviceTypeName(type);
  }

  // emit() method is inherited from EventEmitter
}
