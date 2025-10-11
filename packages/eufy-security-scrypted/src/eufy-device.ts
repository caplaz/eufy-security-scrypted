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
  BinarySensor,
  Brightness,
  Camera,
  Charger,
  MediaObject,
  MotionSensor,
  OnOff,
  PanTiltZoom,
  PanTiltZoomCommand,
  Refresh,
  RequestMediaStreamOptions,
  RequestPictureOptions,
  ResponseMediaStreamOptions,
  ResponsePictureOptions,
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
  DEVICE_EVENTS,
  DeviceEventSource,
  DeviceEventType,
  DeviceMotionDetectedEventPayload,
  DeviceRingsEventPayload,
  DeviceProperties,
  DevicePropertyChangedEventPayload,
  EVENT_SOURCES,
  EufyWebSocketClient,
  EventCallbackForType,
} from "@caplaz/eufy-security-client";

import { Logger, ILogObj } from "tslog";
import { StreamServer } from "@caplaz/eufy-stream-server";

// Device Services
import {
  DeviceSettingsService,
  DeviceStateService,
  RefreshService,
  SnapshotService,
  StreamService,
  StateChangeEvent,
} from "./services/device";
import { PropertyMapper } from "./utils/property-mapper";
import { VideoClipsService } from "./services/video";
import { PtzControlService, LightControlService } from "./services/control";

