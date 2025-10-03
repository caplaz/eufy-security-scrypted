/**
 * Video Clips Service
 *
 * Manages video clip retrieval from both local storage (P2P) and cloud API.
 * Handles metadata caching, thumbnail pre-downloading, and clip downloads.
 *
 * @module services/video
 */

import {
  EufyWebSocketClient,
  StorageType,
  DEVICE_EVENTS,
} from "@caplaz/eufy-security-client";
import { VideoClip, MediaObject } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { Logger, ILogObj } from "tslog";
import { VideoClipMetadata, VideoClipQuery } from "./types";

/**
 * VideoClipsService handles all video clip operations including:
 * - Querying clips from station database (P2P)
 * - Fallback to cloud API
 * - Pre-downloading thumbnails to avoid URL expiration
 * - P2P downloads of videos and thumbnails
 */
export class VideoClipsService {
  /** Cache of video clip metadata for efficient retrieval */
  private clipMetadataCache = new Map<string, VideoClipMetadata>();

  constructor(
    private wsClient: EufyWebSocketClient,
    private logger: Logger<ILogObj>
  ) {}

  /**
   * Get video clips for a device within a time range
   *
   * @param query - Query parameters including device serial, station, and time range
   * @returns Array of video clips with metadata
   */
  async getClips(query: VideoClipQuery): Promise<VideoClip[]> {
    try {
      this.logger.debug(
        `Fetching video clips for device ${query.serialNumber} on station ${query.stationSerialNumber}`
      );

      // Try station database first (local P2P)
      const clips = await this.getClipsFromStationDatabase(query);

      if (clips.length > 0) {
        return clips;
      }

      // Fallback to cloud API
      this.logger.debug("No local recordings found, falling back to cloud API");
      return await this.getClipsFromCloudAPI(query);
    } catch (error) {
      this.logger.error("Error fetching video clips:", error);

      // Try cloud API as fallback on error
      try {
        return await this.getClipsFromCloudAPI(query);
      } catch (fallbackError) {
        this.logger.error("Cloud API fallback also failed:", fallbackError);
        return [];
      }
    }
  }

  /**
   * Download a video clip by ID
   *
   * @param videoId - Unique video clip identifier
   * @param serialNumber - Device serial number
   * @returns MediaObject containing the video data
   */
  async downloadClip(
    videoId: string,
    serialNumber: string
  ): Promise<MediaObject> {
    this.logger.debug(`Fetching video clip: ${videoId}`);

    const metadata = this.clipMetadataCache.get(videoId);
    if (!metadata) {
      throw new Error(`Video clip metadata not found for ID: ${videoId}`);
    }

    // Check for P2P download capability
    if (metadata.storage_path && metadata.cipher_id !== undefined) {
      return await this.downloadClipViaP2P(videoId, serialNumber, metadata);
    }

    // Fallback to cloud path
    if (metadata.cloud_path) {
      this.logger.debug(`Using cloud path: ${metadata.cloud_path}`);
      return sdk.mediaManager.createMediaObject(
        Buffer.from(metadata.cloud_path),
        "text/plain",
        { sourceId: serialNumber }
      );
    }

    throw new Error(
      `No storage path, cipher ID, or cloud path available for video: ${videoId}`
    );
  }

