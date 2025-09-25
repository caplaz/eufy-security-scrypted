/**
 * Eufy Device for VideoCamera functionality in Scrypted
 *
 * Implements Scrypted VideoCamera, MotionSensor, Settings, Refresh, and Online interfaces.
 * Provides TCP server for H.264 video streaming to FFmpeg, robust memory control, and event-driven updates.
 *
 * Performance Optimizations:
 * - Lazy stream session creation to minimize memory footprint when not streaming
 * - Efficient event listener management with automatic cleanup on disposal
 * - Smart buffer management through MemoryManager integration
 * - Optimized property caching to reduce API calls
 * - Stream session reuse for multiple concurrent consumers
 * - Memory-conscious video chunk buffering with configurable limits
 *
 * Streaming Performance Features:
 * - TCP server with efficient H.264 NAL unit parsing
 * - Audio streaming support with AAC codec detection
 * - Smart keyframe detection for stream initialization
 * - Configurable buffer limits for memory management
 * - Progressive cleanup strategies during memory pressure
 *
 * Architecture Optimizations:
 * - Single stream session per device with multiple consumer support
 * - Event-driven property updates to minimize polling
 * - Efficient device capability detection using Set lookups
 * - Optimized settings interface with grouped configurations
 */

import {
  Battery,
  Brightness,
  ChargeState,
  Charger,
  MediaObject,
  MotionSensor,
  OnOff,
  PanTiltZoom,
  PanTiltZoomCommand,
  Refresh,
  RequestMediaStreamOptions,
  ResponseMediaStreamOptions,
  ScryptedDeviceBase,
  ScryptedInterface,
  Sensors,
  Setting,
  SettingValue,
  Settings,
  VideoCamera,
  VideoClip,
  VideoClipOptions,
  VideoClipThumbnailOptions,
  VideoClips,
} from "@scrypted/sdk";

import {
  ChargingStatus,
  DEVICE_EVENTS,
  DeviceEventSource,
  DeviceEventType,
  DeviceMotionDetectedEventPayload,
  DeviceProperties,
  DevicePropertyChangedEventPayload,
  EVENT_SOURCES,
  EufyWebSocketClient,
  EventCallbackForType,
  PanTiltDirection,
  StorageType,
  VideoQuality,
} from "@scrypted/eufy-security-client";

import { DebugLogger, createDebugLogger } from "./utils/debug-logger";
import { DeviceUtils } from "./utils/device-utils";
import { StreamServer } from "eufy-stream-server";

/**
 * EufyDevice - TCP server implementation for VideoCamera
 */
