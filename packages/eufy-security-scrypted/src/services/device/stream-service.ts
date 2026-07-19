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
import {
  CompatibilityEncoderPool,
  getSharedH264CompatibilityRelay,
  H264CompatibilityRelay,
  ThermalGovernor,
} from "@caplaz/eufy-stream-server";
import { FFmpegUtils } from "../../utils/ffmpeg-utils";
import { Logger, ILogObj } from "tslog";
import {
  selectStream,
  CompatibilityMode,
  SourceCodec,
} from "./stream-selector";
import { IStreamServer, MetadataBootstrapWaiter } from "./types";

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

interface CompatibilityRelay {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number | undefined;
}

export interface StreamServiceOptions {
  compatibilityMode?: () => CompatibilityMode;
  thermalGovernor?: Pick<
    ThermalGovernor,
    "checkCompatibilityEncoderAdmission" | "getStatus"
  >;
  encoderPool?: CompatibilityEncoderPool;
  relayFactory?: (options: {
    serialNumber: string;
    streamServer: IStreamServer;
    ffmpegPath: string;
    pool: CompatibilityEncoderPool;
  }) => CompatibilityRelay;
  metadataTimeoutMs?: number;
}

const METADATA_BOOTSTRAP_TIMEOUT_MS = 15_000;
let sharedEncoderPool: CompatibilityEncoderPool | undefined;
let defaultThermalGovernor: ThermalGovernor | undefined;

function getSharedEncoderPool(): CompatibilityEncoderPool {
  return (sharedEncoderPool ??= new CompatibilityEncoderPool());
}

function getDefaultThermalGovernor(): ThermalGovernor {
  return (defaultThermalGovernor ??= new ThermalGovernor());
}

