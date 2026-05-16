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
import { Logger, ILogObj } from "tslog";
import { FFmpegUtils } from "../../utils/ffmpeg-utils";
import { IStreamServer } from "./types";

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
    private logger: Logger<ILogObj>,
  ) {}

  /**
   * Get picture options supported by this device
   *
   * @returns Picture options with default timeout
   */
  getPictureOptions(): RequestPictureOptions {
    // 60s default. Battery cameras (T8170 S340 deep sleep, T86P2 4G LTE
    // cold-start) need 30–45s of P2P warm-up before the first IDR arrives.
    return {
      timeout: 60000,
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
      // 60s default — see getPictureOptions for rationale.
      const timeout = options?.timeout || 60000;

      this.logger.info(`Using timeout: ${timeout}ms for snapshot capture`);

      // The stream server handles starting/stopping the camera stream automatically
      // It starts the camera stream, waits for a keyframe, captures it, then stops the stream
      const h264Keyframe = await this.streamServer.captureSnapshot(timeout);

      // Detect codec from last received stream metadata (H264 or H265)
      const videoCodec =
        this.streamServer.getVideoMetadata()?.videoCodec ?? "H264";

      this.logger.info(
        `Captured ${videoCodec} keyframe: ${h264Keyframe.length} bytes - converting to JPEG`,
      );

      // Convert keyframe to JPEG using FFmpeg
      const jpegBuffer = await FFmpegUtils.convertH264ToJPEG(
        h264Keyframe,
        2,
        videoCodec,
      );

      this.logger.info(
        `✅ Snapshot converted to JPEG: ${jpegBuffer.length} bytes`,
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