// Helper to create a transport function for routing tslog to Scrypted console
function createConsoleTransport(console: Console) {
  return (logObj: any) => {
    const meta = logObj._meta;
    if (!meta) return;
    const prefix = meta.name ? `[${meta.name}] ` : "";

    // Extract all non-meta properties as the log arguments
    const args = Object.keys(logObj)
      .filter((key) => key !== "_meta" && key !== "toJSON")
      .map((key) => logObj[key]);

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

/**
 * EufyDevice - TCP server implementation for VideoCamera
 */
export class EufyDevice
  extends ScryptedDeviceBase
  implements
    VideoCamera,
    VideoClips,
    Camera,
    MotionSensor,
    BinarySensor,
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
  private logger: Logger<ILogObj>;

  // Device info and state
  private latestProperties?: DeviceProperties;
  private propertiesLoaded: Promise<void>;

  // Services
  private settingsService!: DeviceSettingsService;
  private stateService!: DeviceStateService;
  private refreshService!: RefreshService;
  private videoClipsService!: VideoClipsService;
  private snapshotService!: SnapshotService;
  private streamService!: StreamService;
  private ptzControlService!: PtzControlService;
  private lightControlService!: LightControlService;

  private streamServer!: StreamServer;

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

  constructor(
    nativeId: string,
    wsClient: EufyWebSocketClient,
    parentLogger: Logger<ILogObj>
  ) {
    super(nativeId);
    this.wsClient = wsClient;

    // Create a sub-logger with this device's console
    // This ensures device logs appear in the device's log window in Scrypted
    // Use attachedTransports: [] to prevent inheriting parent's transport
    const loggerName = nativeId.charAt(0).toUpperCase() + nativeId.slice(1);
    this.logger = parentLogger.getSubLogger({
      name: loggerName,
      attachedTransports: [],
    });
    this.logger.attachTransport(createConsoleTransport(this.console));

    this.logger.info(`Created EufyDevice for ${nativeId}`);

    this.createStreamServer();
    this.initializeServices();

    // Properties changed event listener
    this.addEventListener(
      DEVICE_EVENTS.PROPERTY_CHANGED,
      this.handlePropertyChangedEvent.bind(this)
    );

    this.addEventListener(
      DEVICE_EVENTS.MOTION_DETECTED,
      this.handleMotionDetectedEvent.bind(this)
    );

    this.addEventListener(
      DEVICE_EVENTS.RINGS,
      this.handleDoorbellRingsEvent.bind(this)
    );

    // Listen for stream started/stopped events
    this.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_STARTED,
      () => {
        this.logger.info("Stream started");
      },
      {
        serialNumber: this.info?.serialNumber,
      }
    );
    this.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_STOPPED,
      () => {
        this.logger.debug("📻 WebSocket livestream stopped event received");
      },
      {
        serialNumber: this.info?.serialNumber,
      }
    );
    // Begin loading initial properties
    this.propertiesLoaded = this.loadInitialProperties();
  }

  /**
   * Initialize services for settings, state, refresh, and control management
   */
  private initializeServices() {
    // Initialize device API interface for services
    const deviceApi = {
      setProperty: async (propertyName: keyof DeviceProperties, value: any) => {
        await this.api.setProperty(propertyName, value);
      },
      getProperties: () => this.api.getProperties(),
      panAndTilt: async (options: any) => {
        await this.api.panAndTilt(options);
      },
    };

    // Initialize services
    this.settingsService = new DeviceSettingsService(deviceApi, this.logger);
    this.stateService = new DeviceStateService(this.logger);
    this.refreshService = new RefreshService(deviceApi, this.logger);
    this.videoClipsService = new VideoClipsService(this.wsClient, this.logger);
    this.snapshotService = new SnapshotService(
      this.serialNumber,
      this.streamServer,
      this.logger
    );
    this.streamService = new StreamService(
      this.serialNumber,
      this.streamServer,
      this.logger
    );
    this.ptzControlService = new PtzControlService(
      deviceApi,
      () => this.latestProperties?.type,
      this.logger
    );
    this.lightControlService = new LightControlService(deviceApi, this.logger);

    // Subscribe to state changes from the state service
    this.stateService.onStateChange((change: StateChangeEvent) => {
      this.logger.debug(`State changed: ${change.interface} = ${change.value}`);

      // Update device properties from state service (for Scrypted framework)
      this.syncStateToProperties();

      // Notify Scrypted of the change
      this.onDeviceEvent(change.interface, change.value);
    });

    // Subscribe to refresh completion
    this.refreshService.onRefreshComplete((properties) => {
      this.logger.debug("Refresh completed successfully");
      this.latestProperties = properties;
      this.stateService.updateFromProperties(properties);
      this.updatePtzCapabilities();
    });

    // Subscribe to refresh errors
    this.refreshService.onRefreshError((error) => {
      this.logger.warn(`Refresh failed: ${error.message}`);
    });

    // Subscribe to settings changes
    this.settingsService.onSettingsChange(() => {
      this.logger.debug("Settings changed, notifying Scrypted");
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    });
  }

  private async loadInitialProperties() {
    try {
      this.latestProperties = (await this.api.getProperties()).properties;
      this.updateStateFromProperties(this.latestProperties);
      this.updatePtzCapabilities(); // Update PTZ capabilities based on device type
    } catch (e) {
      this.logger.warn(`Failed to load initial properties: ${e}`);
    }
  }

  /**
   * Sync state from state service to device properties
   * Required because ScryptedDeviceBase properties need to be updated
   */
  private syncStateToProperties() {
    const state = this.stateService.getState();
    if (state.motionDetected !== undefined)
      this.motionDetected = state.motionDetected;
    if (state.binaryState !== undefined) this.binaryState = state.binaryState;
    if (state.brightness !== undefined) this.brightness = state.brightness;
    if (state.on !== undefined) this.on = state.on;
    if (state.batteryLevel !== undefined)
      this.batteryLevel = state.batteryLevel;
    if (state.chargeState !== undefined) this.chargeState = state.chargeState;
    if (state.sensors) this.sensors = state.sensors as any;
  }

  /**
   * Update device state from properties using DeviceStateService
   * This delegates to the state service which manages state conversion and notifications
   */
  private updateStateFromProperties(properties?: DeviceProperties) {
    if (!properties) return;

    // Delegate to state service for conversion and notifications
    this.stateService.updateFromProperties(properties);

    // Sync state to device properties once
    this.syncStateToProperties();
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

  /**
   * Handle property changed events using DeviceStateService
   * The state service handles state conversion and notifications
   */
  private handlePropertyChangedEvent({
    name,
    value,
  }: DevicePropertyChangedEventPayload) {
    // Update cached properties
    this.latestProperties = this.latestProperties && {
      ...this.latestProperties,
      [name]: value,
    };

    // Delegate to state service for state updates and notifications
    // The state service will call onDeviceEvent via our subscription
    // State is now accessed via getters, no need to sync back
    this.stateService.updateProperty(name, value);
  }

  /**
   * Handle motion detected events
   * Updates state via state service which handles notifications
   */
  private handleMotionDetectedEvent(event: DeviceMotionDetectedEventPayload) {
    // Update state service - it will notify via onStateChange callback
    this.stateService.updateProperty("motionDetected", event.state);
  }

  /**
   * Handle doorbell rings events
   * Updates binary state via state service which handles notifications
   */
  private handleDoorbellRingsEvent(event: DeviceRingsEventPayload) {
    // Update state service - it will notify via onStateChange callback
    this.stateService.updateState("binaryState", event.state);
  }

  // =================== SETTINGS INTERFACE ===================

  /**
   * Get device settings using DeviceSettingsService
   * Delegates to the settings service for UI generation
   */
  async getSettings(): Promise<Setting[]> {
    await this.propertiesLoaded;

    // Delegate to settings service
    return this.settingsService.getSettings(
      this.info! as any,
      this.latestProperties!,
      this.name || "Unknown Device"
    );
  }

  /**
   * Update device settings using DeviceSettingsService
   * Delegates to the settings service for property updates and custom settings
   */
  async putSetting(key: string, value: SettingValue): Promise<void> {
    // Callback to handle successful property updates
    const onSuccess = (settingKey: string, settingValue: SettingValue) => {
      // Update local properties if it's a device property
      if (settingKey in this.latestProperties!) {
        const propertyName = settingKey as keyof DeviceProperties;
        const metadata = this.info?.metadata?.[propertyName];
        const adjustedValue = metadata
          ? PropertyMapper.adjustValueForAPI(settingValue, metadata)
          : settingValue;

        this.latestProperties = this.latestProperties && {
          ...this.latestProperties,
          [propertyName]: adjustedValue,
        };
      }

      // Handle custom settings locally
      if (settingKey === "scryptedName") {
        this.name = settingValue as string;
      }
    };

    // Delegate to settings service
    await this.settingsService.putSetting(
      key,
      value,
      this.latestProperties!,
      this.info?.metadata || {},
      onSuccess
    );

    // Settings service will notify via onSettingsChange callback
  }

  // =================== PAN/TILT/ZOOM INTERFACE ===================

  /**
   * Update PTZ capabilities using PtzControlService
   */
  private updatePtzCapabilities() {
    // Delegate to PTZ control service
    (this as any).ptzCapabilities = this.ptzControlService.updateCapabilities();
  }

  /**
   * Execute PTZ command using PtzControlService
   * Delegates to the PTZ control service which handles command routing
   */
  async ptzCommand(command: PanTiltZoomCommand): Promise<void> {
    return this.ptzControlService.executeCommand(command);
  }

  // =================== LIGHT INTERFACE ===================

  /**
   * Turn light on using LightControlService
   * State will be updated via property change event
   */
  async turnOn(): Promise<void> {
    return this.lightControlService.turnOn();
  }

  /**
   * Turn light off using LightControlService
   * State will be updated via property change event
   */
  async turnOff(): Promise<void> {
    return this.lightControlService.turnOff();
  }

  /**
   * Set brightness using LightControlService
   * State will be updated via property change event
   */
  async setBrightness(brightness: number): Promise<void> {
    return this.lightControlService.setBrightness(brightness);
  }

  // =================== VIDEO CAMERA INTERFACE ===================

  /**
   * Get video stream options using StreamService
   * Delegates to the stream service which handles stream configuration
   */
  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    await this.propertiesLoaded;
    const quality = this.latestProperties?.videoStreamingQuality;
    return this.streamService.getVideoStreamOptions(quality);
  }

  /**
   * Get video stream using StreamService
   * Delegates to the stream service which handles stream server lifecycle and FFmpeg configuration
   */
  async getVideoStream(
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    await this.propertiesLoaded;
    const quality = this.latestProperties?.videoStreamingQuality;
    return this.streamService.getVideoStream(quality, options);
  }

  // =================== CAMERA INTERFACE ===================

  /**
   * Get picture options using StreamService for dimensions
   */
  async getPictureOptions(): Promise<ResponsePictureOptions[]> {
    await this.propertiesLoaded;

    // Get video dimensions based on device properties
    const quality = this.latestProperties?.videoStreamingQuality;
    const { width, height } = this.streamService.getVideoDimensions(quality);

    return [
      {
        id: "snapshot",
        name: "Snapshot",
        picture: {
          width,
          height,
          // JPEG will be created by converting the H.264 keyframe
        },
      },
    ];
  }

  /**
   * Take a picture/snapshot using SnapshotService
   * Delegates to the snapshot service which handles stream capture and JPEG conversion
   */
  async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    return this.snapshotService.takePicture(options);
  }

  // =================== REFRESH INTERFACE ===================

  /**
   * Get refresh frequency using RefreshService
   */
  async getRefreshFrequency(): Promise<number> {
    return this.refreshService.getRefreshFrequency();
  }

  /**
   * Refresh device properties using RefreshService
   * Delegates to the refresh service which handles API calls and notifications
   */
  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<void> {
    // Delegate to refresh service
    // The service will call our subscribed callbacks on success/error
    await this.refreshService.refresh(refreshInterface, userInitiated);
  }

  // =================== VIDEO CLIPS ===================

  // =================== VIDEO CLIPS ===================

  /**
   * Get video clips using VideoClipsService
   * Delegates to the video clips service which handles both P2P and cloud API retrieval
   */
  async getVideoClips(options?: VideoClipOptions): Promise<VideoClip[]> {
    try {
      // Ensure properties are loaded
      await this.propertiesLoaded;

      const stationSN = this.latestProperties?.stationSerialNumber;
      if (!stationSN) {
        this.logger.error("Station serial number not available");
        return [];
      }

      const startTime =
        options?.startTime || Date.now() - 7 * 24 * 60 * 60 * 1000; // Default to last 7 days
      const endTime = options?.endTime || Date.now();

      // Delegate to video clips service
      return await this.videoClipsService.getClips({
        serialNumber: this.serialNumber,
        stationSerialNumber: stationSN,
        startTime,
        endTime,
      });
    } catch (error) {
      this.logger.error(`Error fetching video clips: ${error}`);
      return [];
    }
  }

  /**
   * Get a video clip by ID using VideoClipsService
   * Delegates to the service which handles P2P and cloud downloads
   */
  async getVideoClip(videoId: string): Promise<MediaObject> {
    return this.videoClipsService.downloadClip(videoId, this.serialNumber);
  }

  /**
   * Get a video clip thumbnail by ID using VideoClipsService
   * Delegates to the service which handles cached and P2P thumbnails
   */
  async getVideoClipThumbnail(
    thumbnailId: string,
    _options?: VideoClipThumbnailOptions
  ): Promise<MediaObject> {
    return this.videoClipsService.downloadThumbnail(
      thumbnailId,
      this.serialNumber
    );
  }

  /**
   * Remove video clips (not supported by Eufy API)
   */
  async removeVideoClips(...videoClipIds: string[]): Promise<void> {
    this.logger.warn(
      `Video clip deletion not currently supported by Eufy API: ${videoClipIds.join(", ")}`
    );
    throw new Error(
      "Video clip deletion is not supported by the Eufy Security API"
    );
  }

  // =================== UTILITY METHODS ===================

  /**
   * Creates a new stream server.
   * Stream server lifecycle is now managed by StreamService.
   */
  private createStreamServer(): void {
    this.streamServer = new StreamServer({
      port: 0, // Let the system assign a free port
      host: "127.0.0.1", // Only allow connections from localhost
      logger: this.logger, // Pass tslog Logger directly
      wsClient: this.wsClient,
      serialNumber: this.serialNumber,
    });

    this.logger.debug(
      "Stream server created with WebSocket client integration"
    );
  }

  /**
   * Clean up resources on disposal
   */
  dispose(): void {
    // Dispose stream service (will stop stream server if running)
    this.streamService
      .dispose()
      .catch((e: unknown) =>
        this.logger.warn(`Error disposing stream service: ${e}`)
      );

    // Clean up all event listeners for this device
    // This removes video data, and other device event listeners
    const removedCount = this.wsClient.removeEventListenersBySerialNumber(
      this.serialNumber,
      EVENT_SOURCES.DEVICE
    );

    this.logger.debug(
      `Removed ${removedCount} event listeners during disposal`
    );
  }
}
