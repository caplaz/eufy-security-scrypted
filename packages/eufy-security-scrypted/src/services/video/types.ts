/**
 * Video Service Types
 *
 * Type definitions for video clips and snapshot services.
 *
 * @module services/video
 */

/**
 * Video clip metadata for caching
 */
export interface VideoClipMetadata {
  /** Local P2P storage path */
  storage_path?: string;
  /** Cipher ID for decryption */
  cipher_id?: number;
  /** Thumbnail P2P path */
  thumb_path?: string;
  /** Cloud video URL */
  cloud_path?: string;
  /** Cloud thumbnail URL */
  cloud_thumbnail?: string;
  /** Storage type (1=local, 2=cloud, 3=both) */
  storage_type?: number;
  /** Unique record ID from station database */
  record_id?: string;
  /** Pre-downloaded cached thumbnail data */
  cached_thumbnail?: Buffer;
}

/**
 * Video clip query parameters
 */
export interface VideoClipQuery {
  /** Device serial number */
  serialNumber: string;
  /** Station serial number */
  stationSerialNumber: string;
  /** Start time (Unix timestamp in ms) */
  startTime: number;
  /** End time (Unix timestamp in ms) */
  endTime: number;
}