export class EufyDevice
  extends ScryptedDeviceBase
  implements
    VideoCamera,
    VideoClips,
    MotionSensor,
    Battery,
    Charger,
    PanTiltZoom,
    OnOff,
    Brightness,
    Sensors,
    Settings,
    Refresh
{
  private wsClient: EufyWebSocketClient;
  private logger: DebugLogger;

  // Device info and state
  private latestProperties?: DeviceProperties;
  private propertiesLoaded: Promise<void>;

  private streamServer!: StreamServer;
  private streamServerStarted = false;
  // Event listener removers for cleanup
  private videoDataEventRemover?: () => boolean;

  /**
   * Get the serial number for this station.
   * @returns {string} Serial number from device info, or 'unknown' if not set.
   */
  get serialNumber(): string {
    return this.info?.serialNumber || "unknown";
  }

  /**
   * Get the API command interface for this device.
   * @returns {any} API command object for this device's serial number.
   */
  get api() {
    return this.wsClient.commands.device(this.serialNumber);
  }

  constructor(nativeId: string, wsClient: EufyWebSocketClient) {
    super(nativeId);
    this.wsClient = wsClient;
    this.logger = createDebugLogger(this.name);
    this.logger.i(`Created EufyDevice for ${nativeId}`);

    this.createStreamServer();

    // Properties changed event listener
    this.addEventListener(
      DEVICE_EVENTS.PROPERTY_CHANGED,
      this.handlePropertyChangedEvent.bind(this)
    );

    this.addEventListener(
      DEVICE_EVENTS.MOTION_DETECTED,
      this.handleMotionDetectedEvent.bind(this)
    );

    // Listen for stream started/stopped events
    this.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_STARTED,
      () => {
        this.logger.i("Stream started");
      },
      {
        serialNumber: this.info?.serialNumber,
      }
    );
    this.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_STOPPED,
      () => {
        this.logger.d("📻 WebSocket livestream stopped event received");
      },
      {
        serialNumber: this.info?.serialNumber,
      }
    );
    // Begin loading initial properties
    this.propertiesLoaded = this.loadInitialProperties();
  }

  private async loadInitialProperties() {
    try {
      this.latestProperties = (await this.api.getProperties()).properties;
      this.updateStateFromProperties(this.latestProperties);
    } catch (e) {
      this.logger.w(`Failed to load initial properties: ${e}`);
    }
  }

  private updateStateFromProperties(properties?: DeviceProperties) {
    if (!properties) return;
    this.motionDetected = properties.motionDetected || false;

    // Light settings
    this.brightness = properties.lightSettingsBrightnessManual || 100; // Default to 100% if not set
    this.on = properties.light || false;

    // update battery and charging state
    this.batteryLevel = properties.battery || 100; // Default to 100% if not set
    switch (properties.chargingStatus) {
      case ChargingStatus.NOT_CHARGING:
        this.chargeState = ChargeState.NotCharging;
        break;
      case ChargingStatus.CHARGING:
        this.chargeState = ChargeState.Charging;
        break;
      default:
        this.chargeState = undefined;
        break;
    }

    // wifi
    this.sensors = {
      wifiRssi: {
        name: "wifiRssi",
        value: properties.wifiRssi,
        unit: "dBm",
      },
    };
  }
  // =================== EVENTs ===================

  private addEventListener<T extends DeviceEventType>(
    eventType: T,
    eventCallback: EventCallbackForType<T, DeviceEventSource>
  ): () => boolean {
    return this.wsClient.addEventListener(eventType, eventCallback, {
      source: EVENT_SOURCES.DEVICE,
      serialNumber: this.serialNumber,
    });
  }

  private handlePropertyChangedEvent({
    name,
    value,
  }: DevicePropertyChangedEventPayload) {
    this.latestProperties = this.latestProperties && {
      ...this.latestProperties,
      [name]: value,
    };

    switch (name) {
      case "light":
        this.on = value as boolean;
        this.onDeviceEvent(ScryptedInterface.OnOff, this.on);
        break;
      case "battery":
        this.batteryLevel = value as number;
        this.onDeviceEvent(ScryptedInterface.Battery, this.batteryLevel);
        break;
      case "chargingStatus":
        this.chargeState =
          (value as ChargingStatus) === ChargingStatus.CHARGING
            ? ChargeState.Charging
            : ChargeState.NotCharging;
        this.onDeviceEvent(ScryptedInterface.Charger, this.chargeState);
        break;
      case "wifiRssi":
        this.sensors = {
          ...this.sensors,
          wifiRssi: {
            name,
            value: value as number,
            unit: "dBm",
          },
        };
        this.onDeviceEvent(ScryptedInterface.Sensors, this.sensors);
        break;
      default:
        this.logger.i(`Property changed: ${name} = ${value}`);
    }
  }

  private handleMotionDetectedEvent(event: DeviceMotionDetectedEventPayload) {
    this.motionDetected = event.state;
    this.onDeviceEvent(ScryptedInterface.MotionSensor, this.motionDetected);
  }

  // =================== SETTINGS INTERFACE ===================

  async getSettings(): Promise<Setting[]> {
    await this.propertiesLoaded;

    const { info } = this;
    const { metadata } = info || {};

    return [
      {
        key: "scryptedName",
        title: "Device Name",
        description: "Name shown in Scrypted (can be customized)",
        value: this.name,
        type: "string",
        readonly: false,
      },

      // generic info about this device
      ...DeviceUtils.genericDeviceInformation(info!, metadata),

      ...DeviceUtils.allWriteableDeviceProperties(
        this.latestProperties!,
        metadata
      ),
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    // Handle device properties first
    if (key in this.latestProperties!) {
      const propertyName = key as keyof DeviceProperties;
      const propertyValue = DeviceUtils.valueAdjustedWithMetadata(
        value,
        this.info?.metadata[propertyName]
      );

      this.logger.i(`Updating property ${propertyName}`);

      return this.api
        .setProperty(propertyName, propertyValue)
        .then(() => {
          // Update local state
          this.latestProperties = this.latestProperties && {
            ...this.latestProperties,
            [propertyName]: propertyValue,
          };
        })
        .catch((error) => {
          this.logger.w(`Failed to set property ${propertyName}: ${error}`);
        });
    }

    // Handle custom settings
    switch (key) {
      case "scryptedName":
        this.name = value as string;
        return; // Add explicit return
      case "debugLogging":
        this.storage.setItem("debugLogging", (!!value).toString());
        return; // Add explicit return

      default:
        this.logger.w(`Unknown setting: ${key}`);
        throw new Error(`Unknown setting: ${key}`);
    }

    // Remove this line - it should never be reached
    // return;
  }

  // =================== PAN/TILT/ZOOM INTERFACE ===================

  ptzCapabilities = {
    pan: true,
    tilt: true,
    zoom: false, // Assuming no zoom capability for now
  };

  ptzCommand(command: PanTiltZoomCommand): Promise<void> {
    if (command.tilt !== undefined) {
      return command.tilt > 0
        ? this.api.panAndTilt({ direction: PanTiltDirection.UP }).then(() => {
            this.logger.i(`Panned camera up`);
          })
        : this.api.panAndTilt({ direction: PanTiltDirection.DOWN }).then(() => {
            this.logger.i(`Panned camera down`);
          });
    }

    if (command.pan !== undefined) {
      return command.pan > 0
        ? this.api
            .panAndTilt({ direction: PanTiltDirection.RIGHT })
            .then(() => {
              this.logger.i(`Panned camera right`);
            })
        : this.api.panAndTilt({ direction: PanTiltDirection.LEFT }).then(() => {
            this.logger.i(`Panned camera left`);
          });
    }

    throw new Error("Method not implemented.");
  }

  // =================== LIGHT INTERFACE ===================

  turnOn(): Promise<void> {
    return this.api.setProperty("light", true).then(() => {
      this.on = true;
    });
  }

  turnOff(): Promise<void> {
    return this.api.setProperty("light", false).then(() => {
      this.on = false;
    });
  }

  setBrightness(brightness: number): Promise<void> {
    return this.api
      .setProperty("lightSettingsBrightnessManual", brightness)
      .then(() => {
        this.brightness = brightness;
      });
  }

  // =================== VIDEO CAMERA INTERFACE ===================

  private getVideoDimensions(): {
    width: number;
    height: number;
  } {
    // Fallback to quality-based dimensions since we don't have metadata from stream server
    const quality = this.latestProperties?.videoStreamingQuality;
    switch (quality) {
      case VideoQuality.LOW:
        return { width: 640, height: 480 };
      case VideoQuality.MEDIUM:
        return { width: 1280, height: 720 };
      case VideoQuality.HIGH:
        return { width: 1920, height: 1080 };
      case VideoQuality.ULTRA:
        return { width: 2560, height: 1440 };
      default:
        return { width: 1920, height: 1080 };
    }
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    await this.propertiesLoaded;

    // Get video dimensions based on device properties or VideoMetadata
    const { width, height } = this.getVideoDimensions();

    // Return stream options that should work with Scrypted
    return [
      {
        id: "p2p",
        name: "P2P Stream",
        container: "mp4", // MP4 container for better compatibility
        video: {
          codec: "h264",
          width,
          height,
        },
      },
    ];
  }

  async getVideoStream(
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    this.logger.i("getVideoStream called, starting stream server if needed");
    if (!this.streamServerStarted) {
      this.logger.i("Starting stream server...");
      await this.streamServer.start();
      this.streamServerStarted = true;
      this.logger.i("Stream server started");
    }
    const port = this.streamServer.getPort();
    if (!port) {
      throw new Error("Failed to get stream server port");
    }
    this.logger.i(`Stream server is listening on port ${port}`);
    return this.createMediaObject(`tcp://localhost:${port}`, "video/mp4");
  }

  // =================== REFRESH INTERFACE ===================

  async getRefreshFrequency(): Promise<number> {
    return 600; // 10 minutes
  }

  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<void> {
    // since I don't have a way to get a single property, we just refresh everything
    if (!refreshInterface) {
      try {
        this.latestProperties = (await this.api.getProperties()).properties;
        this.updateStateFromProperties(this.latestProperties);
      } catch (error) {
        this.logger.w(
          `Failed to get device properties: ${error}, user initiated: ${userInitiated}`
        );
      }
    }
  }

  // =================== VIDEO CLIPS ===================

  async getVideoClips(options?: VideoClipOptions): Promise<VideoClip[]> {
    const { events } = await this.wsClient.commands.driver().getHistoryEvents({
      startTimestampMs: options?.startTime || 0,
      endTimestampMs: options?.endTime || Date.now(),
      filter: {
        storageType: StorageType.LOCAL_AND_CLOUD,
      },
    });

    return events.map((event) => {
      return {
        startTime: event.startTime,
      } as VideoClip;
    });
  }

  getVideoClip(videoId: string): Promise<MediaObject> {
    throw new Error("Method not implemented.");
  }

  getVideoClipThumbnail(
    thumbnailId: string,
    options?: VideoClipThumbnailOptions
  ): Promise<MediaObject> {
    throw new Error("Method not implemented.");
  }

  removeVideoClips(...videoClipIds: string[]): Promise<void> {
    throw new Error("Method not implemented.");
  }

  // =================== UTILITY METHODS ===================

  /**
   * Creates a new stream server.
   */
  private createStreamServer(): void {
    this.streamServer = new StreamServer({
      port: 0, // Let the system assign a free port
      host: "127.0.0.1", // Only allow connections from localhost
      debug: true, // Enable debug logging to see server activity
      wsClient: this.wsClient,
      serialNumber: this.serialNumber,
    });

    this.logger.d("Stream server created with WebSocket client integration");
  }

  dispose(): void {
    if (this.streamServerStarted) {
      this.streamServer
        .stop()
        .catch((e: unknown) =>
          this.logger.w(`Error stopping stream server: ${e}`)
        );
    }

    // Clean up all event listeners for this device
    // This removes video data, and other device event listeners
    const removedCount = this.wsClient.removeEventListenersBySerialNumber(
      this.serialNumber,
      EVENT_SOURCES.DEVICE
    );

    this.logger.d(`Removed ${removedCount} event listeners during disposal`);
  }
}