  /**
   * Download a thumbnail for a video clip
   *
   * @param thumbnailId - Unique thumbnail identifier
   * @param serialNumber - Device serial number
   * @returns MediaObject containing the thumbnail image
   */
  async downloadThumbnail(
    thumbnailId: string,
    serialNumber: string
  ): Promise<MediaObject> {
    this.logger.debug(`Fetching thumbnail: ${thumbnailId}`);

    const metadata = this.clipMetadataCache.get(thumbnailId);
    if (!metadata) {
      throw new Error(`Thumbnail metadata not found for ID: ${thumbnailId}`);
    }

    // Check for pre-downloaded cached thumbnail
    if (metadata.cached_thumbnail) {
      this.logger.debug(
        `Using pre-downloaded cached thumbnail for ${thumbnailId}`
      );
      return sdk.mediaManager.createMediaObject(
        metadata.cached_thumbnail,
        "image/jpeg",
        { sourceId: serialNumber }
      );
    }

    // Check for P2P download capability
    if (metadata.thumb_path && metadata.cipher_id !== undefined) {
      return await this.downloadThumbnailViaP2P(
        thumbnailId,
        serialNumber,
        metadata
      );
    }

    // Fallback to cloud thumbnail
    if (metadata.cloud_thumbnail) {
      this.logger.debug(`Attempting to download cloud thumbnail from URL`);
      try {
        const thumbnailBuffer = await this.downloadFromUrl(
          metadata.cloud_thumbnail
        );
        return sdk.mediaManager.createMediaObject(
          thumbnailBuffer,
          "image/jpeg",
          { sourceId: serialNumber }
        );
      } catch (error) {
        this.logger.error("Failed to download cloud thumbnail:", error);
        throw new Error(
          `Cloud thumbnail URL expired or inaccessible for: ${thumbnailId}`
        );
      }
    }

    throw new Error(
      `No thumbnail path, cipher ID, or cloud thumbnail available for: ${thumbnailId}`
    );
  }

  /**
   * Clear the metadata cache
   */
  clearCache(): void {
    this.clipMetadataCache.clear();
  }

  /**
   * Get clips from station database (local P2P storage)
   */
  private async getClipsFromStationDatabase(
    query: VideoClipQuery
  ): Promise<VideoClip[]> {
    const queryParams = {
      serialNumbers: [query.serialNumber],
      startDate: this.formatDate(query.startTime),
      endDate: this.formatDate(query.endTime),
      eventType: 0, // All event types
      detectionType: 0, // All detection types
      storageType: 1, // Local storage
    };

    this.logger.debug(
      "Querying station database with params:",
      JSON.stringify(queryParams, null, 2)
    );

    await this.wsClient.commands
      .station(query.stationSerialNumber)
      .databaseQueryLocal(queryParams);

    // Wait for database query response
    const databaseRecords = await this.waitForDatabaseQueryResponse(
      query.stationSerialNumber
    );

    if (databaseRecords.length === 0) {
      this.logger.warn("No local recordings found in station database");
      return [];
    }

    this.logger.debug(
      `Found ${databaseRecords.length} records from station database`
    );

    return this.mapDatabaseRecordsToClips(databaseRecords, query.serialNumber);
  }

  /**
   * Get clips from Eufy cloud API
   */
  private async getClipsFromCloudAPI(
    query: VideoClipQuery
  ): Promise<VideoClip[]> {
    this.logger.debug(
      `Fetching video clips from cloud API for time range: ${new Date(query.startTime).toISOString()} to ${new Date(query.endTime).toISOString()}`
    );

    const { events } = await this.wsClient.commands.driver().getHistoryEvents({
      startTimestampMs: query.startTime,
      endTimestampMs: query.endTime,
      filter: {
        stationSN: query.stationSerialNumber,
        storageType: StorageType.LOCAL_AND_CLOUD,
      },
    });

    this.logger.debug(`Received ${events.length} events from cloud API`);

    const deviceEvents = events.filter(
      (event) => event.stationSN === query.stationSerialNumber
    );

    if (deviceEvents.length === 0) {
      this.logger.warn("No recordings found in cloud API for this device");
      return [];
    }

    // Pre-download thumbnails to avoid URL expiration
    await this.preDownloadThumbnails(deviceEvents, query.serialNumber);

    return this.mapCloudEventsToClips(deviceEvents, query.serialNumber);
  }

