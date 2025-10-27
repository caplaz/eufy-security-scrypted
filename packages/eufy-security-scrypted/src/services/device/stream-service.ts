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

  constructor(
    private serialNumber: string,
    private streamServer: IStreamServer,
    private logger: Logger<ILogObj>
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
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    const { width, height } = this.getVideoDimensions(quality);

    // Simplified FFmpeg configuration for reliable Eufy camera streaming
    const ffmpegInput: FFmpegInput = {
      url: undefined,
      inputArguments: [
        "-use_wallclock_as_timestamps",
        "1", // Critical for Eufy streams - fixes timestamp issues
        "-analyzeduration",
        "5000000", // Increased analysis time to find SPS/PPS headers
        "-probesize",
        "5000000", // Increased probe size to find SPS/PPS headers
        "-f",
        "h264", // Explicitly specify H.264 format
        "-i",
        `tcp://127.0.0.1:${port}`, // TCP input from local stream server
        "-an", // Disable audio
        "-sn", // Disable subtitles
        "-dn", // Disable data streams
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
