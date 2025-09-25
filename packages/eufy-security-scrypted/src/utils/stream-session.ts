/**
 * EufyStreamSession: Comprehensive video and audio streaming session manager for Eufy devices in Scrypted
 *
 * Key Features:
 * - Robust TCP server for H.264 video streaming with optional audio support
 * - Efficient NAL unit parsing and intelligent buffer management with memory monitoring
 * - Audio streaming support with AAC codec detection and metadata handling
 * - Clean separation of stream lifecycle and event handling for maintainability
 * - Smart stream reuse: multiple consumers can attach to a single active stream
 * - Memory-conscious buffer dropping with priority preservation (SPS/PPS/IDR frames)
 * - FFmpeg-compatible H.264+audio stream formatting with proper start code handling
 *
 * Architecture:
 * 1. WebSocket API manages device streaming commands for both video and audio
 * 2. TCP server provides local endpoint for FFmpeg consumption with multiplexed streams
 * 3. NAL unit parser handles H.264 frame processing and validation
 * 4. Audio processor handles AAC/other audio codec data from device
 * 5. Memory monitor prevents buffer overflow and manages cleanup
 * 6. Stream lifecycle manages connection state and cleanup for both streams
 */

import net from 'net';
import { FFmpegInput, MediaObject, RequestMediaStreamOptions, sdk } from '@scrypted/sdk';
import { DebugLogger } from './debug-logger';
import {
  DeviceLivestreamAudioDataEventPayload,
  DeviceLivestreamVideoDataEventPayload,
  EufyWebSocketClient,
} from '@scrypted/eufy-security-client';
import { CleanupLevel, MemoryInfo, MemoryManager, getMemoryManager } from './memory-manager';

/**
 * Advanced streaming settings for EufyStreamSession configuration.
 * These settings control buffer management and stream lifecycle behavior.
 */
export interface EufyStreamSessionSettings {
  /** Maximum number of video chunks to buffer before dropping (5-30) */
  maxPendingChunks: number;
  /** Stream timeout in seconds before automatic cleanup */
  streamTimeout: number;
}

/**
 * Configuration options for initializing a EufyStreamSession.
 * Provides all dependencies and callbacks needed for stream management.
 */
export interface EufyStreamSessionOptions {
  /** Unique device serial number for API calls */
  serialNumber: string;
  /** WebSocket client for device communication */
  wsClient: EufyWebSocketClient;
  /** Logger instance for debugging and monitoring */
  logger: DebugLogger;
  /** Advanced streaming settings for buffer and timeout management */
  settings: EufyStreamSessionSettings;
  /** Memory manager instance for coordinated cleanup (optional, will use singleton if not provided) */
  memoryManager?: MemoryManager;
  /** Memory threshold in MB for this session (default: 100) */
  memoryThresholdMB?: number;
}

/**
 * Manages a single video stream session for a Eufy camera device.
 *
 * This class encapsulates all streaming logic including:
 * - WebSocket-based device communication for stream control
 * - TCP server setup for local FFmpeg consumption
 * - H.264 NAL unit parsing and frame validation
 * - Intelligent buffer management with memory monitoring
 * - Stream lifecycle management and cleanup
 *
 * Stream Reuse Strategy:
 * - If a stream is already active, new consumers attach to the existing session
 * - TCP server accepts multiple client connections
 * - Each new client receives SPS/PPS/IDR frames first for proper initialization
 *
 * Memory Management:
 * - Configurable buffer limits with smart dropping algorithms
 * - Priority preservation for critical frames (SPS/PPS/IDR)
 * - Periodic memory monitoring with automatic cleanup
 */
export class EufyStreamSession {
  /**
   * Generate MP4 initialization segment with ftyp and moov atoms
   * This fixes the "moov atom not found" error by providing proper MP4 headers
   */
  private generateMP4InitializationSegment(sps?: Buffer, pps?: Buffer): Buffer {
    const boxes: Buffer[] = [];

    // Generate ftyp box (file type)
    const ftypBox = this.createFtypBox();
    boxes.push(ftypBox);

    // Generate moov box (movie header) if we have SPS/PPS
    if (sps && pps) {
      const moovBox = this.createMoovBox(sps, pps);
      boxes.push(moovBox);
    }

    return Buffer.concat(boxes);
  }

  /**
   * Create ftyp (file type) box for MP4
   */
  private createFtypBox(): Buffer {
    const majorBrand = Buffer.from('isom'); // 4 bytes
    const minorVersion = Buffer.alloc(4); // 4 bytes, all zeros
    const compatibleBrands = Buffer.from('isomiso2avc1mp41'); // 16 bytes

    const boxData = Buffer.concat([majorBrand, minorVersion, compatibleBrands]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + boxData.length, 0);
    const boxType = Buffer.from('ftyp');

    return Buffer.concat([boxSize, boxType, boxData]);
  }

  /**
   * Create moov (movie) box with minimal track information
   */
  private createMoovBox(sps: Buffer, pps: Buffer): Buffer {
    // This is a minimal moov box that tells FFmpeg this is a valid MP4
    // The actual video data will come as mdat boxes
    const mvhdBox = this.createMvhdBox();
    const videoTrakBox = this.createTrakBox(sps, pps);

    const boxes = [mvhdBox, videoTrakBox];

    // Add audio track if we have audio metadata
    if (this.audioMetadata) {
      const audioTrakBox = this.createAudioTrakBox();
      boxes.push(audioTrakBox);
      this.logger.d(
        `🎵 Added audio track to MP4 initialization segment: ${(this.audioMetadata as any)?.audioCodec}`
      );
    }

    const moovData = Buffer.concat(boxes);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + moovData.length, 0);
    const boxType = Buffer.from('moov');