  /**
   * Download a video clip via P2P
   */
  private async downloadClipViaP2P(
    videoId: string,
    serialNumber: string,
    metadata: VideoClipMetadata
  ): Promise<MediaObject> {
    this.logger.debug("Starting P2P download for video clip", {
      storage_path: metadata.storage_path,
      cipher_id: metadata.cipher_id,
    });

    const api = this.wsClient.commands.device(serialNumber);
    await api.startDownload({
      path: metadata.storage_path!,
      cipherId: metadata.cipher_id!,
    });

    const videoBuffer = await this.collectDownloadData(serialNumber, 60000);

    return sdk.mediaManager.createMediaObject(videoBuffer, "video/mp4", {
      sourceId: serialNumber,
    });
  }

  /**
   * Download a thumbnail via P2P
   */
  private async downloadThumbnailViaP2P(
    thumbnailId: string,
    serialNumber: string,
    metadata: VideoClipMetadata
  ): Promise<MediaObject> {
    this.logger.debug("Starting P2P download for thumbnail", {
      thumb_path: metadata.thumb_path,
      cipher_id: metadata.cipher_id,
    });

    const api = this.wsClient.commands.device(serialNumber);
    await api.startDownload({
      path: metadata.thumb_path!,
      cipherId: metadata.cipher_id!,
    });

    const thumbnailBuffer = await this.collectDownloadData(serialNumber, 30000);

    return sdk.mediaManager.createMediaObject(thumbnailBuffer, "image/jpeg", {
      sourceId: serialNumber,
    });
  }

