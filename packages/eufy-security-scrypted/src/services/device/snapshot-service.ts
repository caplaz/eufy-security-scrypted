/**
 * Snapshot Service
 *
 * Handles camera snapshot/picture capture operations.
 * Captures H.264 keyframes from stream and converts to JPEG.
 *
 * @module services/device
 */

import { MediaObject, RequestPictureOptions } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { ConsoleLogger } from "../../utils/console-logger";
import { FFmpegUtils } from "../../utils/ffmpeg-utils";

/**
 * StreamServer interface (from @eufy-security/stream-server)
 */
export interface IStreamServer {
  captureSnapshot(timeout?: number): Promise<Buffer>;
}

/**
 * SnapshotService handles camera snapshot and picture operations
 *
 * This service captures H.264 keyframes from the camera stream
 * and converts them to JPEG images using FFmpeg.
 */
export class SnapshotService {
  constructor(
    private serialNumber: string,
    private streamServer: IStreamServer,
    private logger: ConsoleLogger
  ) {}

  /**
   * Get picture options supported by this device
   *
   * @returns Picture options with default timeout
   */
  getPictureOptions(): RequestPictureOptions {
    return {
      timeout: 15000, // 15 seconds default
    };
  }

  /**
   * Take a picture/snapshot from the camera
   *
   * Captures an H.264 keyframe from the camera stream and converts it to JPEG.
   *
   * @param options - Snapshot options (timeout, etc.)
   * @returns MediaObject containing the JPEG image
   */
  async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    this.logger.info("📸 Taking snapshot from camera stream");

    try {
      // Use timeout from options or default to 15 seconds
      const timeout = options?.timeout || 15000;

      this.logger.info(`Using timeout: ${timeout}ms for snapshot capture`);

      // The stream server handles starting/stopping the camera stream automatically
      // It starts the camera stream, waits for a keyframe, captures it, then stops the stream
      const h264Keyframe = await this.streamServer.captureSnapshot(timeout);

      this.logger.info(
        `Captured H.264 keyframe: ${h264Keyframe.length} bytes - converting to JPEG`
      );

      // Convert H.264 keyframe to JPEG using FFmpeg
      const jpegBuffer = await FFmpegUtils.convertH264ToJPEG(h264Keyframe);

      this.logger.info(
        `✅ Snapshot converted to JPEG: ${jpegBuffer.length} bytes`
      );

      // Create MediaObject with JPEG image
      return sdk.mediaManager.createMediaObject(jpegBuffer, "image/jpeg", {
        sourceId: this.serialNumber,
      });
    } catch (error) {
      this.logger.error(`Failed to capture snapshot: ${error}`);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.logger.debug("Snapshot service disposed");
  }
}
