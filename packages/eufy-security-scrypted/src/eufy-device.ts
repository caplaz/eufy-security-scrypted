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
  FFmpegInput,
  Intercom,
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
  ScryptedMimeTypes,
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
import sdk from "@scrypted/sdk";

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
  STATION_EVENTS,
} from "@caplaz/eufy-security-client";

import { Logger, ILogObj } from "tslog";
import { ChildProcess, spawn } from "child_process";
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
import { CompatibilityMode } from "./services/device/stream-selector";
import { PropertyMapper } from "./utils/property-mapper";
import {
  acquireStationSlot,
  isStationSlotHeldByOther,
  otherDeviceDeliveringOnStation,
} from "./utils/station-stream-coordinator";
import { recycleSuppression, RECYCLE_SUPPRESS_MS } from "./utils/recycle-guard";
import {
  shouldRefreshThumbnail,
  nextRefreshBackoffMs,
  resolveRefreshChoice,
  THUMBNAIL_REFRESH_CHOICES,
  THUMBNAIL_REFRESH_DEFAULT_CHOICE,
} from "./utils/thumbnail-refresh";

const THUMBNAIL_REFRESH_SETTING_KEY = "thumbnailRefreshInterval";
const COMPATIBILITY_MODE_SETTING_KEY = "compatibilityMode";
const COMPATIBILITY_MODE_CHOICES: CompatibilityMode[] = [
  "Auto",
  "Force",
  "Native",
];
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
    Refresh,
    Intercom
{
  private wsClient: EufyWebSocketClient;
  private logger: Logger<ILogObj>;
  private talkbackProcess?: ChildProcess;
  private talkbackActive = false;
  private intercomStartedLivestream = false;

  // Station P2P recycle bookkeeping. When the stream server reports the
  // upstream as wedged (startLivestream acked but no LIVESTREAM_VIDEO_DATA
  // events), we attempt to recycle the bropat-side station P2P session
  // via station.disconnect()/connect(). Rate-limited to avoid storms — a
  // wedge that survives recycling means the problem is deeper than the
  // bropat client (eufy-security-ws process, network, or Eufy's relay).
  private lastStationRecycleAt = 0;
  private stationRecycleInFlight = false;
  private readonly MIN_STATION_RECYCLE_INTERVAL_MS = 5 * 60 * 1000;
  // Chronic-failure guard: a camera that can't stream (no signal / dead)
  // shouldn't keep recycling the shared HomeBase and disrupting its healthy
  // siblings. Count recycles that didn't recover us; once over the cap (or if
  // we report no signal), suppress recycles until `recycleSuppressedUntil`.
  // Reset when video actually flows (livestreamActive).
  private consecutiveFailedRecycles = 0;
  private recycleSuppressedUntil = 0;

  // Background thumbnail refresh bookkeeping. A timer periodically wakes this
  // camera (at background priority, gated by the station coordinator) to keep
  // its cached thumbnail reasonably fresh — but only when the HomeBase slot is
  // free and the cache is stale, with exponential backoff for cameras that
  // never deliver video.
  private thumbnailRefreshInterval?: ReturnType<typeof setInterval>;
  private thumbnailRefreshKick?: ReturnType<typeof setTimeout>;
  private consecutiveRefreshFailures = 0;
  private refreshBackoffUntil = 0;
  private readonly THUMBNAIL_REFRESH_CHECK_MS = 5 * 60 * 1000; // check every 5 min
  private readonly THUMBNAIL_REFRESH_CAPTURE_TIMEOUT_MS = 55 * 1000;

  // Device info and state
  private latestProperties?: DeviceProperties;
  private propertiesLoaded: Promise<void>;
  private stateReady = false;

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
    parentLogger: Logger<ILogObj>,
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
      this.handlePropertyChangedEvent.bind(this),
    );

    this.addEventListener(
      DEVICE_EVENTS.MOTION_DETECTED,
      this.handleMotionDetectedEvent.bind(this),
    );

    this.addEventListener(
      DEVICE_EVENTS.RINGS,
      this.handleDoorbellRingsEvent.bind(this),
    );

    // Listen for stream started/stopped events
    this.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_STARTED,
      () => {
        this.logger.info("Stream started");
      },
      {
        serialNumber: this.info?.serialNumber,
      },
    );
    this.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_STOPPED,
      () => {
        this.logger.debug("📻 WebSocket livestream stopped event received");
      },
      {
        serialNumber: this.info?.serialNumber,
      },
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
      this.logger,
    );
    this.streamService = new StreamService(
      this.serialNumber,
      this.streamServer,
      this.logger,
      { compatibilityMode: () => this.getCompatibilityMode() },
    );
    this.ptzControlService = new PtzControlService(
      deviceApi,
      () => this.latestProperties?.type,
      this.logger,
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
    } finally {
      this.stateReady = true;
    }
  }

  /**
   * Sync state from state service to device properties
   * Required because ScryptedDeviceBase properties need to be updated
   */
  private syncStateToProperties() {
    if (!this.stateReady) return;
    const state = this.stateService.getState();
    if (
      state.motionDetected !== undefined &&
      !this.hasExternalMotionSensorMixin()
    )
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
   * True when the user has attached Scrypted's "Custom Motion Sensor"
   * extension to this camera. That mixin replaces the camera's motion
   * source with an external sensor (the documented Scrypted way to drive
   * HKSV from a better sensor), so Eufy-reported motion must not
   * overwrite it (#26). Scrypted doesn't expose which mixin owns an
   * interface, so detection is by the extension's device name. Fails
   * open: any lookup problem means Eufy motion keeps working.
   */
  private hasExternalMotionSensorMixin(): boolean {
    try {
      return (this.mixins || []).some((mixinId) => {
        const mixinDevice = sdk.systemManager.getDeviceById(mixinId);
        return mixinDevice?.name === "Custom Motion Sensor";
      });
    } catch {
      return false;
    }
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
    eventCallback: EventCallbackForType<T, DeviceEventSource>,
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
    const settings = this.settingsService.getSettings(
      this.info! as any,
      this.latestProperties!,
      this.name || "Unknown Device",
    );

    // Per-camera background thumbnail refresh interval (battery vs freshness).
    settings.push({
      key: THUMBNAIL_REFRESH_SETTING_KEY,
      title: "Background Thumbnail Refresh",
      description:
        "How stale this camera's grid thumbnail may get before it is briefly " +
        "woken to refresh it. Wakes only when the camera is idle and the " +
        "HomeBase is free — never interrupts live view or recording. Lower = " +
        "fresher tiles but more battery; choose Off or a long interval for " +
        "battery/LTE cameras.",
      value:
        (this.storage.getItem(THUMBNAIL_REFRESH_SETTING_KEY) as string) ||
        THUMBNAIL_REFRESH_DEFAULT_CHOICE,
      choices: Object.keys(THUMBNAIL_REFRESH_CHOICES),
      group: "Streaming",
    });

    settings.push({
      key: COMPATIBILITY_MODE_SETTING_KEY,
      title: "H.264 Compatibility Mode",
      description:
        "Auto uses the H.264 relay only for a live, verified H.265 source " +
        "when a compatibility stream is requested. Force requires that relay " +
        "for verified H.265 sources; Native always keeps the camera's native " +
        "codec. The relay consumes host CPU and can increase prebuffer startup " +
        "time, so Auto is the recommended default.",
      value: this.getCompatibilityMode(),
      choices: COMPATIBILITY_MODE_CHOICES,
      group: "Streaming",
    });

    return settings;
  }

  /**
   * Update device settings using DeviceSettingsService
   * Delegates to the settings service for property updates and custom settings
   */
  async putSetting(key: string, value: SettingValue): Promise<void> {
    // Per-camera thumbnail refresh interval — stored locally, not a device prop.
    if (key === THUMBNAIL_REFRESH_SETTING_KEY) {
      this.storage.setItem(key, String(value));
      this.logger.info(`🖼️  Background thumbnail refresh set to: ${value}`);
      return;
    }

    if (key === COMPATIBILITY_MODE_SETTING_KEY) {
      if (
        typeof value !== "string" ||
        !COMPATIBILITY_MODE_CHOICES.includes(value as CompatibilityMode)
      ) {
        throw new Error(`Invalid H.264 compatibility mode: ${String(value)}`);
      }
      this.storage.setItem(key, value);
      this.logger.info(`🎬 H.264 compatibility mode set to: ${value}`);
      this.onDeviceEvent(ScryptedInterface.VideoCamera, undefined);
      this.onDeviceEvent(ScryptedInterface.Settings, undefined);
      return;
    }

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
      onSuccess,
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
    options?: RequestMediaStreamOptions,
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
    userInitiated?: boolean,
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
    _options?: VideoClipThumbnailOptions,
  ): Promise<MediaObject> {
    return this.videoClipsService.downloadThumbnail(
      thumbnailId,
      this.serialNumber,
    );
  }

  /**
   * Remove video clips (not supported by Eufy API)
   */
  async removeVideoClips(...videoClipIds: string[]): Promise<void> {
    this.logger.warn(
      `Video clip deletion not currently supported by Eufy API: ${videoClipIds.join(", ")}`,
    );
    throw new Error(
      "Video clip deletion is not supported by the Eufy Security API",
    );
  }

  // =================== INTERCOM INTERFACE ===================

  /**
   * Wait for a device event for this device's serial number. The listener
   * self-removes on first match or on timeout.
   */
  private waitForDeviceEvent<T extends DeviceEventType>(
    eventType: T,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let remove: (() => boolean) | undefined;
      const timeout = setTimeout(() => {
        remove?.();
        reject(new Error(`Timed out waiting for "${eventType}"`));
      }, timeoutMs);
      // The waiter is a fail-safe — don't keep the event loop alive on
      // its own. If the wait promise is abandoned (e.g. caller threw
      // before awaiting it), we don't want to delay process exit.
      timeout.unref?.();
      const callback: EventCallbackForType<T, DeviceEventSource> = () => {
        clearTimeout(timeout);
        remove?.();
        resolve();
      };
      remove = this.wsClient.addEventListener(eventType, callback, {
        source: EVENT_SOURCES.DEVICE,
        serialNumber: this.serialNumber,
      });
    });
  }

  async startIntercom(media: MediaObject): Promise<void> {
    // Scrypted can call startIntercom mid-session. Re-entering is fine as
    // long as we tear the previous session down cleanly first.
    if (this.talkbackActive) {
      await this.stopIntercom();
    }

    // Talkback on Eufy requires an active livestream owned by our ws
    // session. Start it ourselves if not already running — the camera
    // returns "device_livestream_not_running" otherwise.
    let livestreaming = false;
    try {
      const status = await this.api.isLivestreaming();
      livestreaming = status.livestreaming;
    } catch (e) {
      throw new Error(
        `Failed to query livestream status before starting talkback: ${e}`,
      );
    }
    if (!livestreaming) {
      this.logger.info("Starting livestream to host talkback session");
      const livestreamStarted = this.waitForDeviceEvent(
        DEVICE_EVENTS.LIVESTREAM_STARTED,
        10000,
      );
      await this.api.startLivestream();
      await livestreamStarted;
      this.intercomStartedLivestream = true;
    }

    // Start talkback and wait for confirmation. bropat's client emits
    // "talkback started" once the camera has opened its receive channel;
    // writing before that event silently drops the audio.
    this.logger.info("Starting talkback session on device");
    const talkbackStarted = this.waitForDeviceEvent(
      DEVICE_EVENTS.TALKBACK_STARTED,
      10000,
    );
    // Always attach a handler — the promise has its own 10s timeout, and
    // if startTalkback throws below we'd leak an unhandled rejection
    // when that timeout eventually fires.
    talkbackStarted.catch(() => {});
    try {
      await this.api.startTalkback();
    } catch (e) {
      this.logger.warn(`Failed to start talkback: ${e}`);
      if (this.intercomStartedLivestream) {
        this.intercomStartedLivestream = false;
        await this.api.stopLivestream().catch(() => {});
      }
      throw e;
    }
    await talkbackStarted;
    this.talkbackActive = true;
    this.logger.info("Talkback ready — forwarding audio");

    // Transcode the incoming intercom audio to AAC-LC/ADTS at 16 kHz mono
    // 16 kbps — the exact format bropat's eufy-security-client expects on
    // the talkback channel.
    const ffmpegInput =
      await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(
        media,
        ScryptedMimeTypes.FFmpegInput,
      );

    const args = [
      ...(ffmpegInput.inputArguments ?? []),
      "-vn",
      "-acodec",
      "aac",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "16k",
      "-f",
      "adts",
      "pipe:1",
    ];

    this.talkbackProcess = spawn("ffmpeg", args);

    this.talkbackProcess.stdout?.on("data", (chunk: Buffer) => {
      if (!this.talkbackActive) return;
      this.api.talkbackAudioData(chunk).catch((e) => {
        this.logger.warn(`Failed to send talkback audio chunk: ${e}`);
      });
    });

    this.talkbackProcess.stderr?.on("data", (data: Buffer) => {
      this.logger.debug(`Talkback FFmpeg: ${data.toString().trim()}`);
    });

    this.talkbackProcess.on("error", (e) => {
      this.logger.error(`Talkback FFmpeg process error: ${e}`);
    });

    this.talkbackProcess.on("exit", (code) => {
      this.logger.debug(`Talkback FFmpeg exited with code ${code}`);
      this.talkbackProcess = undefined;
    });
  }

  async stopIntercom(): Promise<void> {
    if (this.talkbackProcess) {
      this.talkbackProcess.kill();
      this.talkbackProcess = undefined;
    }

    // Only send the stop command if we actually started talkback. Scrypted
    // fires stopIntercom() during every WebRTC teardown, and hammering the
    // camera with "device_talkback_not_running" errors can destabilize the
    // P2P session and take down the video feed.
    if (this.talkbackActive) {
      this.talkbackActive = false;
      try {
        await this.api.stopTalkback();
      } catch (e) {
        this.logger.warn(`Failed to stop talkback: ${e}`);
      }
    }

    // If we bootstrapped the livestream just for the intercom, stop it —
    // but only if no other stream clients are watching.
    if (this.intercomStartedLivestream) {
      this.intercomStartedLivestream = false;
      const hasViewers = this.streamServer.getActiveConnectionCount() > 0;
      if (!hasViewers) {
        try {
          await this.api.stopLivestream();
        } catch (e) {
          this.logger.warn(`Failed to stop livestream: ${e}`);
        }
      }
    }
  }

  // =================== UTILITY METHODS ===================

  /**
   * Creates a new stream server.
   * Stream server lifecycle is now managed by StreamService.
   */
  private createStreamServer(): void {
    // Load the last-detected codec from Scrypted device storage so the
    // very first `getVideoStream()` call after a plugin reload advertises
    // the correct codec. Without this hint, downstream consumers (the
    // Rebroadcast plugin, in particular) set up sync-frame detection for
    // H.264 NAL types and never find a keyframe in an H.265 stream —
    // HomeKit's transcoder then sees "Unable to find sync frame in rtsp
    // prebuffer" and the session dies at the 30s timeout.
    const storedCodec = this.storage.getItem("lastDetectedVideoCodec") as
      | "H264"
      | "H265"
      | null;
    const initialVideoCodec =
      storedCodec === "H264" || storedCodec === "H265"
        ? storedCodec
        : undefined;
    if (initialVideoCodec) {
      this.logger.info(
        `🎬 Using stored codec hint for stream server: ${initialVideoCodec}`,
      );
    }

    this.streamServer = new StreamServer({
      port: 0, // Let the system assign a free port
      host: "127.0.0.1", // Only allow connections from localhost
      logger: this.logger, // Pass tslog Logger directly
      wsClient: this.wsClient,
      serialNumber: this.serialNumber,
      initialVideoCodec,
      // Serialize streaming across cameras on the same HomeBase (one P2P
      // stream at a time). Live always wins (preempting); background
      // (thumbnail refresh) is denied while the slot is busy.
      acquireStreamSlot: (priority, onRevoke) =>
        acquireStationSlot(
          this.getStationSN(),
          this.serialNumber,
          priority,
          onRevoke,
        ),
    });

    // Restore the last thumbnail keyframe from storage so the camera's tile
    // shows its last-seen image immediately after a plugin reload — no wake,
    // no post-restart refresh stampede.
    this.restoreThumbnailKeyframe();

    // Persist live-detected codec so the next plugin restart starts with
    // the right hint. The event fires exactly once per stream-server
    // instance (on the first video data event).
    this.streamServer.on(
      "metadataReceived",
      (metadata: { videoCodec?: string }) => {
        const codec = metadata?.videoCodec?.toUpperCase();
        const normalized =
          codec === "H265" || codec === "HEVC" ? "H265" : "H264";
        const previous = this.storage.getItem("lastDetectedVideoCodec");
        if (previous !== normalized) {
          this.storage.setItem("lastDetectedVideoCodec", normalized);
          this.logger.info(
            `💾 Persisted detected video codec: ${normalized} (was: ${previous ?? "unset"})`,
          );
          // Stream options carry the source codec. A live session may replace
          // a persisted startup hint, so ask Scrypted to fetch fresh options.
          this.onDeviceEvent(ScryptedInterface.VideoCamera, undefined);
        }
      },
    );

    this.streamServer.on(
      "upstreamWedged",
      (info: {
        serialNumber: string;
        reason: "cold-start-counter-maxed" | "data-flow-stale";
        attempts?: number;
        staleMs?: number;
        consumers?: number;
      }) => {
        this.recycleStationP2P(info).catch((e) =>
          this.logger.warn(`Station P2P recycle threw: ${e}`),
        );
      },
    );

    this.streamServer.on("livestreamActive", () => {
      // We're streaming again — recycling (if any) worked. Clear the chronic-
      // failure guard so a future genuine wedge gets its recovery chance.
      // (The coordinator tracks "delivering" via the lease for the recycle
      // guard's sibling check.)
      this.consecutiveFailedRecycles = 0;
      this.recycleSuppressedUntil = 0;
    });
    this.streamServer.on("livestreamInactive", () => {
      // The camera just stopped — save its last frame so the tile survives a
      // reload. (Populated by any stream: live view, motion recording, etc.)
      this.persistThumbnailKeyframe();
    });

    this.startThumbnailRefresh();

    this.logger.debug(
      "Stream server created with WebSocket client integration",
    );
  }

  private getCompatibilityMode(): CompatibilityMode {
    const stored = this.storage.getItem(
      COMPATIBILITY_MODE_SETTING_KEY,
    ) as CompatibilityMode | null;
    return stored === "Auto" || stored === "Force" || stored === "Native"
      ? stored
      : "Auto";
  }

  /**
   * Serial of the station (HomeBase) this device belongs to. 4G LTE cameras
   * are their own station, so this falls back to the device serial.
   */
  private getStationSN(): string {
    return this.latestProperties?.stationSerialNumber || this.serialNumber;
  }

  private static readonly THUMBNAIL_KEYFRAME_STORAGE_KEY =
    "lastThumbnailKeyframe";
  // Keyframes are small (compressed H.264/H.265, typically 10–110 KB). Cap to
  // avoid bloating Scrypted's storage if a frame is unexpectedly large.
  private static readonly MAX_PERSISTED_KEYFRAME_BYTES = 220 * 1024;

  /** Save the current cached keyframe to storage so the tile survives reload. */
  private persistThumbnailKeyframe(): void {
    try {
      const cached = this.streamServer?.getCachedKeyframe(
        Number.POSITIVE_INFINITY,
      );
      if (!cached) return;
      if (cached.data.length > EufyDevice.MAX_PERSISTED_KEYFRAME_BYTES) return;
      this.storage.setItem(
        EufyDevice.THUMBNAIL_KEYFRAME_STORAGE_KEY,
        JSON.stringify({
          data: cached.data.toString("base64"),
          codec: cached.codec,
        }),
      );
    } catch (e) {
      this.logger.debug(`Persisting thumbnail keyframe failed: ${e}`);
    }
  }

  /** Restore a persisted keyframe into the stream server's cache (no wake). */
  private restoreThumbnailKeyframe(): void {
    try {
      const raw = this.storage.getItem(
        EufyDevice.THUMBNAIL_KEYFRAME_STORAGE_KEY,
      );
      if (!raw) return;
      const parsed = JSON.parse(raw) as { data?: string; codec?: string };
      if (
        parsed?.data &&
        (parsed.codec === "H264" || parsed.codec === "H265")
      ) {
        this.streamServer.setCachedKeyframe(
          Buffer.from(parsed.data, "base64"),
          parsed.codec,
        );
        this.logger.info(
          "🖼️  Restored last thumbnail from storage (no camera wake)",
        );
      }
    } catch (e) {
      this.logger.debug(`Restoring thumbnail keyframe failed: ${e}`);
    }
  }

  /**
   * Start the periodic background thumbnail refresh. Staggered per device so
   * cameras on the same HomeBase don't all check at once. Each tick wakes the
   * camera only if its cache is stale AND the HomeBase slot is free AND we're
   * not in failure backoff — so it never competes with a live view/recording
   * and never hammers a dead camera.
   */
  private startThumbnailRefresh(): void {
    // Deterministic per-device stagger across the check interval.
    let hash = 0;
    for (let i = 0; i < this.serialNumber.length; i++) {
      hash = (hash * 31 + this.serialNumber.charCodeAt(i)) >>> 0;
    }
    const stagger = hash % this.THUMBNAIL_REFRESH_CHECK_MS;

    this.thumbnailRefreshKick = setTimeout(() => {
      this.runThumbnailRefreshTick().catch(() => {});
      this.thumbnailRefreshInterval = setInterval(() => {
        this.runThumbnailRefreshTick().catch(() => {});
      }, this.THUMBNAIL_REFRESH_CHECK_MS);
    }, stagger);
  }

  /** One background-refresh evaluation; wakes the camera only if warranted. */
  private async runThumbnailRefreshTick(): Promise<void> {
    if (!this.streamServer) return;

    // Per-camera interval (default 2h). "Off" disables the refresh entirely.
    const thresholdMs = resolveRefreshChoice(
      this.storage.getItem(THUMBNAIL_REFRESH_SETTING_KEY) as string | undefined,
    );
    if (thresholdMs === null) return;

    const cached = this.streamServer.getCachedKeyframe(
      Number.POSITIVE_INFINITY,
    );
    const cacheAgeMs = cached ? cached.ageMs : null;
    const slotBusy = isStationSlotHeldByOther(
      this.getStationSN(),
      this.serialNumber,
    );
    const backoffRemainingMs = Math.max(
      0,
      this.refreshBackoffUntil - Date.now(),
    );

    if (
      !shouldRefreshThumbnail({
        cacheAgeMs,
        slotBusy,
        backoffRemainingMs,
        thresholdMs,
      })
    ) {
      return;
    }

    this.logger.info(
      `🖼️  Background thumbnail refresh (cache ${cacheAgeMs === null ? "empty" : Math.round(cacheAgeMs / 60000) + "min old"})`,
    );
    try {
      // Background-priority wake (the coordinator denies if the slot is taken).
      // The captured keyframe is cached by the stream server for snapshots.
      await this.streamServer.captureSnapshot(
        this.THUMBNAIL_REFRESH_CAPTURE_TIMEOUT_MS,
      );
      this.consecutiveRefreshFailures = 0;
      this.refreshBackoffUntil = 0;
      this.logger.info("🖼️  Thumbnail refreshed from background wake");
    } catch {
      this.consecutiveRefreshFailures++;
      const backoff = nextRefreshBackoffMs(this.consecutiveRefreshFailures);
      this.refreshBackoffUntil = Date.now() + backoff;
      this.logger.info(
        `🖼️  Thumbnail refresh did not complete (#${this.consecutiveRefreshFailures}) — backing off ${Math.round(backoff / 60000)}min`,
      );
    }
  }

  /**
   * Recycle the upstream bropat-side P2P session for this device's station.
   *
   * Triggered when the stream server's circuit breaker concludes that the
   * upstream is wedged (startLivestream is acked but no LIVESTREAM_VIDEO_DATA
   * arrives). For 4G LTE cameras the device IS its own station, so this
   * disconnects/reconnects just the one camera's P2P session. For
   * HomeBase-attached cameras it affects every camera on that station.
   *
   * The recycle is rate-limited and serialized: if a recycle is already
   * in flight or one ran within MIN_STATION_RECYCLE_INTERVAL_MS, we skip.
   * The next consumer that attaches will trigger a fresh startLivestream
   * organically — we deliberately don't auto-retry from here, so the
   * outcome of the recycle is observable in the next consumer's lifecycle.
   */
  private async recycleStationP2P(info: {
    reason: "cold-start-counter-maxed" | "data-flow-stale";
    attempts?: number;
    staleMs?: number;
    consumers?: number;
  }): Promise<void> {
    const now = Date.now();

    // Guard A: recycles suppressed for this camera (chronic failure / no
    // signal) — protect the healthy cameras on the shared HomeBase.
    if (now < this.recycleSuppressedUntil) {
      this.logger.warn(
        `⏭️  Not recycling HomeBase for ${this.serialNumber} — suppressed ${Math.round((this.recycleSuppressedUntil - now) / 60000)} more min (camera not recovering; protecting siblings). Fix this camera's signal/power.`,
      );
      return;
    }

    if (this.stationRecycleInFlight) {
      this.logger.info(
        "⏭️  Skipping station P2P recycle — another recycle is already in flight",
      );
      return;
    }
    const sinceLast = now - this.lastStationRecycleAt;
    if (
      this.lastStationRecycleAt !== 0 &&
      sinceLast < this.MIN_STATION_RECYCLE_INTERVAL_MS
    ) {
      this.logger.warn(
        `⏭️  Skipping station P2P recycle — last attempt was ${Math.round(
          sinceLast / 1000,
        )}s ago (min interval: ${Math.round(
          this.MIN_STATION_RECYCLE_INTERVAL_MS / 1000,
        )}s). Upstream wedge appears persistent across recycles — likely needs eufy-security-ws restart.`,
      );
      return;
    }

    const stationSN = this.getStationSN();
    const isSelfStation = stationSN === this.serialNumber;

    // Guard: a recycle disconnects/reconnects the whole HomeBase, which
    // interrupts every camera on it. If a sibling on this station is
    // actively delivering video, don't tear its session down — defer the
    // recycle. We've already cleared our own livestream intent (in
    // markUpstreamWedged), so the next consumer that attaches to this
    // device will retry organically; by then the sibling may be idle.
    // Self-station 4G cameras have no siblings, so they never defer.
    if (!isSelfStation) {
      const busySibling = otherDeviceDeliveringOnStation(
        stationSN,
        this.serialNumber,
      );
      if (busySibling) {
        this.logger.warn(
          `⏭️  Deferring station P2P recycle for ${stationSN} — sibling ${busySibling} is actively streaming on this HomeBase. Will retry on next consumer attach.`,
        );
        return;
      }
    }

    // Guards B/C: a camera that can't stream (no WiFi signal) or that hasn't
    // recovered after a recycle shouldn't keep recycling the shared HomeBase
    // and disrupting healthy siblings. Suppress and fail fast instead.
    const suppression = recycleSuppression({
      isSelfStation,
      signalLevel: this.latestProperties?.wifiSignalLevel,
      consecutiveFailedRecycles: this.consecutiveFailedRecycles,
    });
    if (suppression.suppress) {
      this.recycleSuppressedUntil = now + RECYCLE_SUPPRESS_MS;
      const why =
        suppression.reason === "no-signal"
          ? `reports no WiFi signal (level 0) — can't stream regardless`
          : `still wedged after ${this.consecutiveFailedRecycles} recycle(s) without recovering`;
      this.logger.warn(
        `🚫 ${this.serialNumber} ${why}. Suppressing HomeBase (${stationSN}) recycles for ${Math.round(RECYCLE_SUPPRESS_MS / 60000)}min to protect sibling cameras. Fix this camera's signal/power.`,
      );
      return;
    }
    // We're going ahead with a recycle. Count it as a failure until video
    // actually flows (the livestreamActive handler resets this on recovery).
    this.consecutiveFailedRecycles++;

    const triggerContext =
      info.reason === "cold-start-counter-maxed"
        ? `${info.attempts} no-data starts`
        : `${info.staleMs}ms data stall (${info.consumers} consumer(s))`;

    this.stationRecycleInFlight = true;
    this.lastStationRecycleAt = now;
    // Tell the stream server to defer any startLivestream commands while
    // the bropat session is recovering. The stream server will re-arm
    // automatically when this clears in the `finally` block below, so
    // consumers that arrive during the recycle still get a stream once
    // P2P is actually re-established.
    this.streamServer.setRecycleInFlight(true);
    try {
      this.logger.warn(
        `🔄 Upstream wedged (reason: ${info.reason}, ${triggerContext}) — recycling station P2P session for ${stationSN}${
          isSelfStation ? " (4G camera, self-station)" : ""
        }`,
      );

      const stationCmd = this.wsClient.commands.station(stationSN);

      // Diagnostic: what does bropat think the station's connectivity is
      // before we touch it?
      try {
        const status = await stationCmd.isConnected();
        this.logger.info(
          `🔎 Pre-recycle station.isConnected → ${JSON.stringify(status)}`,
        );
      } catch (e) {
        this.logger.warn(`Pre-recycle isConnected check failed: ${e}`);
      }

      try {
        this.logger.info(`📴 station.disconnect(${stationSN})`);
        await stationCmd.disconnect();
        this.logger.info(`✅ station.disconnect ack`);
      } catch (e) {
        this.logger.warn(`station.disconnect threw: ${e}`);
      }

      // Brief pause so the bropat client's teardown can settle before
      // we ask it to reopen the P2P channel. 2s matches the empirical
      // settling time before bropat will accept a fresh connect cleanly.
      await new Promise((r) => setTimeout(r, 2000));

      // Subscribe to CONNECTED / CONNECTION_ERROR for this station BEFORE
      // issuing connect — `station.connect()` returns when bropat accepts
      // the command, but the underlying P2P establishment is async (10–25s
      // for cellular cameras / cold HomeBase sessions). We need to wait
      // for the real "session ready" signal before declaring success.
      const connectionOutcome = this.waitForStationConnectionOutcome(
        stationSN,
        30000,
      );

      try {
        this.logger.info(`📡 station.connect(${stationSN})`);
        await stationCmd.connect();
        this.logger.info(`✅ station.connect ack (P2P establishing…)`);
      } catch (e) {
        this.logger.warn(`station.connect threw: ${e}`);
      }

      const outcome = await connectionOutcome;
      switch (outcome) {
        case "connected":
          this.logger.info(
            `🟢 station.connected event received for ${stationSN} — P2P session is up`,
          );
          break;
        case "connection-error":
          this.logger.error(
            `🔴 station.connection_error received for ${stationSN} — recycle did not establish P2P`,
          );
          break;
        case "timeout":
          this.logger.warn(
            `⏱️  Timed out (30s) waiting for station.connected event — P2P may still be coming up`,
          );
          break;
      }

      try {
        const status = await stationCmd.isConnected();
        this.logger.info(
          `🔎 Post-recycle station.isConnected → ${JSON.stringify(status)}`,
        );
      } catch (e) {
        this.logger.warn(`Post-recycle isConnected check failed: ${e}`);
      }

      this.logger.info(
        `🔄 Station P2P recycle complete (outcome: ${outcome}) — re-arming any waiting consumers`,
      );
    } finally {
      this.stationRecycleInFlight = false;
      // Clears the stream server's defer-flag. If consumers are still
      // attached, this kicks off a fresh ensureLivestreamState so the
      // user gets video without having to manually retry.
      this.streamServer.setRecycleInFlight(false);
    }
  }

  /**
   * Wait for the next `STATION_EVENTS.CONNECTED` or
   * `STATION_EVENTS.CONNECTION_ERROR` event for a specific station serial,
   * or time out. Returns the outcome as a string for logging.
   *
   * Listeners are registered eagerly (before `station.connect()` is sent)
   * by the caller so we don't miss a fast-arriving CONNECTED event.
   * Both listeners are removed on any resolution path.
   */
  private waitForStationConnectionOutcome(
    stationSerialNumber: string,
    timeoutMs: number,
  ): Promise<"connected" | "connection-error" | "timeout"> {
    return new Promise((resolve) => {
      let removeConnected: (() => boolean) | undefined;
      let removeError: (() => boolean) | undefined;
      const cleanup = () => {
        removeConnected?.();
        removeError?.();
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve("timeout");
      }, timeoutMs);
      timer.unref?.();

      removeConnected = this.wsClient.addEventListener(
        STATION_EVENTS.CONNECTED,
        () => {
          clearTimeout(timer);
          cleanup();
          resolve("connected");
        },
        {
          source: EVENT_SOURCES.STATION,
          serialNumber: stationSerialNumber,
        },
      );

      removeError = this.wsClient.addEventListener(
        STATION_EVENTS.CONNECTION_ERROR,
        () => {
          clearTimeout(timer);
          cleanup();
          resolve("connection-error");
        },
        {
          source: EVENT_SOURCES.STATION,
          serialNumber: stationSerialNumber,
        },
      );
    });
  }

  /**
   * Clean up resources on disposal
   */
  dispose(): void {
    if (this.talkbackProcess) {
      this.talkbackProcess.kill();
      this.talkbackProcess = undefined;
    }
    this.talkbackActive = false;
    this.intercomStartedLivestream = false;

    // Stop the background thumbnail refresh timers.
    if (this.thumbnailRefreshKick) clearTimeout(this.thumbnailRefreshKick);
    if (this.thumbnailRefreshInterval)
      clearInterval(this.thumbnailRefreshInterval);

    // Dispose stream service (will stop stream server if running)
    this.streamService
      .dispose()
      .catch((e: unknown) =>
        this.logger.warn(`Error disposing stream service: ${e}`),
      );

    // Clean up all event listeners for this device
    // This removes video data, and other device event listeners
    const removedCount = this.wsClient.removeEventListenersBySerialNumber(
      this.serialNumber,
      EVENT_SOURCES.DEVICE,
    );

    this.logger.debug(
      `Removed ${removedCount} event listeners during disposal`,
    );
  }
}