function escapeStreamRequestLogField(value?: string): string {
  return (value ?? "<none>").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
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
  private relay?: CompatibilityRelay;
  private resolvedFfmpegPath?: string;
  private readonly bootstrapHandoffs = new Set<() => void>();
  private readonly compatibilityMode: () => CompatibilityMode;
  private readonly thermalGovernor?: Pick<
    ThermalGovernor,
    "checkCompatibilityEncoderAdmission" | "getStatus"
  >;
  private readonly encoderPool?: CompatibilityEncoderPool;
  private readonly relayFactory?: StreamServiceOptions["relayFactory"];
  private readonly metadataTimeoutMs: number;

  constructor(
    private serialNumber: string,
    private streamServer: IStreamServer,
    private logger: Logger<ILogObj>,
    options: StreamServiceOptions = {},
  ) {
    this.compatibilityMode = options.compatibilityMode ?? (() => "Auto");
    this.thermalGovernor = options.thermalGovernor;
    this.encoderPool = options.encoderPool;
    this.relayFactory = options.relayFactory;
    this.metadataTimeoutMs =
      options.metadataTimeoutMs ?? METADATA_BOOTSTRAP_TIMEOUT_MS;
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
    const source = this.currentVerifiedSource();
    const audio = this.truthfulAudioOption();
    const native: ResponseMediaStreamOptions = {
      id: "p2p",
      name: "P2P Stream",
      container: "mp4",
      video: source.codec
        ? { codec: FFmpegUtils.toScryptedCodec(source.codec), width, height }
        : { width, height },
      ...(audio && { audio }),
    };

    if (source.codec !== "H265") return [native];

    return [
      native,
      {
        id: "p2p-h264",
        name: "P2P Stream (H.264 Compatibility)",
        container: "mp4",
        video: { codec: "h264", width, height },
        ...(audio && { audio }),
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
    this.logger.info(
      `[stream-request] id=${escapeStreamRequestLogField(options?.id)} destination=${escapeStreamRequestLogField(options?.destination)} tool=${escapeStreamRequestLogField(options?.tool)}`,
    );
    this.logger.info("Getting video stream, starting stream server if needed");

    if (!this.streamServerStarted) {
      this.logger.info("Starting stream server...");
      await this.streamServer.start();
      this.streamServerStarted = true;
      this.logger.info("Stream server started");
    }

    let bootstrap: MetadataBootstrapWaiter | undefined;
    try {
      const resolved = await this.resolveCurrentSource();
      bootstrap = resolved.bootstrap;
      const selection = await this.select(resolved.codec, options);

      if (selection.kind === "error") {
        this.logger.warn(selection.message);
        throw new Error(selection.message);
      }

      if (selection.streamId === "p2p-h264") {
        const relayPort = await this.ensureCompatibilityRelay();
        const media = await this.createCompatibilityMediaObject(
          relayPort,
          quality,
          options,
        );
        this.handoffBootstrapOnConsumerAttach(bootstrap);
        return media;
      }

      const port = this.streamServer.getPort();
      if (!port) throw new Error("Failed to get stream server port");
      this.logger.info(`Stream server is listening on port ${port}`);
      const media = await this.createNativeMediaObject(
        port,
        resolved.codec,
        quality,
        options,
      );
      this.handoffBootstrapOnConsumerAttach(bootstrap);
      return media;
    } catch (error) {
      bootstrap?.cancel();
      throw error;
    }
  }

  /**
   * Stop the video stream
   *
   * @returns Promise that resolves when stream is stopped
   */
  async stopStream(): Promise<void> {
    this.releaseBootstrapHandoffs();
    if (this.relay) {
      await this.relay.stop();
      this.relay = undefined;
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
  private async createNativeMediaObject(
    port: number,
    sourceCodec: SourceCodec,
    quality: VideoQuality | undefined,
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    const { width, height } = this.getVideoDimensions(quality);

    const scryptedCodec = FFmpegUtils.toScryptedCodec(sourceCodec);

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
          FFmpegUtils.toFFmpegFormat(sourceCodec),
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
        ...(useMuxed &&
          this.truthfulAudioOption() && {
            audio: this.truthfulAudioOption(),
          }),
      },
    };

    return await sdk.mediaManager.createFFmpegMediaObject(ffmpegInput);
  }

  private currentVerifiedSource(): { codec?: SourceCodec; verified: boolean } {
    if (!this.streamServer.isMetadataVerifiedForCurrentSession()) {
      return { verified: false };
    }
    const codec = this.toSourceCodec(
      this.streamServer.getVideoMetadata()?.videoCodec,
    );
    return { codec, verified: !!codec };
  }

  private async resolveCurrentSource(): Promise<{
    codec: SourceCodec;
    bootstrap?: MetadataBootstrapWaiter;
  }> {
    const current = this.currentVerifiedSource();
    if (current.codec) return { codec: current.codec };

    const bootstrap = this.streamServer.acquireMetadataWaiter(
      this.metadataTimeoutMs,
    );
    try {
      const metadata = await bootstrap.promise;
      const codec = this.toSourceCodec(metadata.videoCodec);
      if (!codec || !this.streamServer.isMetadataVerifiedForCurrentSession()) {
        throw new Error(
          "Live video metadata was received without a verified source codec",
        );
      }
      return { codec, bootstrap };
    } catch (error) {
      bootstrap.cancel();
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to determine the current live video codec for ${this.serialNumber}. ` +
          `Wait for the camera to deliver video and retry. (${detail})`,
      );
    }
  }

  private async select(
    codec: SourceCodec,
    options?: RequestMediaStreamOptions,
  ) {
    const input = {
      streamId: options?.id,
      destination: options?.destination,
      compatibilityMode: this.compatibilityMode(),
      source: { codec, verified: true },
    };
    let selection = selectStream(input);
    if (selection.kind !== "stream" || selection.streamId !== "p2p-h264") {
      return selection;
    }

    const thermalGovernor = this.thermalGovernor ?? getDefaultThermalGovernor();
    const admitted = await thermalGovernor.checkCompatibilityEncoderAdmission();
    if (admitted) return selection;
    const status = thermalGovernor.getStatus();
    const availabilityError = `thermal admission denied (${status.reason}${
      status.temperatureC === undefined ? "" : ` at ${status.temperatureC}°C`
    })`;
    this.logger.warn(
      `Cannot start H.264 compatibility stream for ${this.serialNumber}: ${availabilityError}`,
    );
    selection = selectStream({ ...input, availabilityError });
    return selection;
  }

  private async ensureCompatibilityRelay(): Promise<number> {
    if (!this.relay) {
      const encoderPool = this.encoderPool ?? getSharedEncoderPool();
      const relayFactory =
        this.relayFactory ??
        ((relayOptions) =>
          getSharedH264CompatibilityRelay(
            relayOptions,
          ) as H264CompatibilityRelay);
      this.relay = relayFactory({
        serialNumber: this.serialNumber,
        streamServer: this.streamServer,
        ffmpegPath: await this.resolveFfmpegPath(),
        pool: encoderPool,
      });
    }
    try {
      await this.relay.start();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Cannot start H.264 compatibility relay for ${this.serialNumber}: ${detail}`,
      );
      throw new Error(
        `H.264 compatibility stream is unavailable for ${this.serialNumber}: ${detail}`,
      );
    }
    const port = this.relay.getPort();
    if (!port) {
      throw new Error(
        `H.264 compatibility relay started without a listening port for ${this.serialNumber}`,
      );
    }
    return port;
  }

  private async resolveFfmpegPath(): Promise<string> {
    if (this.resolvedFfmpegPath) return this.resolvedFfmpegPath;
    try {
      this.resolvedFfmpegPath = await sdk.mediaManager.getFFmpegPath();
    } catch {
      this.resolvedFfmpegPath = "ffmpeg";
    }
    return this.resolvedFfmpegPath;
  }

  private async createCompatibilityMediaObject(
    port: number,
    quality: VideoQuality | undefined,
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    const { width, height } = this.getVideoDimensions(quality);
    return sdk.mediaManager.createFFmpegMediaObject({
      url: undefined,
      inputArguments: this.createMuxedInputArguments(port),
      mediaStreamOptions: {
        id: options?.id || "p2p-h264",
        name: options?.name || "Eufy Camera Stream (H.264 Compatibility)",
        container: "mp4",
        video: { ...options?.video, codec: "h264", width, height },
        ...(this.truthfulAudioOption() && {
          audio: this.truthfulAudioOption(),
        }),
      },
    });
  }

  private createMuxedInputArguments(port: number): string[] {
    return [
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
      `tcp://127.0.0.1:${port}`,
    ];
  }

  private truthfulAudioOption(): { codec: "aac" } | undefined {
    return this.streamServer.getAudioStatus() === "aac"
      ? { codec: "aac" }
      : undefined;
  }

  private toSourceCodec(codec?: string): SourceCodec | undefined {
    const normalized = codec?.toUpperCase();
    if (normalized === "H264" || normalized === "AVC") return "H264";
    if (normalized === "H265" || normalized === "HEVC") return "H265";
    return undefined;
  }

  private handoffBootstrapOnConsumerAttach(
    bootstrap?: MetadataBootstrapWaiter,
  ): void {
    if (!bootstrap) return;
    let removeListener: () => void = () => undefined;
    const release = () => {
      removeListener();
      this.bootstrapHandoffs.delete(release);
      bootstrap.release();
    };
    removeListener = this.streamServer.onNextConsumerAttached(release);
    this.bootstrapHandoffs.add(release);
  }

  private releaseBootstrapHandoffs(): void {
    for (const release of [...this.bootstrapHandoffs]) release();
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.stopStream();
    this.logger.debug("Stream service disposed");
  }
}