    return Buffer.concat([boxSize, boxType, moovData]);
  }

  /**
   * Create mvhd (movie header) box
   */
  private createMvhdBox(): Buffer {
    const mvhdData = Buffer.alloc(100); // Minimal mvhd box
    mvhdData.writeUInt8(0, 0); // version
    mvhdData.writeUInt32BE(0, 4); // creation time
    mvhdData.writeUInt32BE(0, 8); // modification time
    mvhdData.writeUInt32BE(90000, 12); // timescale (90kHz for video)
    mvhdData.writeUInt32BE(0, 16); // duration (unknown)
    mvhdData.writeUInt32BE(0x00010000, 20); // rate (1.0)
    mvhdData.writeUInt16BE(0x0100, 24); // volume (1.0)
    // Set next track ID based on whether we have audio
    const nextTrackId = this.audioMetadata ? 3 : 2; // 3 if we have video + audio, 2 if video only
    mvhdData.writeUInt32BE(nextTrackId, 96); // next track ID

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + mvhdData.length, 0);
    const boxType = Buffer.from('mvhd');

    return Buffer.concat([boxSize, boxType, mvhdData]);
  }

  /**
   * Create trak (track) box for video
   */
  private createTrakBox(sps: Buffer, pps: Buffer): Buffer {
    // Minimal track box - just enough to satisfy FFmpeg
    const tkhdBox = this.createTkhdBox();
    const mdiaBox = this.createMdiaBox(sps, pps);

    const trakData = Buffer.concat([tkhdBox, mdiaBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + trakData.length, 0);
    const boxType = Buffer.from('trak');

    return Buffer.concat([boxSize, boxType, trakData]);
  }

  /**
   * Create tkhd (track header) box
   */
  private createTkhdBox(): Buffer {
    const tkhdData = Buffer.alloc(84);
    tkhdData.writeUInt8(0, 0); // version
    tkhdData.writeUInt32BE(0x000001, 0); // flags (track enabled)
    tkhdData.writeUInt32BE(1, 12); // track ID

    // Get video dimensions from VideoMetadata instead of hardcoded values
    const { width, height } = this.getValidatedVideoDimensions();
    tkhdData.writeUInt32BE(width << 16, 76); // width from VideoMetadata
    tkhdData.writeUInt32BE(height << 16, 80); // height from VideoMetadata

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + tkhdData.length, 0);
    const boxType = Buffer.from('tkhd');

    return Buffer.concat([boxSize, boxType, tkhdData]);
  }

  /**
   * Create mdia (media) box
   */
  private createMdiaBox(sps: Buffer, pps: Buffer): Buffer {
    const mdhdBox = this.createMdhdBox();
    const hdlrBox = this.createHdlrBox();
    const minfBox = this.createMinfBox(sps, pps);

    const mdiaData = Buffer.concat([mdhdBox, hdlrBox, minfBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + mdiaData.length, 0);
    const boxType = Buffer.from('mdia');

    return Buffer.concat([boxSize, boxType, mdiaData]);
  }

  /**
   * Create mdhd (media header) box
   */
  private createMdhdBox(): Buffer {
    const mdhdData = Buffer.alloc(24);
    mdhdData.writeUInt8(0, 0); // version
    mdhdData.writeUInt32BE(90000, 12); // timescale

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + mdhdData.length, 0);
    const boxType = Buffer.from('mdhd');

    return Buffer.concat([boxSize, boxType, mdhdData]);
  }

  /**
   * Create hdlr (handler) box
   */
  private createHdlrBox(): Buffer {
    const hdlrData = Buffer.concat([
      Buffer.alloc(8), // version + flags + pre_defined
      Buffer.from('vide'), // handler_type
      Buffer.alloc(12), // reserved
      Buffer.from('VideoHandler\0'), // name
    ]);

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + hdlrData.length, 0);
    const boxType = Buffer.from('hdlr');

    return Buffer.concat([boxSize, boxType, hdlrData]);
  }

  /**
   * Create minf (media information) box
   */
  private createMinfBox(sps: Buffer, pps: Buffer): Buffer {
    const vmhdBox = this.createVmhdBox();
    const dinfBox = this.createDinfBox();
    const stblBox = this.createStblBox(sps, pps);

    const minfData = Buffer.concat([vmhdBox, dinfBox, stblBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + minfData.length, 0);
    const boxType = Buffer.from('minf');

    return Buffer.concat([boxSize, boxType, minfData]);
  }

  /**
   * Create vmhd (video media header) box
   */
  private createVmhdBox(): Buffer {
    const vmhdData = Buffer.alloc(12);
    vmhdData.writeUInt32BE(0x000001, 0); // version + flags

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + vmhdData.length, 0);
    const boxType = Buffer.from('vmhd');

    return Buffer.concat([boxSize, boxType, vmhdData]);
  }

  /**
   * Create dinf (data information) box
   */
  private createDinfBox(): Buffer {
    const drefData = Buffer.alloc(16);
    drefData.writeUInt32BE(0, 0); // version + flags
    drefData.writeUInt32BE(1, 4); // entry count
    drefData.writeUInt32BE(12, 8); // url box size
    drefData.write('url ', 12); // url box type

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + drefData.length, 0);
    const boxType = Buffer.from('dinf');

    return Buffer.concat([boxSize, boxType, drefData]);
  }

  /**
   * Create stbl (sample table) box
   */
  private createStblBox(sps: Buffer, pps: Buffer): Buffer {
    const stsdBox = this.createStsdBox(sps, pps);
    const sttsBox = this.createSttsBox();
    const stscBox = this.createStscBox();
    const stszBox = this.createStszBox();
    const stcoBox = this.createStcoBox();

    const stblData = Buffer.concat([stsdBox, sttsBox, stscBox, stszBox, stcoBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stblData.length, 0);
    const boxType = Buffer.from('stbl');

    return Buffer.concat([boxSize, boxType, stblData]);
  }

  /**
   * Create stsd (sample description) box with avc1 entry
   */
  private createStsdBox(sps: Buffer, pps: Buffer): Buffer {
    const avc1Box = this.createAvc1Box(sps, pps);
    const stsdData = Buffer.concat([
      Buffer.alloc(8), // version + flags + entry count
      avc1Box,
    ]);
    stsdData.writeUInt32BE(1, 4); // entry count = 1

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stsdData.length, 0);
    const boxType = Buffer.from('stsd');

    return Buffer.concat([boxSize, boxType, stsdData]);
  }

  /**
   * Create avc1 (AVC video) sample entry
   */
  private createAvc1Box(sps: Buffer, pps: Buffer): Buffer {
    const avc1Data = Buffer.alloc(78);
    avc1Data.writeUInt16BE(1, 6); // data reference index

    // Get video dimensions from VideoMetadata instead of hardcoded values
    const { width, height } = this.getValidatedVideoDimensions();
    avc1Data.writeUInt16BE(width, 24); // width from VideoMetadata
    avc1Data.writeUInt16BE(height, 26); // height from VideoMetadata
    avc1Data.writeUInt32BE(0x00480000, 28); // horizontal resolution
    avc1Data.writeUInt32BE(0x00480000, 32); // vertical resolution
    avc1Data.writeUInt16BE(1, 38); // frame count
    avc1Data.writeUInt16BE(24, 74); // depth
    avc1Data.writeUInt16BE(0xffff, 76); // color table ID

    const avcCBox = this.createAvcCBox(sps, pps);
    const avc1BoxData = Buffer.concat([avc1Data, avcCBox]);

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + avc1BoxData.length, 0);
    const boxType = Buffer.from('avc1');

    return Buffer.concat([boxSize, boxType, avc1BoxData]);
  }

  /**
   * Create avcC (AVC configuration) box
   */
  private createAvcCBox(sps: Buffer, pps: Buffer): Buffer {
    const avcCData = Buffer.concat([
      Buffer.from([1]), // configuration version
      sps.slice(1, 4), // profile, profile compatibility, level
      Buffer.from([0xff]), // length size minus one (4 bytes)
      Buffer.from([0xe1]), // number of SPS (1)
      Buffer.alloc(2), // SPS length
      sps,
      Buffer.from([1]), // number of PPS (1)
      Buffer.alloc(2), // PPS length
      pps,
    ]);

    // Write SPS length
    avcCData.writeUInt16BE(sps.length, 6);
    // Write PPS length
    avcCData.writeUInt16BE(pps.length, 9 + sps.length);

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + avcCData.length, 0);
    const boxType = Buffer.from('avcC');

    return Buffer.concat([boxSize, boxType, avcCData]);
  }

  /**
   * Create empty stts (time-to-sample) box
   */
  private createSttsBox(): Buffer {
    const sttsData = Buffer.alloc(8);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + sttsData.length, 0);
    const boxType = Buffer.from('stts');
    return Buffer.concat([boxSize, boxType, sttsData]);
  }

  /**
   * Create empty stsc (sample-to-chunk) box
   */
  private createStscBox(): Buffer {
    const stscData = Buffer.alloc(8);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stscData.length, 0);
    const boxType = Buffer.from('stsc');
    return Buffer.concat([boxSize, boxType, stscData]);
  }

  /**
   * Create empty stsz (sample size) box
   */
  private createStszBox(): Buffer {
    const stszData = Buffer.alloc(12);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stszData.length, 0);
    const boxType = Buffer.from('stsz');
    return Buffer.concat([boxSize, boxType, stszData]);
  }

  /**
   * Create empty stco (chunk offset) box
   */
  private createStcoBox(): Buffer {
    const stcoData = Buffer.alloc(8);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stcoData.length, 0);
    const boxType = Buffer.from('stco');
    return Buffer.concat([boxSize, boxType, stcoData]);
  }

  /**
   * Create audio track box for MP4
   */
  private createAudioTrakBox(): Buffer {
    const tkhdBox = this.createAudioTkhdBox();
    const mdiaBox = this.createAudioMdiaBox();

    const trakData = Buffer.concat([tkhdBox, mdiaBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + trakData.length, 0);
    const boxType = Buffer.from('trak');

    return Buffer.concat([boxSize, boxType, trakData]);
  }

  /**
   * Create audio track header box
   */
  private createAudioTkhdBox(): Buffer {
    const tkhdData = Buffer.alloc(84);
    tkhdData.writeUInt8(0, 0); // version
    tkhdData.writeUInt32BE(0x000001, 0); // flags (track enabled)
    tkhdData.writeUInt32BE(2, 12); // track ID (2 for audio)
    tkhdData.writeUInt16BE(0x0100, 32); // volume (1.0)

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + tkhdData.length, 0);
    const boxType = Buffer.from('tkhd');

    return Buffer.concat([boxSize, boxType, tkhdData]);
  }

  /**
   * Create audio media box
   */
  private createAudioMdiaBox(): Buffer {
    const mdhdBox = this.createAudioMdhdBox();
    const hdlrBox = this.createAudioHdlrBox();
    const minfBox = this.createAudioMinfBox();

    const mdiaData = Buffer.concat([mdhdBox, hdlrBox, minfBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + mdiaData.length, 0);
    const boxType = Buffer.from('mdia');

    return Buffer.concat([boxSize, boxType, mdiaData]);
  }

  /**
   * Create audio media header box
   */
  private createAudioMdhdBox(): Buffer {
    const mdhdData = Buffer.alloc(24);
    mdhdData.writeUInt8(0, 0); // version
    // Use appropriate timescale for audio (typically 48000 for AAC)
    const timescale = (this.audioMetadata as any)?.sampleRate || 48000;
    mdhdData.writeUInt32BE(timescale, 12); // timescale

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + mdhdData.length, 0);
    const boxType = Buffer.from('mdhd');

    return Buffer.concat([boxSize, boxType, mdhdData]);
  }

  /**
   * Create audio handler box
   */
  private createAudioHdlrBox(): Buffer {
    const hdlrData = Buffer.concat([
      Buffer.alloc(8), // version + flags + pre_defined
      Buffer.from('soun'), // handler_type for audio
      Buffer.alloc(12), // reserved
      Buffer.from('AudioHandler\\0'), // name
    ]);

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + hdlrData.length, 0);
    const boxType = Buffer.from('hdlr');

    return Buffer.concat([boxSize, boxType, hdlrData]);
  }

  /**
   * Create audio media information box
   */
  private createAudioMinfBox(): Buffer {
    const smhdBox = this.createSmhdBox();
    const dinfBox = this.createDinfBox(); // Reuse existing dinf box
    const stblBox = this.createAudioStblBox();

    const minfData = Buffer.concat([smhdBox, dinfBox, stblBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + minfData.length, 0);
    const boxType = Buffer.from('minf');

    return Buffer.concat([boxSize, boxType, minfData]);
  }

  /**
   * Create sound media header box
   */
  private createSmhdBox(): Buffer {
    const smhdData = Buffer.alloc(8);
    smhdData.writeUInt32BE(0, 0); // version + flags

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + smhdData.length, 0);
    const boxType = Buffer.from('smhd');

    return Buffer.concat([boxSize, boxType, smhdData]);
  }

  /**
   * Create audio sample table box
   */
  private createAudioStblBox(): Buffer {
    const stsdBox = this.createAudioStsdBox();
    const sttsBox = this.createSttsBox(); // Reuse existing empty boxes
    const stscBox = this.createStscBox();
    const stszBox = this.createStszBox();
    const stcoBox = this.createStcoBox();

    const stblData = Buffer.concat([stsdBox, sttsBox, stscBox, stszBox, stcoBox]);
    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stblData.length, 0);
    const boxType = Buffer.from('stbl');

    return Buffer.concat([boxSize, boxType, stblData]);
  }

  /**
   * Create audio sample description box
   */
  private createAudioStsdBox(): Buffer {
    const audioSampleEntry = this.createAudioSampleEntry();
    const stsdData = Buffer.concat([
      Buffer.alloc(8), // version + flags + entry count
      audioSampleEntry,
    ]);
    stsdData.writeUInt32BE(1, 4); // entry count = 1

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + stsdData.length, 0);
    const boxType = Buffer.from('stsd');

    return Buffer.concat([boxSize, boxType, stsdData]);
  }

  /**
   * Create audio sample entry (mp4a for AAC)
   */
  private createAudioSampleEntry(): Buffer {
    const audioData = Buffer.alloc(28);
    audioData.writeUInt16BE(1, 6); // data reference index
    audioData.writeUInt16BE(2, 16); // channel count
    audioData.writeUInt16BE(16, 18); // sample size (16-bit)
    audioData.writeUInt32BE(((this.audioMetadata as any)?.sampleRate || 48000) << 16, 24); // sample rate

    // Create esds box for AAC configuration
    const esdsBox = this.createEsdsBox();
    const audioBoxData = Buffer.concat([audioData, esdsBox]);

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + audioBoxData.length, 0);
    const boxType = Buffer.from('mp4a');

    return Buffer.concat([boxSize, boxType, audioBoxData]);
  }

  /**
   * Create elementary stream descriptor box for AAC
   */
  private createEsdsBox(): Buffer {
    // Minimal ESDS box for AAC-LC
    const esdsData = Buffer.concat([
      Buffer.from([0, 0, 0, 0]), // version + flags
      Buffer.from([0x03, 0x19]), // ES_DescrTag + length
      Buffer.from([0x00, 0x01]), // ES_ID
      Buffer.from([0x00]), // flags
      Buffer.from([0x04, 0x11]), // DecoderConfigDescrTag + length
      Buffer.from([0x40]), // objectTypeIndication (AAC)
      Buffer.from([0x15]), // streamType + upstream + reserved
      Buffer.alloc(3), // bufferSizeDB
      Buffer.alloc(4), // maxBitrate
      Buffer.alloc(4), // avgBitrate
      Buffer.from([0x05, 0x02]), // DecSpecificInfoTag + length
      Buffer.from([0x12, 0x10]), // AAC-LC, 48kHz, stereo
      Buffer.from([0x06, 0x01, 0x02]), // SLConfigDescrTag
    ]);

    const boxSize = Buffer.alloc(4);
    boxSize.writeUInt32BE(8 + esdsData.length, 0);
    const boxType = Buffer.from('esds');

    return Buffer.concat([boxSize, boxType, esdsData]);
  }

  // Core dependencies
  private readonly serialNumber: string;
  private readonly wsClient: EufyWebSocketClient;
  private readonly logger: DebugLogger;
  private readonly settings: EufyStreamSessionSettings;

  // Stream state tracking
  private bufferCount = 0;
  private activeStreamTimeout?: ReturnType<typeof setTimeout>;
  private isStoppingStream = false; // Prevent multiple stop operations
  private pendingStopTimeout?: ReturnType<typeof setTimeout>; // Track delayed stop operations

  // Buffer management with performance optimizations
  private readonly maxPendingChunks: number;
  private readonly memoryManager: MemoryManager;
  private readonly memoryCallbackId: string;
  private pendingVideoChunks: Buffer[] = []; // Circular buffer for efficient memory usage

  // TCP server for FFmpeg
  private tcpServer?: net.Server;
  private tcpSocket?: net.Socket;
  private serverPort?: number;

  // Stream initialization state
  private hasInitialData: boolean = false;
  private hasInitialAudioData: boolean = false;
  private currentTcpWriter?: (chunk: Buffer) => void;

  // H.264 parsing state
  private h264Buffer: Buffer = Buffer.alloc(0);
  private waitingForKeyFrame: boolean = true;

  // Audio processing state
  private audioBuffer: Buffer = Buffer.alloc(0);
  private pendingAudioChunks: Buffer[] = [];
  private audioMetadata?: any;
  private videoMetadata?: { videoWidth: number; videoHeight: number; videoFPS?: number };

  /**
   * Checks if the device is currently streaming via the WebSocket API.
   * This is the authoritative source for stream status.
   *
   * @returns Promise<boolean> True if device is actively streaming
   */
  async isStreaming(): Promise<boolean> {
    try {
      const result = await this.wsClient.commands.device(this.serialNumber).isLivestreaming();
      return result.livestreaming;
    } catch (error) {
      this.logger.w(`Failed to check streaming status: ${error}`);
      return false;
    }
  }

  /**
   * Initializes the stream session with configuration from provided settings.
   * Sets up buffer limits and validates device availability.
   */
  constructor(options: EufyStreamSessionOptions) {
    this.serialNumber = options.serialNumber;
    this.wsClient = options.wsClient;
    this.logger = options.logger;
    this.settings = options.settings;

    // Configure buffer management with hardcoded default value
    this.maxPendingChunks = 15;

    // Set up memory management
    this.memoryManager =
      options.memoryManager ||
      getMemoryManager(this.logger, {
        baseThresholdMB: options.memoryThresholdMB || 120,
        enableDetailedLogging: false,
      });

    // Force update the threshold in case the singleton was created with old config
    this.memoryManager.updateThreshold(options.memoryThresholdMB || 120);

    this.memoryCallbackId = `stream-${this.serialNumber}`;

    // Register memory cleanup callback
    this.memoryManager.registerCleanupCallback(
      this.memoryCallbackId,
      this.handleMemoryCleanup.bind(this),
      `Stream session for ${this.serialNumber}`
    );

    // Log configuration
    this.logger.d(
      `Stream session initialized for ${this.serialNumber}, maxPendingChunks: ${this.maxPendingChunks}, streamTimeout: 30s, memory management enabled`
    );
  }

  /**
   * Starts a video stream session and returns a MediaObject for Scrypted consumption.
   *
   * Smart Stream Reuse Logic:
   * - If device is already streaming AND TCP server is active, reuse existing session
   * - New consumers attach to the existing stream without disrupting other clients
   * - Otherwise, initialize a new stream session with full setup
   *
   * @param options Optional streaming parameters for configuring the MediaObject
   * @returns Promise<MediaObject> FFmpeg-compatible media object for video consumption
   * @throws Error if stream initialization fails
   */
  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    this.logger.i(`🎬 Starting video stream for device ${this.serialNumber}`);

    // Strategy 1: Reuse existing active stream if available
    if ((await this.isStreaming()) && this.tcpServer && this.serverPort) {
      this.logger.i('🔄 Reusing existing P2P stream session for new consumer');
      return this.createMediaObjectFromTcpServer(options);
    }

    // Strategy 1.5: Check if we have a recent stream that just lost its client
    if (this.tcpServer && this.serverPort && this.hasInitialData) {
      this.logger.i('🔄 Reusing existing TCP server for new consumer (stream may still be active)');
      return this.createMediaObjectFromTcpServer(options);
    }

    // Strategy 2: Initialize new stream session
    this.logger.i('🚀 Starting new stream session');
    try {
      this.cleanupStream(); // Ensure clean state
      this.bufferCount = 0; // Reset buffer counter
      this.pendingVideoChunks = []; // Clear video buffer

      await this.startWebSocketStream(); // Start device streaming
      // Memory monitoring is now handled by the MemoryManager singleton

      // Create TCP server and return MediaObject
      const mediaObject = await this.createTcpServerMediaObject(options);
      if (!mediaObject) {
        throw new Error('Failed to create MediaObject with TCP server');
      }

      this.logger.i('✅ Stream session started successfully');
      return mediaObject;
    } catch (error) {
      this.logger.e(`❌ Failed to start video stream: ${error}`);
      this.stopStream('startup failure'); // Cleanup on failure
      throw error;
    }
  }

  /**
   * Validates video metadata from the stream event
   * Ensures dimensions are provided and within reasonable bounds
   *
   * @param metadata Video metadata from the stream event
   * @returns Validation result with success status and error message if invalid
   */
  private validateVideoMetadata(metadata: any): { isValid: boolean; error?: string } {
    // Check if metadata has required video dimensions
    if (!metadata.videoWidth || !metadata.videoHeight) {
      return {
        isValid: false,
        error: 'Video metadata missing width or height dimensions',
      };
    }

    // Validate dimensions are positive numbers
    if (metadata.videoWidth <= 0 || metadata.videoHeight <= 0) {
      return {
        isValid: false,
        error: `Invalid video dimensions: ${metadata.videoWidth}x${metadata.videoHeight}. Dimensions must be positive numbers`,
      };
    }

    // Validate dimensions are within reasonable bounds
    if (metadata.videoWidth > 4096 || metadata.videoHeight > 2160) {
      this.logger.w(
        `⚠️ Video dimensions exceed typical camera resolution (4K): ${metadata.videoWidth}x${metadata.videoHeight}`
      );
    }

    if (metadata.videoWidth < 320 || metadata.videoHeight < 240) {
      this.logger.w(
        `⚠️ Video dimensions are very small: ${metadata.videoWidth}x${metadata.videoHeight}. This may indicate invalid metadata`
      );
    }

    // Validate frame rate if provided
    if (metadata.videoFPS !== undefined) {
      if (metadata.videoFPS <= 0 || metadata.videoFPS > 120) {
        return {
          isValid: false,
          error: `Invalid video frame rate: ${metadata.videoFPS}. Frame rate must be between 1 and 120 fps`,
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Get validated video dimensions from VideoMetadata
   * Ensures dimensions are provided from VideoMetadata instead of using hardcoded fallbacks
   *
   * @returns Video dimensions from VideoMetadata
   * @throws Error if VideoMetadata is not available or invalid
   */
  private getValidatedVideoDimensions(): { width: number; height: number } {
    if (!this.videoMetadata) {
      throw new Error(
        'Video dimensions must be provided from VideoMetadata. ' +
          'Hardcoded fallback values (1920x1080) are no longer supported. ' +
          'Ensure VideoMetadata with videoWidth and videoHeight is available before processing.'
      );
    }

    if (this.videoMetadata.videoWidth <= 0 || this.videoMetadata.videoHeight <= 0) {
      throw new Error(
        `Invalid video dimensions: ${this.videoMetadata.videoWidth}x${this.videoMetadata.videoHeight}. ` +
          'Dimensions must be positive numbers from valid VideoMetadata.'
      );
    }

    return {
      width: this.videoMetadata.videoWidth,
      height: this.videoMetadata.videoHeight,
    };
  }

  /**
   * Get current video metadata if available
   *
   * @returns Video metadata with dimensions and frame rate, or undefined if not yet available
   */
  getVideoMetadata(): { videoWidth: number; videoHeight: number; videoFPS?: number } | undefined {
    return this.videoMetadata;
  }

  /**
   * Handles incoming video data events from the Eufy device via WebSocket.
   *
   * Processing Pipeline:
   * 1. Validates incoming buffer data
   * 2. Concatenates data to H.264 buffer for NAL unit assembly
   * 3. Parses complete NAL units from the buffer
   * 4. Processes each NAL unit (validation, buffering, TCP streaming)
   * 5. Resets stream timeout to keep session alive
   *
   * @param event Video data payload from device livestream
   */
  handleVideoData(event: DeviceLivestreamVideoDataEventPayload): void {
    try {
      // Validate incoming data
      if (!event.buffer) {
        this.logger.w('📹 Received video data event but no buffer data');
        return;
      }

      // Store and validate video metadata from the event
      if (event.metadata && !this.videoMetadata) {
        const validationResult = this.validateVideoMetadata(event.metadata);
        if (validationResult.isValid) {
          this.videoMetadata = {
            videoWidth: event.metadata.videoWidth,
            videoHeight: event.metadata.videoHeight,
            videoFPS: event.metadata.videoFPS,
          };
          this.logger.d(
            `📹 Video metadata: ${this.videoMetadata.videoWidth}x${this.videoMetadata.videoHeight}@${this.videoMetadata.videoFPS}fps`
          );
        } else {
          this.logger.e(`❌ Invalid video metadata: ${validationResult.error}`);
          return;
        }
      }

      // Mark stream as having initial data on first video data
      if (!this.hasInitialData) {
        this.logger.i(
          `📹 First video data received for ${this.serialNumber} - stream is now active`
        );
        this.hasInitialData = true;
      }

      // Convert and append to H.264 assembly buffer
      const videoChunk = Buffer.from(event.buffer.data);
      this.h264Buffer = Buffer.concat([this.h264Buffer, videoChunk]);

      // Parse complete NAL units from assembled buffer
      const nalUnits = this.parseH264NALUnits(this.h264Buffer);
      if (nalUnits.units.length > 0) {
        this.h264Buffer = nalUnits.remainingData; // Keep incomplete data for next iteration

        // Process each complete NAL unit
        for (const nalUnit of nalUnits.units) {
          this.processNALUnit(nalUnit);
        }
      }

      // Reset stream timeout on successful data processing
      if (this.activeStreamTimeout) {
        clearTimeout(this.activeStreamTimeout);
        this.activeStreamTimeout = setTimeout(() => {
          this.logger.i('🕒 Stream timeout reached, stopping stream');
          this.stopStream('video data timeout');
        }, 30 * 1000);
      }
    } catch (error) {
      this.logger.e(`❌ Error handling video data: ${error}`);
    }
  }

  /**
   * Handles incoming audio data events from the Eufy device via WebSocket.
   *
   * Audio Processing Pipeline:
   * 1. Validates incoming audio buffer data
   * 2. Stores audio metadata for stream configuration
   * 3. Processes audio frames and buffers them for streaming
   * 4. Streams audio to connected TCP clients when available
   * 5. Manages audio buffer size to prevent memory issues
   *
   * @param event Audio data payload from device livestream
   */
  handleAudioData(event: DeviceLivestreamAudioDataEventPayload): void {
    try {
      // Validate incoming data
      if (!event.buffer) {
        this.logger.w('🎵 Received audio data event but no buffer data');
        return;
      }

      // Store audio metadata for stream configuration
      if (event.metadata && !this.audioMetadata) {
        this.audioMetadata = event.metadata;
        this.logger.d(`🎵 Audio metadata: codec=${event.metadata.audioCodec}`);
      }

      // Convert audio chunk to Buffer
      const audioChunk = Buffer.from(event.buffer.data);
      this.logger.d(`🎵 Received audio chunk: ${audioChunk.length} bytes`);

      // Buffer audio data for new client initialization
      this.bufferAndStreamAudioData(audioChunk);

      // Mark that we have initial audio data
      if (!this.hasInitialAudioData) {
        this.hasInitialAudioData = true;
        this.logger.d('✅ Initial audio data received');
      }

      // Reset stream timeout on successful audio data processing
      if (this.activeStreamTimeout) {
        clearTimeout(this.activeStreamTimeout);
        this.activeStreamTimeout = setTimeout(() => {
          this.logger.i('🕒 Stream timeout reached, stopping stream');
          this.stopStream('audio data timeout');
        }, 30 * 1000);
      }
    } catch (error) {
      this.logger.e(`❌ Error handling audio data: ${error}`);
    }
  }

  /**
   * Stops the current video stream and cleans up all resources.
   *
   * Cleanup Process:
   * 1. Check if stream is actually running (avoid unnecessary API calls)
   * 2. Send stop command to device via WebSocket API
   * 3. Clean up all local resources (sockets, servers, timers)
   * 4. Log completion status
   *
   * @param reason Optional reason for stopping the stream (for debugging)
   * @returns Promise<void> Resolves when cleanup is complete
   */
  async stopStream(reason?: string): Promise<void> {
    // Prevent multiple simultaneous stop operations
    if (this.isStoppingStream) {
      this.logger.d('🛑 Stream stop already in progress, skipping');
      return;
    }

    this.isStoppingStream = true;

    try {
      const stopReason = reason ? ` (reason: ${reason})` : '';
      this.logger.i(`🛑 Stopping video stream${stopReason}`);

      // Check if device is streaming before attempting to stop
      let deviceIsStreaming = false;
      try {
        deviceIsStreaming = await this.isStreaming();
      } catch (error) {
        this.logger.w(`⚠️ Failed to check streaming status, assuming stopped: ${error}`);
        deviceIsStreaming = false;
      }

      // Send stop command to device only if it's actually streaming
      if (deviceIsStreaming && this.serialNumber) {
        try {
          const device = this.wsClient.commands.device(this.serialNumber);
          await device.stopLivestream();
          this.logger.d('📻 WebSocket stream stop command sent successfully');
        } catch (error: unknown) {
          // Handle specific error cases more gracefully
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('device_livestream_not_running')) {
            this.logger.d('📻 WebSocket stream already stopped');
          } else if (errorMessage.includes('timeout')) {
            this.logger.w(`⏱️ Timeout stopping WebSocket stream: ${errorMessage}`);
          } else if (errorMessage.includes('connection')) {
            this.logger.w(`🔌 Connection error stopping WebSocket stream: ${errorMessage}`);
          } else {
            this.logger.w(`⚠️ Failed to stop WebSocket stream: ${errorMessage}`);
          }
        }
      } else {
        this.logger.d('🛑 Device not streaming or no serial number, skipping stop command');
      }

      // Always perform local cleanup
      this.cleanupStream();

      // Unregister from memory manager (safe to call multiple times)
      try {
        this.memoryManager.unregisterCleanupCallback(this.memoryCallbackId);
      } catch (error) {
        this.logger.w(`⚠️ Error unregistering memory callback: ${error}`);
      }

      this.logger.i('✅ Stream stopped successfully');
    } catch (error) {
      this.logger.e(`❌ Unexpected error stopping stream: ${error}`);
      // Force cleanup even on unexpected error
      try {
        this.cleanupStream();
      } catch (cleanupError) {
        this.logger.e(`❌ Error during force cleanup: ${cleanupError}`);
      }
    } finally {
      this.isStoppingStream = false;
    }
  }

  /**
   * Cleans up all stream-related state and resources.
   *
   * Comprehensive cleanup ensures no resource leaks:
   * - Clears all video and audio buffers and counters
   * - Resets H.264 parsing state
   * - Destroys TCP sockets and servers
   * - Cancels all timers and intervals
   * - Resets stream initialization flags
   *
   * This method is safe to call multiple times.
   */
  private cleanupStream(): void {
    this.logger.d('🧹 Cleaning up stream resources');

    try {
      // Clear video buffers and counters
      this.pendingVideoChunks = [];
      this.bufferCount = 0;

      // Clear audio buffers and state
      this.pendingAudioChunks = [];
      this.audioBuffer = Buffer.alloc(0);
      this.audioMetadata = undefined;
      this.videoMetadata = undefined;

      // Reset H.264 parsing state
      this.h264Buffer = Buffer.alloc(0);
      this.waitingForKeyFrame = true;

      // Clear TCP connection state
      this.currentTcpWriter = undefined;
      this.hasInitialData = false;
      this.hasInitialAudioData = false;
    } catch (error) {
      this.logger.w(`⚠️ Error clearing buffers during cleanup: ${error}`);
    }

    // Destroy TCP socket safely
    try {
      if (this.tcpSocket) {
        this.tcpSocket.destroy();
        this.tcpSocket = undefined;
        this.logger.d('🔌 TCP socket destroyed');
      }
    } catch (error) {
      this.logger.w(`⚠️ Error destroying TCP socket: ${error}`);
      this.tcpSocket = undefined; // Clear reference anyway
    }

    // Close TCP server safely
    try {
      if (this.tcpServer) {
        this.tcpServer.close();
        this.tcpServer = undefined;
        this.serverPort = undefined;
        this.logger.d('🏢 TCP server closed');
      }
    } catch (error) {
      this.logger.w(`⚠️ Error closing TCP server: ${error}`);
      this.tcpServer = undefined; // Clear reference anyway
      this.serverPort = undefined;
    }

    // Cancel timeout timer safely
    try {
      if (this.activeStreamTimeout) {
        clearTimeout(this.activeStreamTimeout);
        this.activeStreamTimeout = undefined;
        this.logger.d('⏰ Stream timeout timer cleared');
      }
    } catch (error) {
      this.logger.w(`⚠️ Error clearing timeout timer: ${error}`);
      this.activeStreamTimeout = undefined; // Clear reference anyway
    }

    // Cancel pending stop timeout safely
    try {
      if (this.pendingStopTimeout) {
        clearTimeout(this.pendingStopTimeout);
        this.pendingStopTimeout = undefined;
        this.logger.d('⏰ Pending stop timeout cleared');
      }
    } catch (error) {
      this.logger.w(`⚠️ Error clearing pending stop timeout: ${error}`);
      this.pendingStopTimeout = undefined; // Clear reference anyway
    }

    this.logger.d('✅ Stream cleanup completed');
  }

  /**
   * Starts the WebSocket livestream for the device.
   *
   * Stream Initialization Process:
   * 1. Validates device serial number availability
   * 2. Sends start command to device via WebSocket API
   * 3. Immediately requests keyframe for faster stream initialization
   * 4. Sets up auto-timeout to prevent orphaned streams
   * 5. Gracefully handles start failures (device may already be streaming)
   *
   * @throws Error if device serial number is not available
   */
  private async startWebSocketStream(): Promise<void> {
    if (!this.serialNumber) {
      throw new Error('Device serial number not available for stream start');
    }

    this.logger.i(`📡 Starting WebSocket livestream for device ${this.serialNumber}`);

    // Check current streaming status before attempting to start
    try {
      const isCurrentlyStreaming = await this.isStreaming();
      if (isCurrentlyStreaming) {
        this.logger.d('📊 Device already streaming');
      }
    } catch (error) {
      this.logger.w(`⚠️ Could not check streaming status before start: ${error}`);
    }

    const device = this.wsClient.commands.device(this.serialNumber);

    try {
      this.logger.d('🎯 Sending device.startLivestream() command...');
      await device.startLivestream();
      this.logger.i('✅ WebSocket livestream start command sent successfully');

      // Verification checks
      setTimeout(async () => {
        try {
          const streamingAfterStart = await this.isStreaming();
          if (!streamingAfterStart) {
            this.logger.w(
              '⚠️ Device reports not streaming even after start command - potential issue'
            );
          }
        } catch (error) {
          this.logger.w(`⚠️ Could not verify streaming status after start: ${error}`);
        }
      }, 1000); // Check after 1 second
    } catch (error) {
      // Note: Start failures are often benign (device already streaming)
      this.logger.w(`⚠️ Livestream start warning (may be already active): ${error}`);

      // Log the error details for debugging
      if (error instanceof Error) {
        this.logger.d(`🔍 Start error details: name=${error.name}, message=${error.message}`);
        if (error.stack) {
          this.logger.d(`🔍 Start error stack: ${error.stack.substring(0, 200)}...`);
        }
      }
    }

    // Set up auto-timeout to prevent orphaned streams
    this.activeStreamTimeout = setTimeout(() => {
      this.logger.i('🕒 Stream auto-timeout reached, stopping stream');
      this.stopStream('startup auto-timeout');
    }, 30 * 1000);

    this.logger.d(`⏰ Stream timeout set to 30 seconds`);
  }

  /**
   * Creates a TCP server and returns a MediaObject for Scrypted to consume.
   *
   * TCP Server Strategy:
   * 1. Wait for initial video data to ensure stream is active
   * 2. Create TCP server on localhost with random port
   * 3. Handle client connections with proper H.264 initialization
   * 4. Return FFmpeg-compatible MediaObject pointing to TCP endpoint
   *
   * Each client connection receives:
   * - SPS/PPS/IDR frames first for proper decoder initialization
   * - Ongoing NAL units as they arrive
   * - Keepalive packets if no data is available
   *
   * @param options Optional streaming parameters for configuring the MediaObject
   * @returns Promise<MediaObject> FFmpeg MediaObject for video consumption
   * @throws Error if TCP server setup fails or times out
   */
  private async createTcpServerMediaObject(
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    // Wait for initial video data before creating server
    await this.waitForInitialVideoData();

    return new Promise((resolve, reject) => {
      // Create TCP server for FFmpeg connections
      this.tcpServer = net.createServer(this.handleTcpClientConnection.bind(this));

      // Set up server timeout
      const serverTimeout = setTimeout(() => {
        this.logger.w('⏰ Timeout waiting for FFmpeg connection to TCP server');
        this.tcpServer?.close();
        reject(new Error('Timeout waiting for FFmpeg connection'));
      }, 15000);

      // Start listening on random port
      this.tcpServer.listen(0, '127.0.0.1', () => {
        const address = this.tcpServer!.address() as net.AddressInfo;
        this.serverPort = address.port;
        clearTimeout(serverTimeout);

        this.logger.i(`🌐 TCP server listening on port ${this.serverPort}`);

        // Create and return MediaObject
        this.createMediaObjectFromTcpServer(options)
          .then(resolve)
          .catch(error => {
            this.logger.e(`❌ Failed to create FFmpeg MediaObject: ${error}`);
            this.tcpServer?.close();
            reject(error);
          });
      });

      // Handle server errors
      this.tcpServer.on('error', error => {
        this.logger.e(`❌ TCP server error: ${error}`);
        clearTimeout(serverTimeout);
        reject(error);
      });
    });
  }

  /**
   * Waits for initial video data to arrive before proceeding with server setup.
   * Optimized for HomeKit Secure Video when enabled in settings.
   * This ensures the stream is active and has data ready for immediate consumption.
   */
  private async waitForInitialVideoData(): Promise<void> {
    const dataWaitStart = Date.now();
    const maxWaitTime = 5000;
    const checkInterval = 100;
    let checkCount = 0;

    this.logger.i(
      `⏳ Waiting for initial video data for ${this.serialNumber} - max wait ${maxWaitTime / 1000}s`
    );

    while (!this.hasInitialData && Date.now() - dataWaitStart < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      checkCount++;

      if (this.pendingVideoChunks.length > 0) {
        // Accept any data
        this.hasInitialData = true;
        this.logger.i(
          `✅ Initial video data received for ${this.serialNumber} (${this.pendingVideoChunks.length} chunks) after ${checkCount} checks`
        );
        break;
      }

      // Log progress periodically to help diagnose timeouts
      if (checkCount % 10 === 0) {
        this.logger.d(
          `⏳ Still waiting for video data for ${
            this.serialNumber
          }... (${Math.round((Date.now() - dataWaitStart) / 1000)}s elapsed, ${
            this.pendingVideoChunks.length
          } chunks so far)`
        );
      }
    }

    if (!this.hasInitialData) {
      this.logger.w(
        `⚠️ No initial video data received for ${
          this.serialNumber
        } within timeout (${checkCount} checks over ${Math.round(
          (Date.now() - dataWaitStart) / 1000
        )}s) - this may cause the stream to stop immediately`
      );

      // Additional diagnostic information
      this.logger.d(
        `🔍 Diagnostic info: streamTimeout=30s, maxWaitTime=${maxWaitTime}ms, checkInterval=${checkInterval}ms`
      );
      this.logger.d(
        `🔍 Buffer state: h264Buffer=${this.h264Buffer.length} bytes, pendingVideoChunks=${this.pendingVideoChunks.length}, pendingAudioChunks=${this.pendingAudioChunks.length}`
      );

      // Check device streaming status at this point
      try {
        const stillStreaming = await this.isStreaming();
        this.logger.d(
          `🔍 Device streaming status during timeout: ${
            stillStreaming ? 'still streaming' : 'not streaming'
          }`
        );
      } catch (error) {
        this.logger.d(`🔍 Could not check device streaming status during timeout: ${error}`);
      }
    }

    // Audio check
    if (this.hasInitialData && !this.hasInitialAudioData) {
      this.logger.d('⏳ Quick check for audio data...');
      const audioWaitStart = Date.now();
      const audioMaxWaitTime = 1000;

      while (!this.hasInitialAudioData && Date.now() - audioWaitStart < audioMaxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 25));
        if (this.pendingAudioChunks.length > 0) {
          this.hasInitialAudioData = true;
          this.logger.d(`✅ Audio data also available`);
          break;
        }
      }

      if (!this.hasInitialAudioData) {
        this.logger.d(`ℹ️ No audio data detected (video-only stream)`);
      }
    }
  }

  /**
   * Handles new TCP client connections for FFmpeg consumers.
   * Sets up proper H.264 stream initialization and ongoing data streaming.
   */
  private handleTcpClientConnection(clientSocket: net.Socket): void {
    this.logger.i('🔌 New TCP client connected');

    // If we already have a client, close the old one first
    if (this.tcpSocket && !this.tcpSocket.destroyed) {
      this.logger.d('🔄 Replacing existing TCP client with new connection');
      this.tcpSocket.destroy();
    }

    this.tcpSocket = clientSocket;

    // Clear any pending stop timeout since we have a new client
    if (this.pendingStopTimeout) {
      clearTimeout(this.pendingStopTimeout);
      this.pendingStopTimeout = undefined;
      this.logger.d('🔄 Cleared pending stop timeout due to new client connection');
    }

    // Remove server timeout since client connected
    if (this.tcpServer) {
      this.tcpServer.removeAllListeners('timeout');
    }

    // Set up client socket event handlers
    this.setupTcpClientHandlers(clientSocket);

    // Configure socket for low-latency streaming
    clientSocket.setNoDelay(true);
    clientSocket.setKeepAlive(true, 1000);

    // Create writer function for streaming data to client
    const writeToClient = this.createTcpWriter(clientSocket);
    this.currentTcpWriter = writeToClient;

    // If we have buffered data, immediately initialize the client
    if (this.pendingVideoChunks.length > 0) {
      this.logger.d('📋 Initializing new client with existing buffered data');
      this.initializeClientWithH264Frames(writeToClient);
    } else {
      this.logger.d('📋 No buffered data yet, client will receive data as it arrives');
    }

    // Set up keepalive mechanism
    this.setupClientKeepalive(clientSocket, writeToClient);
  }

  /**
   * Sets up event handlers for TCP client socket.
   */
  private setupTcpClientHandlers(clientSocket: net.Socket): void {
    clientSocket.on('close', hadError => {
      this.logger.i(`🔌 TCP client disconnected ${hadError ? 'with error' : 'normally'}`);

      this.tcpSocket = undefined;

      // Clear any TCP writer reference since client is gone
      this.currentTcpWriter = undefined;

      // Only attempt to stop stream if not already stopping
      if (!this.isStoppingStream) {
        // Add delay before stopping stream to allow new viewers to connect
        // This prevents premature stream shutdown when switching between viewers
        this.logger.d('🛑 TCP client disconnect - delaying stream stop to allow new connections');

        // Clear any existing pending stop
        if (this.pendingStopTimeout) {
          clearTimeout(this.pendingStopTimeout);
          this.pendingStopTimeout = undefined;
          this.logger.d('🔄 Cleared previous pending stop timeout');
        }

        this.pendingStopTimeout = setTimeout(async () => {
          this.pendingStopTimeout = undefined;
          // Check if a new client has connected during the delay
          if (!this.tcpSocket && !this.isStoppingStream) {
            this.logger.d('🛑 No new TCP client connected, stopping stream');
            this.stopStream('TCP client disconnect').catch(error => {
              this.logger.w(`⚠️ Error during TCP disconnect stream stop: ${error}`);
            });
          } else {
            this.logger.d('✅ New TCP client connected during delay, keeping stream alive');
          }
        }, 2000); // 2 second delay to allow new connections
      } else {
        this.logger.d('🔄 TCP client disconnect during active stream stop - skipping');
      }
    });

    clientSocket.on('error', error => {
      this.logger.w(`⚠️ TCP client error: ${error.message}`);

      this.tcpSocket = undefined;

      // Only attempt to stop stream if not already stopping
      if (!this.isStoppingStream) {
        this.logger.d('🛑 TCP client error triggered stream stop');
        this.stopStream('TCP client error').catch(error => {
          this.logger.w(`⚠️ Error during TCP error stream stop: ${error}`);
        });
      } else {
        this.logger.d('🔄 TCP client error during active stream stop - skipping');
      }
    });

    // Add a connect handler to log when client actually connects
    clientSocket.on('connect', () => {
      this.logger.d(
        `🔗 TCP client connected from ${clientSocket.remoteAddress}:${clientSocket.remotePort}`
      );
    });

    // Add a data handler to track if client is actually reading data
    clientSocket.on('data', data => {
      this.logger.d(
        `📥 TCP client sent ${data.length} bytes (unusual - clients shouldn't send data)`
      );
    });
  }

  /**
   * Creates a safe writer function for TCP client communication.
   */
  private createTcpWriter(clientSocket: net.Socket): (chunk: Buffer) => boolean {
    return (chunk: Buffer): boolean => {
      if (clientSocket.destroyed || clientSocket.writableEnded) {
        this.logger.d(
          `📤 Cannot write to TCP client: socket destroyed=${clientSocket.destroyed}, ended=${clientSocket.writableEnded}`
        );
        return false;
      }

      try {
        const success = clientSocket.write(chunk);

        if (!success) {
          // Handle backpressure
          clientSocket.once('drain', () => {
            this.logger.d('📤 TCP drain event - backpressure resolved');
          });
        }
        return success;
      } catch (error) {
        this.logger.w(
          `⚠️ Error writing to TCP client: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return false;
      }
    };
  }

  /**
   * Initializes new TCP client with essential H.264 frames (SPS, PPS, IDR).
   * This ensures FFmpeg can immediately start decoding the stream.
   */
  private initializeClientWithH264Frames(writeToClient: (chunk: Buffer) => boolean): void {
    // Generate and send MP4 initialization segment first
    const sps = this.findNALUnit(this.pendingVideoChunks, 0x67); // SPS
    const pps = this.findNALUnit(this.pendingVideoChunks, 0x68); // PPS

    if (sps && pps) {
      const initSegment = this.generateMP4InitializationSegment(sps, pps);
      const success = writeToClient(initSegment);
      if (success) {
        this.logger.i('📦 Sent MP4 initialization segment to client');
      } else {
        this.logger.w('⚠️ Failed to send MP4 initialization segment');
        return;
      }
    } else {
      this.logger.w('⚠️ Cannot generate MP4 initialization segment: missing SPS/PPS');
    }

    // Find essential frame types in buffer for fallback
    const spsFrame = this.findFrameByType(7); // Sequence Parameter Set
    const ppsFrame = this.findFrameByType(8); // Picture Parameter Set
    const idr = this.findFrameByType(5); // Instantaneous Decoder Refresh

    this.logger.d(
      `🔍 Frame analysis: SPS=${
        spsFrame ? `${spsFrame.length}B` : 'none'
      }, PPS=${ppsFrame ? `${ppsFrame.length}B` : 'none'}, IDR=${
        idr ? `${idr.length}B` : 'none'
      }, total chunks=${this.pendingVideoChunks.length}`
    );

    // Send critical frames for proper decoder initialization
    let framesWritten = 0;
    if (spsFrame) {
      const success = writeToClient(spsFrame);
      if (success) framesWritten++;
    } else {
      this.logger.w('⚠️ No SPS frame available for client initialization');
    }
    if (ppsFrame) {
      const success = writeToClient(ppsFrame);
      if (success) framesWritten++;
    } else {
      this.logger.w('⚠️ No PPS frame available for client initialization');
    }
    if (idr) {
      const success = writeToClient(idr);
      if (success) framesWritten++;
    } else {
      this.logger.w('⚠️ No IDR frame available for client initialization');
    }

    this.logger.i(
      `📊 Initialization complete: MP4 header + ${framesWritten} critical frames sent to TCP client`
    );

    // Send remaining buffered frames (excluding duplicates of frames already sent)
    this.sendBufferedFramesToClient(writeToClient, spsFrame, ppsFrame, idr);
  }

  /**
   * Finds a specific NAL unit type in the pending video chunks.
   */
  private findFrameByType(nalType: number): Buffer | undefined {
    return this.pendingVideoChunks.find(chunk => {
      const startOffset = this.getStartCodeOffset(chunk);
      if (startOffset >= 0 && startOffset < chunk.length) {
        return (chunk[startOffset] & 0x1f) === nalType;
      }
      return false;
    });
  }

  /**
   * Gets the start code offset for a NAL unit (3 or 4 byte start code).
   */
  private getStartCodeOffset(chunk: Buffer): number {
    if (
      chunk.length >= 4 &&
      chunk[0] === 0x00 &&
      chunk[1] === 0x00 &&
      chunk[2] === 0x00 &&
      chunk[3] === 0x01
    ) {
      return 4;
    } else if (chunk.length >= 3 && chunk[0] === 0x00 && chunk[1] === 0x00 && chunk[2] === 0x01) {
      return 3;
    }
    return -1;
  }

  /**
   * Sends all buffered video frames to the client, skipping already-sent frames.
   */
  private sendBufferedFramesToClient(
    writeToClient: (chunk: Buffer) => boolean,
    sps?: Buffer,
    pps?: Buffer,
    idr?: Buffer
  ): void {
    for (const chunk of this.pendingVideoChunks) {
      const startOffset = this.getStartCodeOffset(chunk);
      if (startOffset < 0) continue;

      const nalType = chunk[startOffset] & 0x1f;

      // Skip frames we already sent
      if (
        (nalType === 7 && chunk === sps) ||
        (nalType === 8 && chunk === pps) ||
        (nalType === 5 && chunk === idr)
      ) {
        continue;
      }

      // Skip unsupported NAL types (data partitioning)
      if (nalType === 2 || nalType === 3 || nalType === 4) {
        this.logger.d(
          `⏭️ Skipping unsupported NAL type ${nalType} (${this.getNALTypeName(nalType)})`
        );
        continue;
      }

      if (!writeToClient(chunk)) {
        this.logger.w('⚠️ Failed to write buffered frame to client, stopping');
        break;
      }
    }
  }

  /**
   * Buffers audio data for new client initialization and streams it to clients.
   * Manages audio buffer size to prevent memory issues.
   */
  private bufferAndStreamAudioData(audioChunk: Buffer): void {
    // Add to audio buffer
    this.pendingAudioChunks.push(audioChunk);

    // Stream to currently connected TCP client (if available)
    if (this.currentTcpWriter) {
      try {
        this.currentTcpWriter(audioChunk);
      } catch (error) {
        this.logger.w(`⚠️ Error writing audio chunk to TCP: ${error}`);
      }
    }

    // Manage audio buffer size (limit to 30 seconds of audio)
    const maxBufferSize = 30 * 1024 * 1024; // 30 MB max
    if (this.audioBuffer.length > maxBufferSize) {
      const dropped = this.audioBuffer.length - maxBufferSize;
      this.audioBuffer = this.audioBuffer.slice(-maxBufferSize); // Keep latest data

      this.logger.w(
        `🚨 Audio buffer overflow: Dropped ${Math.round(dropped / 1024)} KB to maintain buffer size`
      );
    }
  }

  /**
   * Handles memory cleanup requests from the MemoryManager.
   * Performs different levels of cleanup based on memory pressure.
   *
   * @param memoryInfo Information about current memory state and requested cleanup level
   */
  private handleMemoryCleanup(memoryInfo: MemoryInfo): void {
    const { level, rssMB, threshold } = memoryInfo;

    // Calculate buffer sizes for logging
    const bufferUsage = this.calculateBufferMemoryUsage();
    const totalBufferMB = Math.round(bufferUsage.totalSize / 1024 / 1024);

    this.logger.d(
      `🧹 ${level.toUpperCase()} cleanup for ${this.serialNumber}: ${rssMB}MB RSS > ${threshold}MB, ` +
        `Buffers: ${totalBufferMB}MB (${this.pendingVideoChunks.length} video, ${this.pendingAudioChunks.length} audio)`
    );

    let cleanupPerformed = false;

    switch (level) {
      case CleanupLevel.GENTLE:
        // More aggressive gentle cleanup - reduce buffers even if they're not at max
        if (this.pendingVideoChunks.length > 5) {
          const targetSize = Math.max(3, Math.floor(this.pendingVideoChunks.length * 0.6));
          const dropped = this.pendingVideoChunks.length - targetSize;
          this.performSmartBufferCleanup(targetSize);
          this.logger.d(
            `🧹 Gentle cleanup: dropped ${dropped} video chunks (${this.pendingVideoChunks.length} -> ${targetSize})`
          );
          cleanupPerformed = true;
        }

        // More aggressive audio cleanup too
        if (this.pendingAudioChunks.length > 3) {
          const targetSize = Math.max(2, Math.floor(this.pendingAudioChunks.length * 0.6));
          const dropped = this.pendingAudioChunks.length - targetSize;
          this.pendingAudioChunks = this.pendingAudioChunks.slice(-targetSize);
          this.logger.d(
            `🧹 Gentle cleanup: dropped ${dropped} audio chunks (${this.pendingAudioChunks.length} -> ${targetSize})`
          );
          cleanupPerformed = true;
        }

        // Trim assembly buffers if they're getting large
        if (bufferUsage.h264BufferSize > 512 * 1024) {
          // 512KB
          const currentSize = Math.round(bufferUsage.h264BufferSize / 1024);
          this.h264Buffer = this.h264Buffer.slice(-256 * 1024); // Keep last 256KB
          const newSize = Math.round(this.h264Buffer.length / 1024);
          this.logger.d(
            `🧹 Gentle cleanup: trimmed H.264 buffer (${currentSize}KB -> ${newSize}KB)`
          );
          cleanupPerformed = true;
        }

        if (bufferUsage.audioAssemblyBufferSize > 256 * 1024) {
          // 256KB
          const currentSize = Math.round(bufferUsage.audioAssemblyBufferSize / 1024);
          this.audioBuffer = this.audioBuffer.slice(-128 * 1024); // Keep last 128KB
          const newSize = Math.round(this.audioBuffer.length / 1024);
          this.logger.d(
            `🧹 Gentle cleanup: trimmed audio buffer (${currentSize}KB -> ${newSize}KB)`
          );
          cleanupPerformed = true;
        }
        break;

      case CleanupLevel.AGGRESSIVE:
        // Keep only essential frames for video
        if (this.pendingVideoChunks.length > 3) {
          const dropped = this.pendingVideoChunks.length - 3;
          this.performSmartBufferCleanup(3);
          this.logger.w(`🚨 Aggressive cleanup: dropped ${dropped} video chunks`);
          cleanupPerformed = true;
        }

        // Keep only 2 audio chunks
        if (this.pendingAudioChunks.length > 2) {
          const dropped = this.pendingAudioChunks.length - 2;
          this.pendingAudioChunks = this.pendingAudioChunks.slice(-2);
          this.logger.w(`🚨 Aggressive cleanup: dropped ${dropped} audio chunks`);
          cleanupPerformed = true;
        }

        // Trim assembly buffers if they get too large
        if (bufferUsage.h264BufferSize > 1024 * 1024) {
          // 1MB
          this.logger.w(
            `🚨 Clearing oversized H.264 assembly buffer (${Math.round(
              bufferUsage.h264BufferSize / 1024
            )}KB)`
          );
          this.h264Buffer = Buffer.alloc(0);
          cleanupPerformed = true;
        }

        if (bufferUsage.audioAssemblyBufferSize > 512 * 1024) {
          // 512KB
          this.logger.w(
            `🚨 Clearing oversized audio assembly buffer (${Math.round(
              bufferUsage.audioAssemblyBufferSize / 1024
            )}KB)`
          );
          this.audioBuffer = Buffer.alloc(0);
          cleanupPerformed = true;
        }
        break;

      case CleanupLevel.EMERGENCY:
        // Keep only the most recent frame
        if (this.pendingVideoChunks.length > 1) {
          const dropped = this.pendingVideoChunks.length - 1;
          this.pendingVideoChunks = this.pendingVideoChunks.slice(-1);
          this.logger.e(`💥 Emergency: dropped ${dropped} video chunks, keeping only latest`);
          cleanupPerformed = true;
        }

        // Keep only the most recent audio chunk
        if (this.pendingAudioChunks.length > 1) {
          const dropped = this.pendingAudioChunks.length - 1;
          this.pendingAudioChunks = this.pendingAudioChunks.slice(-1);
          this.logger.e(`💥 Emergency: dropped ${dropped} audio chunks, keeping only latest`);
          cleanupPerformed = true;
        }

        // Clear assembly buffers completely
        this.h264Buffer = Buffer.alloc(0);
        this.audioBuffer = Buffer.alloc(0);
        this.logger.e(`💥 Emergency: cleared all assembly buffers`);
        cleanupPerformed = true;
        break;
    }

    if (cleanupPerformed) {
      // Log post-cleanup state
      const postCleanupUsage = this.calculateBufferMemoryUsage();
      const postCleanupTotalMB = Math.round(postCleanupUsage.totalSize / 1024 / 1024);
      this.logger.d(
        `✅ ${level.toUpperCase()} cleanup completed for ${this.serialNumber}: ` +
          `${totalBufferMB}MB -> ${postCleanupTotalMB}MB ` +
          `(${this.pendingVideoChunks.length} video, ${this.pendingAudioChunks.length} audio)`
      );
    } else {
      this.logger.d(
        `🧹 ${level.toUpperCase()} cleanup for ${this.serialNumber}: no cleanup needed ` +
          `(${this.pendingVideoChunks.length} video, ${this.pendingAudioChunks.length} audio, ` +
          `H264: ${Math.round(bufferUsage.h264BufferSize / 1024)}KB, Audio: ${Math.round(
            bufferUsage.audioAssemblyBufferSize / 1024
          )}KB)`
      );
    }
  }

  /**
   * Checks for immediate memory pressure and performs emergency cleanup if needed.
   * This is a lighter-weight check that delegates to the centralized MemoryManager.
   */
  private checkMemoryPressure(): void {
    // Use the centralized memory manager for immediate checks
    this.memoryManager.checkMemoryPressure();
  }

  /**
   * Parses H.264 NAL units from a buffer, returning all complete units and leftover data.
   *
   * H.264 Parsing Strategy:
   * 1. Find start codes (0x00000001 or 0x000001) that delimit NAL units
   * 2. Extract complete NAL units between start codes
   * 3. Return incomplete data for next parsing iteration
   * 4. Handle edge cases with insufficient data gracefully
   *
   * @param buffer Raw H.264 data buffer to parse
   * @returns Object containing complete NAL units and remaining data
   */
  private parseH264NALUnits(buffer: Buffer): {
    units: Buffer[];
    remainingData: Buffer;
  } {
    const units: Buffer[] = [];
    let offset = 0;

    // Find the first start code
    const currentStart = this.findH264StartCode(buffer, 0);

    // If no start code at beginning, advance to first valid start
    if (currentStart !== 0 && currentStart !== -1) {
      offset = currentStart;
    } else if (currentStart === -1) {
      // No start codes found, return all data as remaining
      return { units, remainingData: buffer };
    }

    // Parse NAL units between start codes
    while (offset < buffer.length) {
      const startCodePos = this.findH264StartCode(buffer, offset);
      if (startCodePos === -1) {
        break; // No more start codes
      }

      // Find next start code to determine NAL unit boundary
      const nextStartCodePos = this.findH264StartCode(buffer, startCodePos + 4);

      if (nextStartCodePos === -1) {
        // Last NAL unit in buffer
        const nalUnit = buffer.subarray(startCodePos);
        if (nalUnit.length > 4) {
          // Ensure minimum NAL unit size
          units.push(nalUnit);
        }
        return { units, remainingData: Buffer.alloc(0) };
      } else {
        // Complete NAL unit found
        const nalUnit = buffer.subarray(startCodePos, nextStartCodePos);
        if (nalUnit.length > 4) {
          // Ensure minimum NAL unit size
          units.push(nalUnit);
        }
        offset = nextStartCodePos;
      }
    }

    return {
      units,
      remainingData: buffer.subarray(offset),
    };
  }

  /**
   * Finds H.264 start codes (0x00000001 or 0x000001) in a buffer.
   *
   * Start Code Detection:
   * - Prioritizes 4-byte start codes (0x00000001) for efficiency
   * - Falls back to 3-byte start codes (0x000001) for compatibility
   * - Returns the index of the start code or -1 if not found
   *
   * @param buffer Buffer to search for start codes
   * @param startOffset Starting position for search
   * @returns Index of start code or -1 if not found
   */
  private findH264StartCode(buffer: Buffer, startOffset: number = 0): number {
    // Search for 4-byte start code first (more common)
    for (let i = startOffset; i <= buffer.length - 4; i++) {
      if (
        buffer[i] === 0x00 &&
        buffer[i + 1] === 0x00 &&
        buffer[i + 2] === 0x00 &&
        buffer[i + 3] === 0x01
      ) {
        return i;
      }
    }

    // Search for 3-byte start code
    for (let i = startOffset; i <= buffer.length - 3; i++) {
      if (buffer[i] === 0x00 && buffer[i + 1] === 0x00 && buffer[i + 2] === 0x01) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Processes a single H.264 NAL unit with intelligent buffering and validation.
   *
   * Processing Pipeline:
   * 1. Validate NAL unit structure and extract type information
   * 2. Update stream state based on critical frame types (SPS, PPS, IDR)
   * 3. Apply keyframe filtering to ensure decoder compatibility
   * 4. Buffer NAL unit and stream to connected TCP clients
   * 5. Perform smart buffer management to prevent memory overflows
   *
   * NAL Unit Types of Interest:
   * - Type 7 (SPS): Sequence Parameter Set - video format information
   * - Type 8 (PPS): Picture Parameter Set - encoding parameters
   * - Type 5 (IDR): Instantaneous Decoder Refresh - keyframe/sync point
   * - Type 1: Non-IDR slice - regular video frame data
   * - Types 2,3,4: Data partitioning (filtered out for FFmpeg compatibility)
   *
   * @param nalUnit Complete NAL unit buffer to process
   */
  private processNALUnit(nalUnit: Buffer): void {
    // Validate minimum NAL unit size
    if (nalUnit.length < 4) {
      this.logger.d('⚠️ Skipping undersized NAL unit');
      return;
    }

    // Extract NAL unit type from header
    const nalStart = this.getStartCodeOffset(nalUnit);
    if (nalStart < 0 || nalStart >= nalUnit.length) {
      this.logger.d('⚠️ Invalid NAL start code, skipping unit');
      return;
    }

    const nalHeader = nalUnit[nalStart];
    const nalType = nalHeader & 0x1f; // Extract type from lower 5 bits

    // Update stream state based on NAL type
    this.updateStreamStateForNALType(nalType);

    // Apply keyframe filtering for decoder compatibility
    if (!this.shouldProcessNALUnit(nalType)) {
      return;
    }

    // Add to buffer and stream to clients
    this.bufferAndStreamNALUnit(nalUnit);

    // Perform smart buffer management
    this.performSmartBufferManagement();

    // Check for immediate memory pressure and cleanup if needed
    if (this.bufferCount % 5 === 0) {
      // Check every 5 frames
      this.checkMemoryPressure();
    }
  }

  /**
   * Updates internal stream state based on received NAL unit type.
   */
  private updateStreamStateForNALType(nalType: number): void {
    switch (nalType) {
      case 7: // SPS - Sequence Parameter Set
        this.logger.d('📋 SPS (Sequence Parameter Set) received');
        break;
      case 8: // PPS - Picture Parameter Set
        this.logger.d('📋 PPS (Picture Parameter Set) received');
        break;
      case 5: // IDR - Instantaneous Decoder Refresh (keyframe)
        this.waitingForKeyFrame = false;
        this.logger.d('🔑 IDR keyframe received, stream ready for decoding');
        break;
      case 1: // Non-IDR slice
        if (!this.waitingForKeyFrame) {
          this.logger.d('🎬 Non-IDR slice processed');
        }
        break;
      default:
        this.logger.d(`📦 NAL unit type ${nalType} (${this.getNALTypeName(nalType)}) received`);
        break;
    }
  }

  /**
   * Determines if a NAL unit should be processed based on stream state and type.
   */
  private shouldProcessNALUnit(nalType: number): boolean {
    // Always process critical setup frames
    if (nalType === 7 || nalType === 8 || nalType === 5) {
      return true;
    }

    // For video slices, only process after we have a keyframe
    if (nalType === 1) {
      if (this.waitingForKeyFrame) {
        this.logger.d('⏭️ Skipping non-IDR slice, waiting for keyframe');
        return false;
      }
      return true;
    }

    // Filter out unsupported data partitioning NAL types
    if (nalType === 2 || nalType === 3 || nalType === 4) {
      this.logger.d(
        `⏭️ Skipping unsupported NAL type ${nalType} (${this.getNALTypeName(nalType)})`
      );
      return false;
    }

    return true; // Process other NAL types
  }

  /**
   * Buffers NAL unit and streams it to connected TCP clients.
   * Always buffers data, but only streams when a TCP client is connected.
   */
  private bufferAndStreamNALUnit(nalUnit: Buffer): void {
    // Add to buffer for new client initialization
    this.pendingVideoChunks.push(nalUnit);
    this.bufferCount++;

    // Stream to currently connected TCP client (if available)
    if (this.currentTcpWriter) {
      try {
        this.currentTcpWriter(nalUnit);
      } catch (error) {
        this.logger.w(`⚠️ Error writing NAL unit to TCP: ${error}`);
      }
    }
  }

  /**
   * Performs intelligent buffer management to prevent memory overflow.
   * Prioritizes keyframes and essential frames for HomeKit Secure Video compatibility.
   */
  private performSmartBufferManagement(): void {
    if (this.pendingVideoChunks.length <= this.maxPendingChunks) {
      return; // No cleanup needed
    }

    const chunksToKeep: Buffer[] = [];
    let keptIDR = false;
    let keptSPS = false;
    let keptPPS = false;
    let keptRecentIDR = false;

    // Iterate backwards to keep most recent frames
    for (
      let i = this.pendingVideoChunks.length - 1;
      i >= 0 && chunksToKeep.length < this.maxPendingChunks;
      i--
    ) {
      const chunk = this.pendingVideoChunks[i];
      const startOffset = this.getStartCodeOffset(chunk);

      if (startOffset >= 0 && startOffset < chunk.length) {
        const chunkNalType = chunk[startOffset] & 0x1f;

        // HKSV prioritization: Always keep the most recent keyframe and critical frames
        const shouldKeep =
          chunksToKeep.length < 3 || // Always keep the 3 most recent frames
          (chunkNalType === 7 && !keptSPS) || // Keep SPS if not already kept
          (chunkNalType === 8 && !keptPPS) || // Keep PPS if not already kept
          (chunkNalType === 5 &&
            (!keptIDR || (!keptRecentIDR && i >= this.pendingVideoChunks.length - 10))); // Keep IDR, prioritizing recent ones

        if (shouldKeep) {
          chunksToKeep.unshift(chunk);

          // Track what we've kept
          if (chunkNalType === 7) keptSPS = true;
          if (chunkNalType === 8) keptPPS = true;
          if (chunkNalType === 5) {
            keptIDR = true;
            if (i >= this.pendingVideoChunks.length - 10) {
              keptRecentIDR = true;
            }
          }
        }
      }
    }

    // Update buffer and log cleanup
    const droppedCount = this.pendingVideoChunks.length - chunksToKeep.length;
    this.pendingVideoChunks = chunksToKeep;

    if (droppedCount > 0) {
      this.logger.d(
        `🧹 HKSV cleanup: Dropped ${droppedCount} chunks, kept ${chunksToKeep.length} ` +
          `(SPS:${keptSPS}, PPS:${keptPPS}, IDR:${keptIDR}, Recent-IDR:${keptRecentIDR})`
      );
    }
  }

  /**
   * Performs targeted buffer cleanup to reduce buffer to specified size.
   * Uses the same smart logic as performSmartBufferManagement but with custom target size.
   *
   * @param targetSize Target number of chunks to keep
   */
  private performSmartBufferCleanup(targetSize: number): void {
    if (this.pendingVideoChunks.length <= targetSize) {
      return; // No cleanup needed
    }

    const chunksToKeep: Buffer[] = [];
    let keptIDR = false;
    let keptSPS = false;
    let keptPPS = false;
    let keptRecentIDR = false;

    // Iterate backwards to keep most recent frames
    for (
      let i = this.pendingVideoChunks.length - 1;
      i >= 0 && chunksToKeep.length < targetSize;
      i--
    ) {
      const chunk = this.pendingVideoChunks[i];
      const startOffset = this.getStartCodeOffset(chunk);

      if (startOffset >= 0 && startOffset < chunk.length) {
        const chunkNalType = chunk[startOffset] & 0x1f;

        // Always prioritize critical frames and recent frames
        const shouldKeep =
          chunksToKeep.length < Math.min(3, targetSize) || // Always keep the most recent frames
          (chunkNalType === 7 && !keptSPS) || // Keep SPS if not already kept
          (chunkNalType === 8 && !keptPPS) || // Keep PPS if not already kept
          (chunkNalType === 5 &&
            (!keptIDR || (!keptRecentIDR && i >= this.pendingVideoChunks.length - 10))); // Keep IDR, prioritizing recent ones

        if (shouldKeep) {
          chunksToKeep.unshift(chunk);

          // Track what we've kept
          if (chunkNalType === 7) keptSPS = true;
          if (chunkNalType === 8) keptPPS = true;
          if (chunkNalType === 5) {
            keptIDR = true;
            if (i >= this.pendingVideoChunks.length - 10) {
              keptRecentIDR = true;
            }
          }
        }
      }
    }

    // Update buffer
    this.pendingVideoChunks = chunksToKeep;
  }

  /**
   * Removes emulation prevention bytes (0x03) from NAL units.
   * Used for parsing SPS/PPS data when needed for advanced processing.
   *
   * @param nalUnit NAL unit buffer to process
   * @returns Buffer with emulation prevention bytes removed
   */
  private removeEmulationPrevention(nalUnit: Buffer): Buffer {
    const result: number[] = [];

    for (let i = 0; i < nalUnit.length; i++) {
      // Check for emulation prevention pattern: 0x000003
      if (
        i < nalUnit.length - 2 &&
        nalUnit[i] === 0x00 &&
        nalUnit[i + 1] === 0x00 &&
        nalUnit[i + 2] === 0x03
      ) {
        // Copy the two zeros, skip the 0x03
        result.push(nalUnit[i], nalUnit[i + 1]);
        i += 2; // Skip the 0x03 byte
      } else {
        result.push(nalUnit[i]);
      }
    }

    return Buffer.from(result);
  }

  /**
   * Returns a human-readable name for NAL unit types.
   * Useful for debugging and logging NAL unit processing.
   *
   * @param nalType NAL unit type (5-bit value)
   * @returns Human-readable string describing the NAL type
   */
  private getNALTypeName(nalType: number): string {
    const nalTypeNames: { [key: number]: string } = {
      1: 'Non-IDR slice', // Regular video frame
      2: 'Data Partition A', // Data partitioning (legacy)
      3: 'Data Partition B', // Data partitioning (legacy)
      4: 'Data Partition C', // Data partitioning (legacy)
      5: 'IDR slice (keyframe)', // Instantaneous Decoder Refresh
      6: 'SEI', // Supplemental Enhancement Information
      7: 'SPS', // Sequence Parameter Set
      8: 'PPS', // Picture Parameter Set
      9: 'Access Unit Delimiter', // Frame boundary marker
      10: 'End of Sequence', // Sequence termination
      11: 'End of Stream', // Stream termination
      12: 'Filler Data', // Padding/alignment data
    };

    return nalTypeNames[nalType] || `Unknown (${nalType})`;
  }

  /**
   * Sets up periodic keepalive packets for the TCP client.
   */
  private setupClientKeepalive(
    clientSocket: net.Socket,
    writeToClient: (chunk: Buffer) => boolean
  ): void {
    const keepaliveInterval = setInterval(() => {
      if (clientSocket.destroyed) {
        clearInterval(keepaliveInterval);
        return;
      }

      // Send keepalive only if no recent data
      if (this.pendingVideoChunks.length === 0) {
        const keepalive = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x09, 0x10]);
        writeToClient(keepalive);
        this.logger.d('💓 Sent keepalive packet to client');
      }
    }, 2000);

    clientSocket.on('close', () => {
      clearInterval(keepaliveInterval);
    });
  }

  /**
   * Helper method to create a MediaObject for the current TCP server/stream.
   * Optimized FFmpeg configuration for HomeKit Secure Video compatibility.
   * Uses the stream options provided in getVideoStream for configuration.
   *
   * @param options Optional streaming parameters for configuring the MediaObject
   * @returns Promise<MediaObject> FFmpeg MediaObject configured for Eufy camera stream
   */
  private async createMediaObjectFromTcpServer(
    options?: RequestMediaStreamOptions
  ): Promise<MediaObject> {
    // FFmpeg configuration optimized for HomeKit Secure Video
    const ffmpegInput: FFmpegInput = {
      url: undefined,
      inputArguments: [
        '-f',
        'h264', // Input format: raw H.264 stream
        '-analyzeduration',
        '1000000', // Reduced analysis time for HKSV responsiveness
        '-probesize',
        '3000000', // Increased probe size to match target FFmpeg flags
        '-fflags',
        '+nobuffer+fastseek+flush_packets+discardcorrupt+genpts', // HKSV-optimized flags
        '-flags',
        'low_delay', // Minimize buffering delay
        '-avioflags',
        'direct', // Direct I/O access
        '-max_delay',
        '0', // No additional delay
        '-thread_queue_size',
        '512', // Increase thread queue for stability
        '-i',
        `tcp://127.0.0.1:${this.serverPort}`, // TCP input source
      ],
      mediaStreamOptions: options?.video
        ? {
            id: options.id || 'main',
            name: options.name || 'Eufy Camera Stream',
            container: options.container,
            video: {
              codec: 'h264',
              ...options.video, // Use provided video options
            },
            audio: this.audioMetadata
              ? {
                  codec: (this.audioMetadata as any)?.audioCodec?.toLowerCase() || 'aac',
                  ...options.audio, // Use provided audio options
                }
              : options.audio, // Use provided audio options or undefined
          }
        : {
            id: 'main',
            name: 'Eufy Camera Stream',
            container: undefined,
            video: {
              codec: 'h264',
              // Default dimensions if not provided - these will be auto-detected by FFmpeg
            },
            audio: this.audioMetadata
              ? {
                  codec: (this.audioMetadata as any)?.audioCodec?.toLowerCase() || 'aac',
                }
              : undefined, // Include audio if metadata is available
          },
    };

    return sdk.mediaManager.createFFmpegMediaObject(ffmpegInput, {
      sourceId: this.serialNumber,
    });
  }

  /**
   * Calculates the total memory usage of all internal buffers.
   * Useful for memory monitoring and cleanup decisions.
   *
   * @returns Object containing buffer sizes in bytes
   */
  private calculateBufferMemoryUsage(): {
    videoBufferSize: number;
    audioBufferSize: number;
    h264BufferSize: number;
    audioAssemblyBufferSize: number;
    totalSize: number;
  } {
    const videoBufferSize = this.pendingVideoChunks.reduce((size, chunk) => size + chunk.length, 0);
    const audioBufferSize = this.pendingAudioChunks.reduce((size, chunk) => size + chunk.length, 0);
    const h264BufferSize = this.h264Buffer.length;
    const audioAssemblyBufferSize = this.audioBuffer.length;

    return {
      videoBufferSize,
      audioBufferSize,
      h264BufferSize,
      audioAssemblyBufferSize,
      totalSize: videoBufferSize + audioBufferSize + h264BufferSize + audioAssemblyBufferSize,
    };
  }

  /**
   * Find a specific NAL unit type in the buffer
   */
  private findNALUnit(chunks: Buffer[], nalType: number): Buffer | null {
    for (const chunk of chunks) {
      if (chunk.length > 4) {
        // Check for 4-byte start code (0x00000001)
        if (chunk[0] === 0x00 && chunk[1] === 0x00 && chunk[2] === 0x00 && chunk[3] === 0x01) {
          const nalUnitType = chunk[4] & 0x1f;
          if (nalUnitType === nalType) {
            return chunk.slice(4); // Return NAL unit without start code
          }
        }
        // Check for 3-byte start code (0x000001)
        else if (chunk[0] === 0x00 && chunk[1] === 0x00 && chunk[2] === 0x01) {
          const nalUnitType = chunk[3] & 0x1f;
          if (nalUnitType === nalType) {
            return chunk.slice(3); // Return NAL unit without start code
          }
        }
      }
    }
    return null;
  }
}
