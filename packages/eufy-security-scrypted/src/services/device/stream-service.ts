/**
 * Stream Service
 *
 * Manages video streaming operations for Eufy devices.
 * Handles stream server lifecycle, FFmpeg configuration, and media object creation.
 *
 * @module services/device
 */

import {
  FFmpegInput,
  MediaObject,
  RequestMediaStreamOptions,
  ResponseMediaStreamOptions,
} from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
import { VideoQuality } from "@caplaz/eufy-security-client";
import { FFmpegUtils } from "../../utils/ffmpeg-utils";
import { H264TranscodeServer } from "../../utils/h264-transcode-server";
import { Logger, ILogObj } from "tslog";
import { IStreamServer } from "./types";

/**
 * Video dimensions based on quality
 */
export interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * Stream configuration options
 */
export interface StreamConfig {
  quality?: VideoQuality;
  container?: string;
  codec?: string;
}

/**
 * StreamService handles video streaming operations
 *
 * This service manages the video stream lifecycle, including:
 * - Stream server startup/shutdown
 * - FFmpeg configuration for low-latency streaming
 * - Media object creation for Scrypted
 * - Video dimension calculation based on quality
 */
export class StreamService {
  private streamServerStarted = false;
  private transcodeServer?: H264TranscodeServer;
  private resolvedFfmpegPath?: string;

  /**
   * @param shouldTranscode - returns whether this camera should emit H.264 to
   *   Scrypted (the per-camera "Transcode to H.264" toggle). Transcoding only
   *   actually engages when this returns true AND the live source is H.265 —
   *   native H.264 is always passed through untouched. Defaults to disabled.
   * @param isThrottling - returns whether transcoding is currently being
   *   suppressed to protect the host (CPU too hot). When true, a stream that
   *   would normally transcode falls back to H.265 passthrough. Defaults off.
   */
  constructor(
    private serialNumber: string,
    private streamServer: IStreamServer,
    private logger: Logger<ILogObj>,
    private shouldTranscode: () => boolean = () => false,
    private isThrottling: () => boolean = () => false,
  ) {}

  /**
   * Whether this stream WOULD transcode (toggle on, source is H.265, muxed
   * port available) — ignoring the thermal throttle. Used to log when the
   * throttle is the only reason we're not transcoding.
   */
  private transcodeRequested(): boolean {
    if (!this.shouldTranscode()) return false;
    const eufyCodec = this.streamServer.getVideoMetadata()?.videoCodec ?? "H264";
    if (FFmpegUtils.toScryptedCodec(eufyCodec) !== "h265") return false;
    return !!this.streamServer.getMuxedPort();
  }

  /**
   * True when we should actually hand Scrypted a transcoded H.264 stream:
   * transcoding is requested AND the host isn't thermally throttling. Native
   * H.264 sources never transcode; a hot host falls back to H.265 passthrough.
   */
  private transcodeEnabled(): boolean {
    return this.transcodeRequested() && !this.isThrottling();
  }