  /**
   * Collect download data from WebSocket events
   */
  private collectDownloadData(
    serialNumber: string,
    timeout: number
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let downloadComplete = false;

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.logger.error(`Download timed out after ${timeout}ms`);
        removeListeners();
        reject(new Error(`Download timed out`));
      }, timeout);

      const removeVideoDataListener = this.wsClient.addEventListener(
        DEVICE_EVENTS.DOWNLOAD_VIDEO_DATA,
        (event) => {
          if (event.serialNumber === serialNumber) {
            const buffer = Array.isArray(event.buffer)
              ? Buffer.from(event.buffer as number[])
              : Buffer.from(event.buffer as string, "base64");

            chunks.push(buffer);
            this.logger.debug(
              `Received chunk: ${buffer.length} bytes (total: ${chunks.reduce((sum, b) => sum + b.length, 0)} bytes)`
            );
          }
        },
        { source: "device" as any }
      );

      const removeFinishedListener = this.wsClient.addEventListener(
        DEVICE_EVENTS.DOWNLOAD_FINISHED,
        (event) => {
          if (event.serialNumber === serialNumber && !downloadComplete) {
            downloadComplete = true;
            clearTimeout(timer);
            removeListeners();

            this.logger.debug(
              `Download complete: ${chunks.length} chunks, ${chunks.reduce((sum, b) => sum + b.length, 0)} total bytes`
            );

            if (chunks.length === 0) {
              reject(new Error("No data received"));
              return;
            }

            resolve(Buffer.concat(chunks));
          }
        },
        { source: "device" as any }
      );

      const removeListeners = () => {
        removeVideoDataListener();
        removeFinishedListener();
      };
    });
  }

  /**
   * Wait for database query response from WebSocket
   */
  private waitForDatabaseQueryResponse(
    stationSerialNumber: string
  ): Promise<any[]> {
    return new Promise<any[]>((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn("Station database query timed out after 10 seconds");
        resolve([]);
      }, 10000);

      const removeListener = this.wsClient.addEventListener(
        "database query local" as any,
        (event: any) => {
          if (event.serialNumber === stationSerialNumber) {
            clearTimeout(timeout);
            removeListener();

            if (Array.isArray(event.data)) {
              resolve(event.data);
            } else {
              this.logger.error(
                "Unexpected data format from station database query"
              );
              resolve([]);
            }
          }
        },
        { source: "station" as any }
      );
    });
  }

  /**
   * Pre-download thumbnails from cloud to avoid URL expiration
   */
  private async preDownloadThumbnails(
    events: any[],
    serialNumber: string
  ): Promise<void> {
    const thumbnailPromises = events
      .filter((event) => event.thumbnailUrl)
      .map(async (event) => {
        const clipId = `cloud-${serialNumber}-${event.startTime}-${event.eventType}`;
        try {
          this.logger.debug(`Pre-downloading thumbnail for ${clipId}`);
          const thumbnailBuffer = await this.downloadFromUrl(
            event.thumbnailUrl!
          );
          return { clipId, thumbnailBuffer };
        } catch (error) {
          this.logger.warn(
            `Failed to pre-download thumbnail for ${clipId}:`,
            error
          );
          return { clipId, thumbnailBuffer: null };
        }
      });

    const results = await Promise.all(thumbnailPromises);

    results.forEach(({ clipId, thumbnailBuffer }) => {
      if (thumbnailBuffer) {
        const metadata = this.clipMetadataCache.get(clipId) || {};
        metadata.cached_thumbnail = thumbnailBuffer;
        this.clipMetadataCache.set(clipId, metadata);
      }
    });

    this.logger.debug(
      `Successfully pre-downloaded ${results.filter((r) => r.thumbnailBuffer).length} thumbnails`
    );
  }

  /**
   * Download content from URL
   */
  private async downloadFromUrl(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Map database records to VideoClip objects
   */
  private mapDatabaseRecordsToClips(
    records: any[],
    serialNumber: string
  ): VideoClip[] {
    return records.map((record) => {
      const startTimeMs =
        typeof record.start_time === "string"
          ? new Date(record.start_time).getTime()
          : record.start_time;

      const endTimeMs =
        typeof record.end_time === "string"
          ? new Date(record.end_time).getTime()
          : record.end_time;

      const clipId = record.record_id
        ? `${serialNumber}-${record.record_id}`
        : `${serialNumber}-${startTimeMs}-${record.video_type}`;

      // Store metadata
      this.clipMetadataCache.set(clipId, {
        storage_path: record.storage_path,
        cipher_id: record.cipher_id,
        thumb_path: record.thumb_path,
        cloud_path: record.cloud_path,
        storage_type: record.storage_type,
        record_id: record.record_id,
      });

      const duration =
        endTimeMs && endTimeMs > startTimeMs
          ? endTimeMs - startTimeMs
          : undefined;

      return {
        id: clipId,
        startTime: startTimeMs,
        duration,
        event: this.mapEventType(record.video_type || 0),
        description: this.getEventDescription(record.video_type || 0),
        thumbnailId: record.thumb_path ? clipId : undefined,
        videoId: record.storage_path ? clipId : undefined,
      };
    });
  }

  /**
   * Map cloud events to VideoClip objects
   */
  private mapCloudEventsToClips(
    events: any[],
    serialNumber: string
  ): VideoClip[] {
    return events.map((event) => {
      const clipId = `cloud-${serialNumber}-${event.startTime}-${event.eventType}`;

      // Store metadata
      this.clipMetadataCache.set(clipId, {
        cloud_path: event.videoUrl,
        storage_type: event.storageType,
        cloud_thumbnail: event.thumbnailUrl,
      });

      const duration = event.endTime
        ? event.endTime - event.startTime
        : undefined;

      return {
        id: clipId,
        startTime: event.startTime,
        duration,
        event: this.mapEventType(event.eventType || 0),
        description: this.getEventDescription(event.eventType || 0),
        thumbnailId: event.thumbnailUrl ? clipId : undefined,
        videoId: event.videoUrl ? clipId : undefined,
      };
    });
  }

  /**
   * Format timestamp to YYYYMMDD
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  /**
   * Map Eufy event type to human-readable description
   */
  private getEventDescription(eventType: number): string {
    const descriptions: Record<number, string> = {
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
    return descriptions[eventType] || `Event ${eventType}`;
  }

  /**
   * Map Eufy event type to Scrypted event type
   */
  private mapEventType(eventType: number): string | undefined {
    const typeMap: Record<number, string> = {
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
    return typeMap[eventType];
  }
}
