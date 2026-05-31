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
  // Serve a cached keyframe for thumbnails when one no older than this exists.
  // Battery cameras can't be woken fast enough for a 5-up Home app grid (each
  // wake is a cold P2P session of up to 60s, and they contend on the single
  // HomeBase), so the grid is served from cache and only a genuinely stale
  // camera pays for a live wake. Refreshed for free whenever the camera is
  // already awake (live view, HKSV recording, motion-triggered stream).
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
      // Thumbnails are served from cache ONLY — never wake the camera.
      //
      // A HomeBase serves just one camera P2P stream at a time. The Home-app
      // "Cameras" grid fires a snapshot request for every camera at once; if
      // each cache-miss woke its camera, they'd all stampede the single
      // HomeBase slot and fail together (the wedge cascade). The cache is
      // refreshed for free whenever the camera is genuinely awake — live
      // view, motion/HKSV recording, or the serial background refresh — so
      // thumbnails are "last seen", which is the correct, battery-friendly
      // behavior for these cameras. `options` (incl. any timeout) is ignored
      // on purpose: there is no on-demand wake here.
      void options;
      const cached = this.streamServer.getCachedKeyframe(
        Number.POSITIVE_INFINITY,
      );
      if (cached) {
        this.logger.info(
          `📸 Serving snapshot from cached keyframe: ${cached.data.length} bytes, ` +
            `${Math.round(cached.ageMs / 1000)}s old, ${cached.codec} — no camera wake`,
        );
        return await this.toJpegMediaObject(cached.data, cached.codec);
      }

      // No frame has ever been cached this session (the camera hasn't
      // streamed yet). Don't wake it for a thumbnail — that would contend
      // for the shared HomeBase slot. The tile keeps its last image (or
      // shows unavailable) until the camera next streams.
      throw new Error(
        "No cached frame yet — camera has not streamed this session; not waking for a thumbnail",
      );
    } catch (error) {
      this.logger.error(`Failed to capture snapshot: ${error}`);
      throw error;
    }
  }

  /**
   * Convert a raw H.264/H.265 keyframe to a JPEG MediaObject.
   *
   * @param keyframe - Self-contained keyframe bitstream (parameter sets included)
   * @param videoCodec - Codec of the keyframe ("H264" or "H265")
   */
  private async toJpegMediaObject(
    keyframe: Buffer,
    videoCodec: string,
  ): Promise<MediaObject> {
    const jpegBuffer = await FFmpegUtils.convertH264ToJPEG(
      keyframe,
      2,
      videoCodec,
    );

    this.logger.info(
      `✅ Snapshot converted to JPEG: ${jpegBuffer.length} bytes`,
    );

    return sdk.mediaManager.createMediaObject(jpegBuffer, "image/jpeg", {
      sourceId: this.serialNumber,
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.logger.debug("Snapshot service disposed");
  }
}