  /**
   * Get video dimensions based on quality setting
   *
   * @param quality - Video quality setting
   * @returns Video dimensions (width and height)
   */
  getVideoDimensions(quality?: VideoQuality): VideoDimensions {
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

  /**
   * Get available video stream options
   *
   * @param quality - Current video quality setting
   * @returns Array of stream options for Scrypted
   */
  getVideoStreamOptions(quality?: VideoQuality): ResponseMediaStreamOptions[] {
    const { width, height } = this.getVideoDimensions(quality);
    // Advertise H.264 when we will transcode, so downstream consumers know the
    // stream is plain H.264 (no Scrypted-side transcode needed); otherwise
    // report the true source codec.
    const codec = this.transcodeEnabled()
      ? "h264"
      : FFmpegUtils.toScryptedCodec(
          this.streamServer.getVideoMetadata()?.videoCodec ?? "H264",
        );

    return [
      {
        id: "p2p",
        name: "P2P Stream",
        container: "mp4",
        video: {
          codec,
          width,
          height,
        },
        audio: {
          codec: "aac",
        },
      },
    ];
  }

  /**
   * Get video stream media object
   *
   * Starts the stream server if needed and creates a MediaObject
   * configured for low-latency H.264 streaming via FFmpeg.
   *
   * @param quality - Video quality setting
   * @param options - Request options from Scrypted
   * @returns MediaObject for FFmpeg streaming
   */
  async getVideoStream(
    quality: VideoQuality | undefined,
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    this.logger.info("Getting video stream, starting stream server if needed");

    if (!this.streamServerStarted) {
      this.logger.info("Starting stream server...");
      await this.streamServer.start();
      this.streamServerStarted = true;
      this.logger.info("Stream server started");
    }

    const port = this.streamServer.getPort();
    if (!port) {
      throw new Error("Failed to get stream server port");
    }

    this.logger.info(`Stream server is listening on port ${port}`);
    this.logger.info(
      "Creating MediaObject with fallback dimensions (metadata will be updated when stream starts)",
    );

    // H.265 source + transcode toggle on → hand Scrypted real H.264 from the
    // in-plugin transcode relay so HomeKit / WebRTC work without Scrypted's
    // per-camera Transcoding Debug Mode.
    if (this.transcodeEnabled()) {
      const transcodePort = await this.ensureTranscodeServer();
      if (transcodePort) {
        this.logger.info(
          `🎞️  Serving H.264 (transcoded from H.265) via relay port ${transcodePort}`,
        );
        return await this.createTranscodedMediaObject(
          transcodePort,
          quality,
          options,
        );
      }
      this.logger.warn(
        "Transcode requested but relay unavailable — falling back to passthrough",
      );
    } else if (this.transcodeRequested() && this.isThrottling()) {
      // Would transcode, but the host is too hot — serve H.265 as-is so we
      // don't add encode load. Live view may degrade until the host cools.
      this.logger.warn(
        "🌡️ CPU hot — serving H.265 passthrough instead of transcoding to protect the host",
      );
    }

    return await this.createOptimizedMediaObject(port, quality, options);
  }

  /**
   * Lazily start the H.264 transcode relay and return its port. Resolves the
   * Scrypted-bundled ffmpeg path once (falls back to "ffmpeg" on PATH).
   */
  private async ensureTranscodeServer(): Promise<number | undefined> {
    if (!this.transcodeServer) {
      if (this.resolvedFfmpegPath === undefined) {
        try {
          this.resolvedFfmpegPath = await sdk.mediaManager.getFFmpegPath();
        } catch {
          this.resolvedFfmpegPath = "ffmpeg";
        }
      }
      this.transcodeServer = new H264TranscodeServer({
        serialNumber: this.serialNumber,
        logger: this.logger,
        getSourcePort: () => this.streamServer.getMuxedPort(),
        ffmpegPath: this.resolvedFfmpegPath,
      });
    }
    if (!this.transcodeServer.isRunning()) {
      await this.transcodeServer.start();
    }
    return this.transcodeServer.getPort();
  }

  /**
   * Build a MediaObject that reads plain H.264 fMP4 from the transcode relay.
   */
  private async createTranscodedMediaObject(
    transcodePort: number,
    quality: VideoQuality | undefined,
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    const { width, height } = this.getVideoDimensions(quality);

    const inputArguments = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-fflags",
      "+genpts+nobuffer",
      "-analyzeduration",
      "2000000",
      "-probesize",
      "1000000",
      "-f",
      "mp4",
      "-i",
      `tcp://127.0.0.1:${transcodePort}`,
    ];

    const ffmpegInput: FFmpegInput = {
      url: undefined,
      inputArguments,
      mediaStreamOptions: {
        id: options?.id || "main",
        name: options?.name || "Eufy Camera Stream (H.264)",
        container: "mp4",
        video: {
          ...options?.video,
          // The relay emits real H.264, so this label is accurate and the
          // downstream `-vcodec copy` produces a valid H.264 stream.
          codec: "h264",
          width,
          height,
        },
        audio: { codec: "aac" },
      },
    };

    return await sdk.mediaManager.createFFmpegMediaObject(ffmpegInput);
  }

