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
  FFmpegInput,
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
  getDeviceCapabilities,
} from "@caplaz/eufy-security-client";

import { VideoMetadata } from "@caplaz/eufy-security-client";

import {
  DebugLogger,
  createDebugLogger,
  isDebugEnabled,
} from "./utils/debug-logger";
import { DeviceUtils } from "./utils/device-utils";
import { StreamServer } from "@caplaz/eufy-stream-server";
import sdk from "@scrypted/sdk";

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

  // Video clip metadata cache for P2P downloads
  private videoClipMetadata: Map<
    string,
    {
      storage_path?: string;
      cipher_id?: number;
      thumb_path?: string;
      cloud_path?: string;
      cloud_thumbnail?: string;
      cached_thumbnail?: Buffer; // Pre-downloaded thumbnail to avoid URL expiration
      storage_type?: number;
      record_id?: number;
    }
  > = new Map();

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
      this.updatePtzCapabilities(); // Update PTZ capabilities based on device type
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

  private updatePtzCapabilities() {
    const capabilities = getDeviceCapabilities(
      this.latestProperties?.type || 0
    );
    // Update the inherited ptzCapabilities property
    (this as any).ptzCapabilities = {
      pan: capabilities.panTilt,
      tilt: capabilities.panTilt,
      zoom: false, // No Eufy cameras currently support zoom
    };
  }

  ptzCommand(command: PanTiltZoomCommand): Promise<void> {
    if (command.tilt !== undefined) {
      return command.tilt > 0
        ? this.api.panAndTilt({ direction: PanTiltDirection.UP }).then(() => {
            this.logger.i(`Tilted camera up`);
          })
        : this.api.panAndTilt({ direction: PanTiltDirection.DOWN }).then(() => {
            this.logger.i(`Tilted camera down`);
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
        container: "h264", // Raw H.264 stream (not MP4 container)
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

    // For now, create MediaObject with fallback dimensions
    // The actual metadata will be used when the stream starts
    this.logger.i(
      "Creating MediaObject with fallback dimensions (metadata will be updated when stream starts)"
    );
    return this.createOptimizedMediaObject(port, options);
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
        this.updatePtzCapabilities(); // Ensure PTZ capabilities are up to date
      } catch (error) {
        this.logger.w(
          `Failed to get device properties: ${error}, user initiated: ${userInitiated}`
        );
      }
    }
  }

  // =================== VIDEO CLIPS ===================

  /**
   * Retrieves video clips from device history using station database query.
   * Returns clips from local storage with storage_path and cipher_id for P2P downloads.
   */
  async getVideoClips(options?: VideoClipOptions): Promise<VideoClip[]> {
    try {
      // Ensure properties are loaded
      await this.propertiesLoaded;

      const stationSN = this.latestProperties?.stationSerialNumber;
      if (!stationSN) {
        this.logger.e("Station serial number not available");
        return [];
      }

      this.logger.d(
        `Fetching video clips from station database for device ${this.serialNumber} on station ${stationSN}`
      );

      const startTime =
        options?.startTime || Date.now() - 7 * 24 * 60 * 60 * 1000; // Default to last 7 days
      const endTime = options?.endTime || Date.now();

      this.logger.d(
        `Time range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
      );

      // Format dates for station database query (YYYYMMDD)
      const formatDate = (timestamp: number): string => {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}${month}${day}`;
      };

      // Query station database for local recordings
      // This returns records with storage_path and cipher_id needed for P2P downloads
      const queryParams = {
        serialNumbers: [this.serialNumber],
        startDate: formatDate(startTime),
        endDate: formatDate(endTime),
        eventType: 0, // 0 = all event types
        detectionType: 0, // 0 = all detection types
        storageType: 1, // 1 = local storage (has storage_path)
      };

      this.logger.d(
        `Querying station database with params:`,
        JSON.stringify(queryParams, null, 2)
      );

      const response = await this.wsClient.commands
        .station(stationSN)
        .databaseQueryLocal(queryParams);

      this.logger.d(
        `Received response from station.databaseQueryLocal for station ${stationSN}:`,
        JSON.stringify(response, null, 2)
      );

      // Wait for the database query local event with the actual data
      // The command is async and returns via event
      const databaseRecords = await new Promise<any[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.logger.w("Station database query timed out after 10 seconds");
          resolve([]);
        }, 10000);

        const removeListener = this.wsClient.addEventListener(
          "database query local" as any,
          (event: any) => {
            this.logger.d(`Received database query local event:`, {
              eventSerialNumber: event.serialNumber,
              expectedStationSN: stationSN,
              matches: event.serialNumber === stationSN,
              dataType: Array.isArray(event.data) ? "array" : typeof event.data,
              dataLength: event.data?.length,
              fullEvent: JSON.stringify(event, null, 2),
            });

            if (event.serialNumber === stationSN) {
              clearTimeout(timeout);
              removeListener();

              this.logger.d(
                `Received ${event.data?.length || 0} records from station database`
              );

              // Check if we have data array
              if (Array.isArray(event.data)) {
                resolve(event.data);
              } else {
                this.logger.e(
                  `Unexpected data format from station database query. Data:`,
                  JSON.stringify(event.data, null, 2)
                );
                resolve([]);
              }
            }
          },
          { source: "station" as any }
        );
      });

      if (databaseRecords.length === 0) {
        this.logger.w(
          `No local recordings found in station database. This may indicate:
          1. No recordings exist in the specified time range
          2. Local storage (SD card) not available or not enabled
          3. Recordings only stored in cloud (not local)
          4. Station database not accessible via P2P`
        );

        // Try querying with different storage type (0 = all, 2 = cloud, 3 = both)
        this.logger.d(
          `Attempting query with storageType: 0 (all storage types)`
        );
        try {
          const retryParams = {
            ...queryParams,
            storageType: 0, // Try all storage types
          };

          this.logger.d(
            `Retry query params:`,
            JSON.stringify(retryParams, null, 2)
          );

          const retryResponse = await this.wsClient.commands
            .station(stationSN)
            .databaseQueryLocal(retryParams);

          this.logger.d(
            `Retry response:`,
            JSON.stringify(retryResponse, null, 2)
          );
        } catch (retryError) {
          this.logger.e(`Retry query failed:`, retryError);
        }
      } else {
        this.logger.d(`First record sample:`, {
          device_sn: databaseRecords[0].device_sn,
          start_time: databaseRecords[0].start_time,
          end_time: databaseRecords[0].end_time,
          video_type: databaseRecords[0].video_type,
          storage_path: databaseRecords[0].storage_path,
          cipher_id: databaseRecords[0].cipher_id,
          storage_type: databaseRecords[0].storage_type,
        });
      }

      const videoClips = databaseRecords.map((record) => {
        // Parse start time from ISO string or timestamp
        const startTimeMs =
          typeof record.start_time === "string"
            ? new Date(record.start_time).getTime()
            : record.start_time;

        const endTimeMs =
          typeof record.end_time === "string"
            ? new Date(record.end_time).getTime()
            : record.end_time;

        // Generate unique ID from record ID or timestamp
        const clipId = record.record_id
          ? `${this.serialNumber}-${record.record_id}`
          : `${this.serialNumber}-${startTimeMs}-${record.video_type}`;

        // Store metadata for later retrieval during getVideoClip/getVideoClipThumbnail
        this.videoClipMetadata.set(clipId, {
          storage_path: record.storage_path,
          cipher_id: record.cipher_id,
          thumb_path: record.thumb_path,
          cloud_path: record.cloud_path,
          storage_type: record.storage_type,
          record_id: record.record_id,
        });

        // Calculate duration
        const duration =
          endTimeMs && endTimeMs > startTimeMs
            ? endTimeMs - startTimeMs
            : undefined;

        // Map event type to description
        const description = this.getEventDescription(record.video_type || 0);

        // Map event type to Scrypted event type
        const eventType = this.mapEventType(record.video_type || 0);

        const videoClip: VideoClip = {
          id: clipId,
          startTime: startTimeMs,
          duration,
          event: eventType,
          description,
          thumbnailId: record.thumb_path ? clipId : undefined,
          videoId: record.storage_path ? clipId : undefined,
        };

        return videoClip;
      });

      this.logger.d(
        `Returning ${videoClips.length} video clips from station database`
      );

      // If no local recordings found, fallback to cloud API
      if (videoClips.length === 0) {
        this.logger.d(`No local recordings found, falling back to cloud API`);
        return this.getVideoClipsFromCloudAPI(startTime, endTime);
      }

      return videoClips;
    } catch (error) {
      this.logger.e(
        `Error fetching video clips from station database: ${error}`
      );
      // Fallback to cloud API on error
      this.logger.d(`Attempting cloud API fallback due to error`);
      try {
        const startTime =
          options?.startTime || Date.now() - 7 * 24 * 60 * 60 * 1000;
        const endTime = options?.endTime || Date.now();
        return this.getVideoClipsFromCloudAPI(startTime, endTime);
      } catch (fallbackError) {
        this.logger.e(`Cloud API fallback also failed: ${fallbackError}`);
        return [];
      }
    }
  }

  /**
   * Retrieves video clips from cloud API as a fallback.
   * Used when local station database returns no results.
   * Downloads thumbnails immediately to avoid URL expiration issues.
   */
  private async getVideoClipsFromCloudAPI(
    startTime: number,
    endTime: number
  ): Promise<VideoClip[]> {
    try {
      this.logger.d(
        `Fetching video clips from cloud API for time range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
      );

      const stationSN = this.latestProperties?.stationSerialNumber;
      if (!stationSN) {
        this.logger.e("Station serial number not available");
        return [];
      }

      // Fetch events from cloud
      const { events } = await this.wsClient.commands
        .driver()
        .getHistoryEvents({
          startTimestampMs: startTime,
          endTimestampMs: endTime,
          filter: {
            stationSN: stationSN,
            storageType: StorageType.LOCAL_AND_CLOUD,
          },
        });

      this.logger.d(`Received ${events.length} events from cloud API`);

      // Filter events to only include this device
      const deviceEvents = events.filter(
        (event) => event.stationSN === stationSN
      );

      this.logger.d(
        `Filtered to ${deviceEvents.length} events for this device`
      );

      if (deviceEvents.length === 0) {
        this.logger.w(`No recordings found in cloud API for this device`);
        return [];
      }

      // Download thumbnails immediately to avoid URL expiration
      // Cloud thumbnail URLs expire after 10 minutes, so we cache them now
      const thumbnailPromises = deviceEvents
        .filter((event) => event.thumbnailUrl)
        .map(async (event) => {
          const clipId = `cloud-${this.serialNumber}-${event.startTime}-${event.eventType}`;
          try {
            this.logger.d(`Pre-downloading thumbnail for ${clipId}`);
            const thumbnailBuffer = await this.downloadCloudThumbnail(
              event.thumbnailUrl!
            );
            return { clipId, thumbnailBuffer };
          } catch (error) {
            this.logger.w(
              `Failed to pre-download thumbnail for ${clipId}: ${error}`
            );
            return { clipId, thumbnailBuffer: null };
          }
        });

      // Wait for all thumbnails to download (with timeout)
      const thumbnailResults = await Promise.all(thumbnailPromises);
      const thumbnailCache = new Map<string, Buffer>();
      thumbnailResults.forEach(({ clipId, thumbnailBuffer }) => {
        if (thumbnailBuffer) {
          thumbnailCache.set(clipId, thumbnailBuffer);
        }
      });

      this.logger.d(
        `Successfully downloaded ${thumbnailCache.size} thumbnails out of ${thumbnailPromises.length}`
      );

      const videoClips = deviceEvents.map((event) => {
        // Generate unique ID from timestamp and event type
        const clipId = `cloud-${this.serialNumber}-${event.startTime}-${event.eventType}`;

        // Store cloud URLs and cached thumbnail in metadata
        this.videoClipMetadata.set(clipId, {
          cloud_path: event.videoUrl,
          storage_type: event.storageType,
          cloud_thumbnail: event.thumbnailUrl,
          cached_thumbnail: thumbnailCache.get(clipId), // Store pre-downloaded thumbnail
        });

        // Calculate duration
        const duration = event.endTime
          ? event.endTime - event.startTime
          : undefined;

        // Map event type to description
        const description = this.getEventDescription(event.eventType || 0);

        // Map event type to Scrypted event type
        const eventType = this.mapEventType(event.eventType || 0);

        const videoClip: VideoClip = {
          id: clipId,
          startTime: event.startTime,
          duration,
          event: eventType,
          description,
          thumbnailId: event.thumbnailUrl ? clipId : undefined,
          videoId: event.videoUrl ? clipId : undefined,
        };

        return videoClip;
      });

      this.logger.d(
        `Returning ${videoClips.length} video clips from cloud API`
      );
      return videoClips;
    } catch (error) {
      this.logger.e(`Error fetching video clips from cloud API: ${error}`);
      return [];
    }
  }

  /**
   * Downloads a cloud thumbnail from S3 URL immediately to avoid expiration.
   */
  private async downloadCloudThumbnail(url: string): Promise<Buffer> {
    try {
      // Use eufy-security-client's API to download the image
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.e(`Failed to download cloud thumbnail from ${url}: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves a video clip by ID using P2P download.
   * Downloads the video directly from the camera/station using the cached storage path and cipher ID.
   */
  async getVideoClip(videoId: string): Promise<MediaObject> {
    try {
      this.logger.d(`Fetching video clip: ${videoId}`);

      // Retrieve metadata from cache
      const metadata = this.videoClipMetadata.get(videoId);

      if (!metadata) {
        throw new Error(`Video clip metadata not found for ID: ${videoId}`);
      }

      // Check if we have storage path and cipher for P2P download
      if (!metadata.storage_path || metadata.cipher_id === undefined) {
        this.logger.w(
          `No storage_path or cipher_id available for ${videoId}, attempting cloud fallback`
        );

        // Fallback to cloud path if available
        if (metadata.cloud_path) {
          this.logger.d(`Using cloud path: ${metadata.cloud_path}`);
          return sdk.mediaManager.createMediaObject(
            Buffer.from(metadata.cloud_path),
            "text/plain",
            {
              sourceId: this.serialNumber,
            }
          );
        }

        throw new Error(
          `No storage path, cipher ID, or cloud path available for video: ${videoId}`
        );
      }

      this.logger.d(`Starting P2P download for video clip`, {
        storage_path: metadata.storage_path,
        cipher_id: metadata.cipher_id,
      });

      // Start P2P download
      await this.api.startDownload({
        path: metadata.storage_path,
        cipherId: metadata.cipher_id,
      });

      // Collect video data from download events
      const videoChunks: Buffer[] = [];
      let downloadComplete = false;

      return new Promise<MediaObject>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.logger.e(`Video download timed out after 60 seconds`);
          removeDownloadListeners();
          reject(new Error(`Video download timed out for ${videoId}`));
        }, 60000); // 60 second timeout

        // Listen for download video data
        const removeVideoDataListener = this.wsClient.addEventListener(
          DEVICE_EVENTS.DOWNLOAD_VIDEO_DATA,
          (event) => {
            if (event.serialNumber === this.serialNumber) {
              // Convert buffer data to Buffer
              const buffer = Array.isArray(event.buffer)
                ? Buffer.from(event.buffer as number[])
                : Buffer.from(event.buffer as string, "base64");

              videoChunks.push(buffer);
              this.logger.d(
                `Received video chunk: ${buffer.length} bytes (total: ${videoChunks.reduce((sum, b) => sum + b.length, 0)} bytes)`
              );
            }
          },
          { source: "device" as any }
        );

        // Listen for download finished
        const removeFinishedListener = this.wsClient.addEventListener(
          DEVICE_EVENTS.DOWNLOAD_FINISHED,
          (event) => {
            if (event.serialNumber === this.serialNumber && !downloadComplete) {
              downloadComplete = true;
              clearTimeout(timeout);
              removeDownloadListeners();

              this.logger.d(
                `Video download complete: ${videoChunks.length} chunks, ${videoChunks.reduce((sum, b) => sum + b.length, 0)} total bytes`
              );

              if (videoChunks.length === 0) {
                reject(new Error(`No video data received for ${videoId}`));
                return;
              }

              // Combine all chunks into a single buffer
              const videoBuffer = Buffer.concat(videoChunks);

              // Create MediaObject with H.264 video
              resolve(
                sdk.mediaManager.createMediaObject(
                  videoBuffer,
                  "video/mp4", // or 'video/h264' depending on format
                  {
                    sourceId: this.serialNumber,
                  }
                )
              );
            }
          },
          { source: "device" as any }
        );

        const removeDownloadListeners = () => {
          removeVideoDataListener();
          removeFinishedListener();
        };
      });
    } catch (error) {
      this.logger.e(`Error fetching video clip ${videoId}: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves a thumbnail for a video clip using P2P download or cached thumbnail.
   * Downloads the thumbnail directly from the camera/station using the cached thumbnail path and cipher ID.
   * For cloud clips, returns pre-downloaded cached thumbnail to avoid URL expiration.
   */
  async getVideoClipThumbnail(
    thumbnailId: string,
    options?: VideoClipThumbnailOptions
  ): Promise<MediaObject> {
    try {
      this.logger.d(`Fetching thumbnail: ${thumbnailId}`);

      // Retrieve metadata from cache
      const metadata = this.videoClipMetadata.get(thumbnailId);

      if (!metadata) {
        throw new Error(`Thumbnail metadata not found for ID: ${thumbnailId}`);
      }

      // Check if we have a pre-downloaded cached thumbnail (from cloud API)
      if (metadata.cached_thumbnail) {
        this.logger.d(
          `Using pre-downloaded cached thumbnail for ${thumbnailId}`
        );
        return sdk.mediaManager.createMediaObject(
          metadata.cached_thumbnail,
          "image/jpeg",
          {
            sourceId: this.serialNumber,
          }
        );
      }

      // Check if we have thumbnail path and cipher for P2P download
      if (!metadata.thumb_path || metadata.cipher_id === undefined) {
        this.logger.w(
          `No thumb_path or cipher_id available for ${thumbnailId}, checking for cloud thumbnail`
        );

        // Fallback to cloud thumbnail URL if available (may be expired)
        if (metadata.cloud_thumbnail) {
          this.logger.d(
            `Attempting to download cloud thumbnail from URL: ${metadata.cloud_thumbnail}`
          );
          try {
            const thumbnailBuffer = await this.downloadCloudThumbnail(
              metadata.cloud_thumbnail
            );
            return sdk.mediaManager.createMediaObject(
              thumbnailBuffer,
              "image/jpeg",
              {
                sourceId: this.serialNumber,
              }
            );
          } catch (error) {
            this.logger.e(`Failed to download cloud thumbnail: ${error}`);
            throw new Error(
              `Cloud thumbnail URL expired or inaccessible for: ${thumbnailId}`
            );
          }
        }

        throw new Error(
          `No thumbnail path, cipher ID, or cloud thumbnail available for: ${thumbnailId}`
        );
      }

      this.logger.d(`Starting P2P download for thumbnail`, {
        thumb_path: metadata.thumb_path,
        cipher_id: metadata.cipher_id,
      });

      // Start P2P download for thumbnail
      await this.api.startDownload({
        path: metadata.thumb_path,
        cipherId: metadata.cipher_id,
      });

      // Collect thumbnail data from download events
      const thumbnailChunks: Buffer[] = [];
      let downloadComplete = false;

      return new Promise<MediaObject>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.logger.e(`Thumbnail download timed out after 30 seconds`);
          removeDownloadListeners();
          reject(new Error(`Thumbnail download timed out for ${thumbnailId}`));
        }, 30000); // 30 second timeout

        // Listen for download video data (thumbnails come through same channel)
        const removeVideoDataListener = this.wsClient.addEventListener(
          DEVICE_EVENTS.DOWNLOAD_VIDEO_DATA,
          (event) => {
            if (event.serialNumber === this.serialNumber) {
              // Convert buffer data to Buffer
              const buffer = Array.isArray(event.buffer)
                ? Buffer.from(event.buffer as number[])
                : Buffer.from(event.buffer as string, "base64");

              thumbnailChunks.push(buffer);
              this.logger.d(`Received thumbnail chunk: ${buffer.length} bytes`);
            }
          },
          { source: "device" as any }
        );

        // Listen for download finished
        const removeFinishedListener = this.wsClient.addEventListener(
          DEVICE_EVENTS.DOWNLOAD_FINISHED,
          (event) => {
            if (event.serialNumber === this.serialNumber && !downloadComplete) {
              downloadComplete = true;
              clearTimeout(timeout);
              removeDownloadListeners();

              this.logger.d(
                `Thumbnail download complete: ${thumbnailChunks.length} chunks, ${thumbnailChunks.reduce((sum, b) => sum + b.length, 0)} total bytes`
              );

              if (thumbnailChunks.length === 0) {
                reject(
                  new Error(`No thumbnail data received for ${thumbnailId}`)
                );
                return;
              }

              // Combine all chunks into a single buffer
              const thumbnailBuffer = Buffer.concat(thumbnailChunks);

              // Create MediaObject with image (likely JPEG)
              resolve(
                sdk.mediaManager.createMediaObject(
                  thumbnailBuffer,
                  "image/jpeg",
                  {
                    sourceId: this.serialNumber,
                  }
                )
              );
            }
          },
          { source: "device" as any }
        );

        const removeDownloadListeners = () => {
          removeVideoDataListener();
          removeFinishedListener();
        };
      });
    } catch (error) {
      this.logger.e(`Error fetching thumbnail ${thumbnailId}: ${error}`);
      throw error;
    }
  }

  /**
   * Removes video clips from device storage.
   * Note: This may not be supported by all Eufy devices or require specific permissions.
   */
  async removeVideoClips(...videoClipIds: string[]): Promise<void> {
    this.logger.w(
      `Video clip deletion not currently supported by Eufy API: ${videoClipIds.join(", ")}`
    );
    throw new Error(
      "Video clip deletion is not supported by the Eufy Security API"
    );
  }

  /**
   * Maps Eufy event type codes to human-readable descriptions.
   */
  private getEventDescription(eventType: number): string {
    const eventDescriptions: Record<number, string> = {
      1: "Motion detected",
      2: "Person detected",
      3: "Doorbell pressed",
      4: "Crying detected",
      5: "Sound detected",
      6: "Pet detected",
      7: "Vehicle detected",
      8: "Package delivered",
      9: "Package stranded",
      10: "Package taken",
      11: "Someone loitering",
      12: "Radar motion",
      13: "Dog detected",
      14: "Dog lick detected",
      15: "Dog poop detected",
      16: "Stranger detected",
    };

    return eventDescriptions[eventType] || `Event ${eventType}`;
  }

  /**
   * Maps Eufy event types to Scrypted event types.
   */
  private mapEventType(eventType: number): string | undefined {
    const eventTypeMap: Record<number, string> = {
      1: "motion",
      2: "person",
      3: "ring",
      4: "crying",
      5: "sound",
      6: "pet",
      7: "vehicle",
      8: "package",
      9: "package",
      10: "package",
      11: "loitering",
      12: "motion",
      13: "pet",
      14: "pet",
      15: "pet",
      16: "stranger",
    };

    return eventTypeMap[eventType];
  }

  // =================== UTILITY METHODS ===================

  /**
   * Creates an optimized MediaObject for FFmpeg streaming with low-latency H.264 configuration.
   * Based on the createMediaObjectFromTcpServer pattern but adapted for video-only streaming.
   * Includes robust handling for different camera models and battery-powered devices.
   */
  private async createOptimizedMediaObject(
    port: number,
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    // Use quality-based dimensions as fallback (metadata will be available when stream actually starts)
    const { width, height } = this.getVideoDimensions();

    // FFmpeg configuration optimized for low-latency H.264 streaming with balanced error handling
    const ffmpegInput: FFmpegInput = {
      url: undefined,
      inputArguments: [
        "-f",
        "h264", // Default to h264, will be updated when metadata is available
        "-framerate",
        "25", // Default framerate, will be updated when metadata is available
        "-analyzeduration",
        "5000000", // Increased analysis time (5M) to find SPS/PPS for front camera
        "-probesize",
        "5000000", // Increased probe size (5M) to find SPS/PPS for front camera
        "-fflags",
        "+nobuffer+fastseek+flush_packets+discardcorrupt+igndts+genpts", // Low-latency flags + ignore timestamps
        "-flags",
        "low_delay", // Minimize buffering delay
        "-avioflags",
        "direct", // Direct I/O access
        "-max_delay",
        "1000", // Allow more delay for stream analysis
        "-thread_queue_size",
        "768", // Balanced thread queue size
        "-hwaccel",
        "auto", // Enable hardware acceleration if available
        "-err_detect",
        "ignore_err+crccheck", // Selective error tolerance for battery cameras
        "-i",
        `tcp://127.0.0.1:${port}`, // TCP input source
      ],
      mediaStreamOptions: {
        id: options?.id || "main",
        name: options?.name || "Eufy Camera Stream",
        container: options?.container,
        video: {
          codec: "h264",
          width,
          height,
          ...options?.video, // Use provided video options
        },
        // Audio support can be added later when needed
      },
    };

    return sdk.mediaManager.createFFmpegMediaObject(ffmpegInput, {
      sourceId: this.serialNumber,
    });
  }

  /**
   * Creates a new stream server.
   */
  private createStreamServer(): void {
    this.streamServer = new StreamServer({
      port: 0, // Let the system assign a free port
      host: "127.0.0.1", // Only allow connections from localhost
      debug: isDebugEnabled(), // Respect global debug logging setting
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
