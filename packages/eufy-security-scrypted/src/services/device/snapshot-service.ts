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
// Tiny solid-color JPEG (320x180) returned for a thumbnail when no real frame
// has been cached yet. Returning a VALID image (rather than throwing) is
// essential: on a takePicture rejection, Scrypted's Snapshot plugin falls back
// to pulling a frame from the *video stream*, which starts a livestream and
// re-introduces the HomeBase stampede we're trying to avoid.
const PLACEHOLDER_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABwEBAQAAAAAAAAAAAAAAAAAAAAEQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAC0AUADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCNgKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//Z",
  "base64",
);

/** Thumbnails are shown at a few hundred pixels; never ship a 4K JPEG. */
const SNAPSHOT_MAX_WIDTH = 640;
const SNAPSHOT_JPEG_QUALITY = 3;
/**
 * Eufy sends a full 640x360 event frame and, for person events, a small
 * crop of the face right after it; only full frames make a useful tile.
 */
const EVENT_PICTURE_MIN_WIDTH = 320;

/** Width of a baseline/progressive JPEG from its SOF marker, if found. */
export function jpegWidth(jpeg: Buffer): number | undefined {
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) return undefined;
    const marker = jpeg[offset + 1];
    const length = jpeg.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return jpeg.readUInt16BE(offset + 7);
    }
    offset += 2 + length;
  }
  return undefined;
}

export class SnapshotService {
  /** JPEG of the newest keyframe, reused until a newer keyframe arrives. */
  private jpegCache?: { source: Buffer; jpeg: Buffer; capturedAt: number };
  /** Event thumbnail from the `picture` property (already a small JPEG). */
  private eventPicture?: { jpeg: Buffer; receivedAt: number };
  /** Keyframe that failed to decode; never retried. */
  private failedSource?: Buffer;

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
   * Store the event thumbnail Eufy attaches to motion events (`picture`
   * property). Served when it is newer than the cached keyframe.
   */
  setEventPicture(jpeg: Buffer): void {
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return;
    const width = jpegWidth(jpeg);
    if (width !== undefined && width < EVENT_PICTURE_MIN_WIDTH) {
      this.logger.info(
        `🖼️ [snapshot] ignoring ${width}px event picture (crop, not a full frame)`,
      );
      return;
    }
    this.eventPicture = { jpeg, receivedAt: Date.now() };
  }

  /**
   * Take a picture/snapshot from the camera.
   *
   * Serves the newest of: the cached keyframe (converted once to a JPEG of
   * at most SNAPSHOT_MAX_WIDTH) and the last motion-event thumbnail. Never
   * throws for a missing or undecodable frame: a rejection makes Scrypted's
   * Snapshot plugin fall back to the video stream, which wakes the camera.
   *
   * @param options - Snapshot options (timeout, etc.)
   * @returns MediaObject containing the JPEG image
   */
  async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    const startedAt = Date.now();
    const requested = options?.picture
      ? `${options.picture.width ?? "?"}x${options.picture.height ?? "?"}`
      : "unspecified";
    // Scrypted doesn't say who is asking; reason/periodic/bulk/id are the
    // closest hints (the Home grid sends periodic bulk requests).
    this.logger.info(
      `📸 [snapshot] request id=${options?.id ?? "-"} reason=${options?.reason ?? "-"} ` +
        `periodic=${options?.periodicRequest ?? false} bulk=${options?.bulkRequest ?? false} ` +
        `size=${requested} timeout=${options?.timeout ?? "-"}`,
    );

    // Thumbnails are served from cache ONLY — never wake the camera.
    //
    // A HomeBase serves just one camera P2P stream at a time. The Home-app
    // "Cameras" grid fires a snapshot request for every camera at once; if
    // each cache-miss woke its camera, they'd all stampede the single
    // HomeBase slot and fail together (the wedge cascade). The cache is
    // refreshed for free whenever the camera is genuinely awake — live
    // view, motion/HKSV recording, or the serial background refresh — so
    // thumbnails are "last seen", which is the correct, battery-friendly
    // behavior for these cameras.
    const cached = this.streamServer.getCachedKeyframe(
      Number.POSITIVE_INFINITY,
    );
    let source = "placeholder";
    let jpeg: Buffer = PLACEHOLDER_JPEG;
    let ageMs: number | undefined;

    if (cached) {
      const keyframeJpeg = await this.keyframeJpeg(
        cached.data,
        cached.codec,
        Date.now() - cached.ageMs,
      );
      if (keyframeJpeg) {
        source = keyframeJpeg.converted
          ? "keyframe (converted)"
          : "keyframe (cached jpeg)";
        jpeg = keyframeJpeg.jpeg;
        ageMs = Date.now() - keyframeJpeg.capturedAt;
      }
    }
    const event = this.eventPicture;
    if (
      event &&
      (ageMs === undefined || Date.now() - event.receivedAt < ageMs)
    ) {
      source = "event picture";
      jpeg = event.jpeg;
      ageMs = Date.now() - event.receivedAt;
    }

    this.logger.info(
      `📸 [snapshot] served source=${source} ` +
        `age=${ageMs === undefined ? "-" : `${Math.round(ageMs / 1000)}s`} ` +
        `jpeg=${jpeg.length}B total=${Date.now() - startedAt}ms`,
    );
    return sdk.mediaManager.createMediaObject(jpeg, "image/jpeg", {
      sourceId: this.serialNumber,
    });
  }

  /**
   * JPEG for a keyframe: the cached one if this keyframe was already
   * converted, a fresh conversion otherwise. A keyframe that fails to decode
   * is remembered and the last good JPEG is returned instead.
   */
  private async keyframeJpeg(
    keyframe: Buffer,
    codec: string,
    capturedAt: number,
  ): Promise<{ jpeg: Buffer; capturedAt: number; converted: boolean } | null> {
    const cache = this.jpegCache;
    if (cache && cache.source === keyframe) {
      return {
        jpeg: cache.jpeg,
        capturedAt: cache.capturedAt,
        converted: false,
      };
    }
    if (this.failedSource !== keyframe) {
      const convertStartedAt = Date.now();
      try {
        const jpeg = await FFmpegUtils.convertH264ToJPEG(
          keyframe,
          SNAPSHOT_JPEG_QUALITY,
          codec,
          SNAPSHOT_MAX_WIDTH,
        );
        if (jpeg.length > 0) {
          this.jpegCache = { source: keyframe, jpeg, capturedAt };
          this.logger.info(
            `✅ Snapshot converted to JPEG: ${keyframe.length}B ${codec} → ${jpeg.length}B ` +
              `in ${Date.now() - convertStartedAt}ms`,
          );
          return { jpeg, capturedAt, converted: true };
        }
        throw new Error("empty JPEG");
      } catch (error) {
        this.failedSource = keyframe;
        this.logger.warn(
          `📸 Keyframe ${keyframe.length}B ${codec} does not decode (${error}) — ` +
            `${cache ? "keeping the previous JPEG" : "no previous JPEG"}`,
        );
      }
    }
    return cache
      ? { jpeg: cache.jpeg, capturedAt: cache.capturedAt, converted: false }
      : null;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.logger.debug("Snapshot service disposed");
  }
}
