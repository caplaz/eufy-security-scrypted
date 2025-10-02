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
import { ConsoleLogger } from "../../utils/console-logger";
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

  constructor(
    private serialNumber: string,
    private streamServer: IStreamServer,
    private logger: ConsoleLogger
  ) {}

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
    options?: RequestMediaStreamOptions
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
      "Creating MediaObject with fallback dimensions (metadata will be updated when stream starts)"
    );

    return await this.createOptimizedMediaObject(port, quality, options);
  }

  /**
   * Stop the video stream
   *
   * @returns Promise that resolves when stream is stopped
   */
  async stopStream(): Promise<void> {
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
   * Configures FFmpeg with low-latency H.264 settings optimized for
   * Eufy camera streams, including special handling for battery cameras
   * and front cameras that require longer analysis time.
   *
   * @param port - TCP port where stream server is listening
   * @param quality - Video quality setting
   * @param options - Request options from Scrypted
   * @returns MediaObject configured for FFmpeg
   */
  private async createOptimizedMediaObject(
    port: number,
    quality: VideoQuality | undefined,
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    const { width, height } = this.getVideoDimensions(quality);

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