  /**
   * Stop the video stream
   *
   * @returns Promise that resolves when stream is stopped
   */
  async stopStream(): Promise<void> {
    if (this.transcodeServer) {
      await this.transcodeServer.stop();
    }
    if (this.streamServerStarted) {
      this.logger.info("Stopping stream server");
      await this.streamServer.stop();
      this.streamServerStarted = false;
      this.logger.info("Stream server stopped");
    }
  }

  /**
   * Check if stream is currently active
   *
   * @returns true if stream server is running
   */
  isStreaming(): boolean {
    return this.streamServerStarted;
  }

  /**
   * Create an optimized MediaObject for FFmpeg streaming
   *
   * Configures FFmpeg with simplified settings for reliable Eufy camera streaming.
   * Uses basic H.264 input with increased analysis time for header detection.
   *
   * @param port - TCP port where stream server is listening
   * @param quality - Video quality setting
   * @param options - Request options from Scrypted
   * @returns MediaObject configured for FFmpeg
   */
  private async createOptimizedMediaObject(
    port: number,
    quality: VideoQuality | undefined,
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    const { width, height } = this.getVideoDimensions(quality);

    // Detect codec from last received stream metadata; default to H264
    const eufyCodec =
      this.streamServer.getVideoMetadata()?.videoCodec ?? "H264";
    const scryptedCodec = FFmpegUtils.toScryptedCodec(eufyCodec); // "h264" or "h265"

    // Use the muxed fMP4 port if available. The stream server runs an
    // in-process JMuxer (no ffmpeg subprocess) that consumes raw H.264
    // and ADTS AAC from the WebSocket events directly and produces
    // fragmented MP4 — the codec config is in the `moov` init segment so
    // the downstream Rebroadcast plugin's `-acodec copy -vcodec copy` to
    // RTSP works without any extradata dance.
    const muxedPort = this.streamServer.getMuxedPort();
    const useMuxed = !!muxedPort;

    const inputArguments = useMuxed
      ? [
          "-hide_banner",
          "-loglevel",
          "error",
          "-fflags",
          "+genpts+nobuffer",
          "-analyzeduration",
          "2000000",
          "-probesize",
          "1000000",
          "-f",
          "mp4",
          "-i",
          `tcp://127.0.0.1:${muxedPort}`,
        ]
      : [
          "-hide_banner",
          "-loglevel",
          "error",
          "-use_wallclock_as_timestamps",
          "1",
          "-analyzeduration",
          "5000000",
          "-probesize",
          "5000000",
          "-f",
          FFmpegUtils.toFFmpegFormat(eufyCodec),
          "-i",
          `tcp://127.0.0.1:${port}`,
          "-an",
        ];

    const ffmpegInput: FFmpegInput = {
      url: undefined,
      inputArguments,
      mediaStreamOptions: {
        id: options?.id || "main",
        name: options?.name || "Eufy Camera Stream",
        container: useMuxed ? "mp4" : options?.container,
        video: {
          ...options?.video,
          // Our source codec is authoritative. A consumer (e.g. HomeKit)
          // requests `codec: 'h264'`; spreading that over ours would relabel
          // our H.265 stream as H.264, so it gets `-vcodec copy`'d as-is and
          // fails ("codec must be h264 but is h265"). Report what we actually
          // send (h265 for these cameras) so downstream transcodes correctly.
          codec: scryptedCodec,
          width,
          height,
        },
        ...(useMuxed && { audio: { codec: "aac" } }),
      },
    };

    return await sdk.mediaManager.createFFmpegMediaObject(ffmpegInput);
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.stopStream();
    this.logger.debug("Stream service disposed");
  }
}
