/**
 * FFmpeg Utilities
 *
 * Utilities for FFmpeg operations including H.264 to JPEG conversion.
 *
 * @module utils
 */

import { ConsoleLogger, createConsoleLogger } from "./console-logger";

/**
 * FFmpegUtils provides utilities for video/image processing using FFmpeg
 */
export class FFmpegUtils {
  private static logger: ConsoleLogger = createConsoleLogger("FFmpegUtils");

  /**
   * Convert H.264 video data to JPEG image
   *
   * Extracts the first frame from H.264 encoded data and converts it to JPEG format.
   * Useful for creating snapshots from video keyframes.
   *
   * @param h264Data - Buffer containing H.264 encoded video data (typically a keyframe)
   * @param quality - JPEG quality setting (1-31, lower is better quality, default: 2)
   * @returns Promise resolving to Buffer containing JPEG image data
   * @throws Error if FFmpeg fails or returns invalid output
   *
   * @example
   * ```typescript
   * const h264Keyframe = await captureKeyframe();
   * const jpegBuffer = await FFmpegUtils.convertH264ToJPEG(h264Keyframe, 2);
   * ```
   */
  static async convertH264ToJPEG(
    h264Data: Buffer,
    quality: number = 2
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

      // Use FFmpeg to decode H.264 and encode as JPEG
      const ffmpeg = child_process.spawn("ffmpeg", [
        "-f",
        "h264", // Input format
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
            `Successfully converted H.264 to JPEG: ${jpegBuffer.length} bytes`
          );
          resolve(jpegBuffer);
        } else {
          const errorOutput = Buffer.concat(errorChunks).toString();
          const errorMessage = this.parseFFmpegError(code, errorOutput);
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

      // Write H.264 data to FFmpeg stdin
      ffmpeg.stdin.write(h264Data);
      ffmpeg.stdin.end();
    });
  }

  /**
   * Parse FFmpeg error output and provide helpful error messages
   */
  private static parseFFmpegError(
    code: number | null,
    errorOutput: string
  ): string {
    if (errorOutput.includes("Invalid data found when processing input")) {
      return `Invalid H.264 data provided. The data may be corrupted or incomplete.`;
    }

    if (errorOutput.includes("No such file or directory")) {
      return "FFmpeg executable not found. Please ensure FFmpeg is installed.";
    }

    if (errorOutput.includes("Permission denied")) {
      return "Permission denied accessing FFmpeg executable.";
    }

    if (errorOutput.includes("Decoder") && errorOutput.includes("not found")) {
      return "H.264 decoder not available in your FFmpeg installation.";
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
