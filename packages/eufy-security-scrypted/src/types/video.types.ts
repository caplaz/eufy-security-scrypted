/**
 * Video Types
 *
 * Type definitions for video streaming, clips, and snapshots.
 */

import { VideoClip } from "@scrypted/sdk";

/**
 * Video clip metadata for P2P downloads
 */
export interface VideoClipMetadata {
  /** Local storage path on the device */
  storage_path?: string;
  /** Cipher ID for decryption */
  cipher_id?: number;
  /** Thumbnail file path */
  thumb_path?: string;
  /** Cloud storage URL */
  cloud_path?: string;
  /** Cloud thumbnail URL (may expire) */
  cloud_thumbnail?: string;
  /** Pre-downloaded thumbnail buffer to avoid URL expiration */
  cached_thumbnail?: Buffer;
  /** Storage type (1=local, 2=cloud, 3=both) */
  storage_type?: number;
  /** Unique record ID */
  record_id?: number;
}

/**
 * Video clip query options
 */
export interface VideoClipQuery {
  /** Device serial number */
  serialNumber: string;
  /** Station serial number */
  stationSerialNumber: string;
  /** Start time in milliseconds */
  startTime: number;
  /** End time in milliseconds */
  endTime: number;
}

/**
 * Video dimensions
 */
export interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * Video clip with metadata
 */
export interface VideoClipWithMetadata extends VideoClip {
  metadata: VideoClipMetadata;
}

/**
 * Snapshot capture options
 */
export interface SnapshotOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** JPEG quality (1-31, lower is better) */
  quality?: number;
}
