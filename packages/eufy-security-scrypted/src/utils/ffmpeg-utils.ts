/**
 * FFmpeg Utilities
 *
 * Utilities for FFmpeg operations including H.264 to JPEG conversion.
 *
 * @module utils
 */

import { Logger, ILogObj } from "tslog";

/**
 * FFmpegUtils provides utilities for video/image processing using FFmpeg
 */
export class FFmpegUtils {
  private static logger: Logger<ILogObj> = new Logger<ILogObj>({
    name: "FFmpegUtils",
    type: "hidden",
    minLevel: 3,
  });

  /**
   * Map a Eufy codec string (e.g. "H264", "H265") to an FFmpeg demuxer name.
   * H.265 is exposed as "hevc" in FFmpeg; everything else defaults to "h264".
   */
  static toFFmpegFormat(codec: string): string {
    if (codec.toUpperCase() === "H265" || codec.toUpperCase() === "HEVC") {
      return "hevc";
    }
    return "h264";
  }

  /**
   * Map a Eufy codec string to a Scrypted/MIME codec name.
   */
  static toScryptedCodec(codec: string): string {
    if (codec.toUpperCase() === "H265" || codec.toUpperCase() === "HEVC") {
      return "h265";
    }
    return "h264";
  }

  /**
   * Convert a raw H.264 or H.265 keyframe to a JPEG image.
   *
   * Extracts the first frame from the bitstream and converts it to JPEG.
   * Useful for creating snapshots from video keyframes.
   *
   * @param videoData - Buffer containing encoded video data (H.264 or H.265 keyframe)
   * @param quality - JPEG quality setting (1-31, lower is better quality, default: 2)
   * @param videoCodec - Eufy codec string ("H264" or "H265", default: "H264")
   * @returns Promise resolving to Buffer containing JPEG image data
   * @throws Error if FFmpeg fails or returns invalid output
   */
  static async convertH264ToJPEG(
    videoData: Buffer,
    quality: number = 2,
    videoCodec: string = "H264"
  ): Promise<Buffer> {
    const child_process = await import("child_process");

    return new Promise<Buffer>((resolve, reject) => {
      // Validate quality parameter
      if (quality < 1 || quality > 31) {
        reject(
          new Error("JPEG quality must be between 1 and 31 (lower is better)")
        );
        return;
      }

      const inputFormat = FFmpegUtils.toFFmpegFormat(videoCodec);

      // Use FFmpeg to decode video and encode as JPEG
      const ffmpeg = child_process.spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error", // Suppress informational output; only show errors
        "-f",
        inputFormat, // Input format: "h264" or "hevc"
        "-i",
        "pipe:0", // Read from stdin
        "-frames:v",
        "1", // Extract only the first frame
        "-f",
        "image2", // Output format
        "-c:v",
        "mjpeg", // JPEG codec
        "-q:v",
        quality.toString(), // Quality setting (1-31, lower is better)
        "pipe:1", // Write to stdout
      ]);

      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on("data", (chunk) => {
        errorChunks.push(chunk);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0 && chunks.length > 0) {
          const jpegBuffer = Buffer.concat(chunks);
          this.logger.debug(
            `Successfully converted ${inputFormat.toUpperCase()} to JPEG: ${jpegBuffer.length} bytes`
          );
          resolve(jpegBuffer);
        } else {
          const errorOutput = Buffer.concat(errorChunks).toString();
          const errorMessage = this.parseFFmpegError(code, errorOutput, inputFormat);
          this.logger.error(`FFmpeg conversion failed: ${errorMessage}`);
          reject(new Error(errorMessage));
        }
      });

      ffmpeg.on("error", (error) => {
        const errnoError = error as NodeJS.ErrnoException;
        if (errnoError.code === "ENOENT") {
          const message =
            "FFmpeg executable not found. Please ensure FFmpeg is installed and available in PATH.";
          this.logger.error(message);
          reject(new Error(message));
        } else {
          this.logger.error(`Failed to spawn FFmpeg: ${error.message}`);
          reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
        }
      });

      // Write video data to FFmpeg stdin
      ffmpeg.stdin.write(videoData);
      ffmpeg.stdin.end();
    });
  }

  /**
   * Parse FFmpeg error output and provide helpful error messages
   */
  private static parseFFmpegError(
    code: number | null,
    errorOutput: string,
    inputFormat: string = "h264"
  ): string {
    if (errorOutput.includes("Invalid data found when processing input")) {
      return `Invalid ${inputFormat.toUpperCase()} data provided. The data may be corrupted or incomplete.`;
    }

    if (errorOutput.includes("No such file or directory")) {
      return "FFmpeg executable not found. Please ensure FFmpeg is installed.";
    }

    if (errorOutput.includes("Permission denied")) {
      return "Permission denied accessing FFmpeg executable.";
    }

    if (errorOutput.includes("Decoder") && errorOutput.includes("not found")) {
      return `${inputFormat.toUpperCase()} decoder not available in your FFmpeg installation.`;
    }

    return `FFmpeg conversion failed with code ${code}: ${errorOutput || "Unknown error"}`;
  }

  /**
   * Check if FFmpeg is available in the system
   *
   * @returns Promise<boolean> indicating if FFmpeg is available
   */
  static async isFFmpegAvailable(): Promise<boolean> {
    const child_process = await import("child_process");

    return new Promise<boolean>((resolve) => {
      const ffmpeg = child_process.spawn("ffmpeg", ["-version"]);

      ffmpeg.on("error", (error) => {
        const errnoError = error as NodeJS.ErrnoException;
        if (errnoError.code === "ENOENT") {
          resolve(false);
        } else {
          resolve(false);
        }
      });

      ffmpeg.on("close", (code) => {
        resolve(code === 0);
      });
    });
  }

  /**
   * Get FFmpeg version information
   *
   * @returns Promise<string> containing FFmpeg version string
   */
  static async getFFmpegVersion(): Promise<string> {
    const child_process = await import("child_process");

    return new Promise<string>((resolve, reject) => {
      const ffmpeg = child_process.spawn("ffmpeg", ["-version"]);
      const chunks: Buffer[] = [];

      ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.on("error", (error) => {
        reject(error);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          const output = Buffer.concat(chunks).toString();
          // Extract version from first line (e.g., "ffmpeg version 4.4.2")
          const firstLine = output.split("\n")[0];
          resolve(firstLine);
        } else {
          reject(new Error("Failed to get FFmpeg version"));
        }
      });
    });
  }
}
