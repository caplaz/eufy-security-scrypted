/**
 * TCP Stream Server — H.264/H.265 streaming from Eufy WebSocket events
 *
 * Receives livestream video/audio events from the eufy-security-ws
 * WebSocket client and serves them on two local TCP ports:
 *  - a raw port streaming Annex-B H.264/H.265 NAL units (CLI, snapshots),
 *  - a muxed port where each client gets its own in-process JMuxer that
 *    emits fragmented MP4 (video + ADTS AAC audio) for ffmpeg consumers.
 *
 * Also manages the upstream livestream lifecycle: consumer-driven
 * start/stop, cold-start and mid-session wedge detection, the shared
 * per-HomeBase stream slot, and a cached last keyframe for snapshots.
 */

import * as net from "node:net";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import JMuxer from "jmuxer";
import { Logger, ILogObj } from "tslog";
import { ConnectionManager } from "./connection-manager";
import { H264Parser } from "./h264-parser";
import { ServerStats, StreamData } from "./types";
import {
  EufyWebSocketClient,
  DEVICE_EVENTS,
  VideoMetadata,
  AudioMetadata,
} from "@caplaz/eufy-security-client";

/**
 * Configuration options for the TCP stream server
 */
export interface StreamServerOptions {
  /** Server port number (default: 8080) */
  port?: number;
  /** Server host address (default: '0.0.0.0') */
  host?: string;
  /** Maximum number of concurrent connections (default: 10) */
  maxConnections?: number;
  /** Optional external logger instance compatible with tslog Logger<ILogObj> (if not provided, uses internal tslog Logger) */
  logger?: Logger<ILogObj>;
  /** WebSocket client for receiving video data events (required for Eufy cameras) */
  wsClient: EufyWebSocketClient;
  /** Device serial number to filter events (required for Eufy cameras) */
  serialNumber: string;
  /**
   * Codec hint to use BEFORE live metadata is captured. Live metadata only
   * arrives after the first video frame, but downstream consumers
   * (Rebroadcast plugin, HomeKit) read `getVideoMetadata()` synchronously
   * when `getVideoStream()` is called — before any frame has been
   * received. If we report the wrong codec, the Rebroadcast prebuffer's
   * sync-frame detection is set up for the wrong NAL unit types and
   * never finds a keyframe (Eufy H.265 cameras → "Unable to find sync
   * frame in rtsp prebuffer" → HomeKit timeout).
   *
   * The device layer persists the last-detected codec to Scrypted device
   * storage and passes it here on instantiation. The captured live
   * metadata replaces this hint as soon as the first frame arrives.
   */
  initialVideoCodec?: "H264" | "H265";
  /**
   * Optional gate for the shared HomeBase stream slot. A Eufy HomeBase serves
   * only one camera P2P stream at a time, so the device layer injects this to
   * serialize starts across cameras on the same station. Called synchronously
   * right before `startLivestream`:
   *   - priority "live" (a viewer/recorder is attached) always succeeds,
   *     preempting any current holder (whose `onRevoke` fires).
   *   - priority "background" (thumbnail refresh) returns null if the slot is
   *     busy — the server then does NOT start.
   * Returns a lease whose `release()` must be called when the stream stops.
   * When omitted (e.g. the CLI), the server starts unconditionally as before.
   */
  acquireStreamSlot?: (
    priority: "live" | "background",
    onRevoke: () => void,
  ) => StationSlotLease | null;
}

/** A held lease on a station's single stream slot. */
export interface StationSlotLease {
  release(): void;
  readonly active: boolean;
  /**
   * Resolves when it is safe to start streaming — i.e. any camera this grant
   * preempted has released the HomeBase slot (or a safety timeout elapsed).
   * Already resolved when nothing was preempted.
   */
  readonly whenReady: Promise<void>;
  /** Mark this camera as delivering video (protects it from preemption). */
  markDelivering(): void;
}

interface MetadataWaiter {
  resolve(metadata: VideoMetadata): void;
  reject(error: Error): void;
}

export interface MetadataBootstrapWaiter {
  promise: Promise<VideoMetadata>;
  release(): void;
  cancel(): void;
}

/**
 * Simple TCP streaming server for raw H.264 video data
 *
 * This server accepts TCP connections and streams raw H.264 video data
 * to all connected clients. It provides basic connection management,
 * NAL unit parsing, and key frame detection.
 *
 * @example
 * ```typescript
 * const server = new StreamServer({
 *   port: 8080,
 *   wsClient: eufyWebSocketClient,
 *   serialNumber: 'device123'
 * });
 *
 * server.start().then(() => {
 *   console.log('Server started and listening for video data');
 * });
 * ```
 */
export class StreamServer extends EventEmitter {
  private logger: Logger<ILogObj>;
  private options: Required<
    Omit<StreamServerOptions, "logger" | "acquireStreamSlot">
  > & {
    logger?: Logger<ILogObj>;
    acquireStreamSlot?: StreamServerOptions["acquireStreamSlot"];
  };
  private server?: net.Server;
  private muxedServer?: net.Server;
  /**
   * Map of muxed-client socket → its dedicated JMuxer instance. Each
   * connection gets its own muxer so every consumer receives a complete
   * fMP4 init segment at the start of its stream.
   *
   * JMuxer must be constructed with the correct `videoCodec` (H.264 vs
   * H.265) because the codec choice affects which remuxer / fMP4 sample
   * description box it writes (`avcC` vs `hvcC`). The codec isn't known
   * until the first video event arrives, so a muxed client connecting
   * before the first frame is held in `pendingMuxerSockets` instead —
   * counts as an active consumer (so the upstream livestream starts) but
   * has no JMuxer yet.
   */
  private muxerStreams = new Map<
    net.Socket,
    { muxer: JMuxer; duplex: Duplex }
  >();
  private pendingMuxerSockets = new Set<net.Socket>();
  private pendingMetadataWaitAbortControllers = new Map<
    net.Socket,
    AbortController
  >();
  /** Consumers which need the first frame's metadata, but have no TCP socket. */
  private metadataBootstrapConsumers = 0;
  private nextConsumerAttachedCallbacks = new Set<() => void>();

  /**
   * Count every "thing currently waiting on or consuming the livestream":
   *   • Raw TCP clients (legacy snapshot, raw video).
   *   • Active muxer clients (rebroadcast ffmpeg consuming fMP4).
   *   • Pending muxer sockets (rebroadcast ffmpeg connected, codec
   *     metadata not yet known so the muxer isn't constructed).
   *   • Pending snapshot resolvers (a Camera.takePicture call waiting
   *     for the next keyframe).
   *
   * Used everywhere we decide "is anyone still waiting on bytes" —
   * watchdog gating, idle-stop gating, post-snapshot linger expiration,
   * post-recycle re-arming. Excluding snapshot resolvers caused the
   * activity monitor's idle-stop to tear down the livestream during a
   * battery-camera cold-start while a snapshot was still waiting, which
   * cost ~30s of wasted cold-start time on the follow-up consumer.
   */
  private getTotalConsumers(): number {
    return (
      this.connectionManager.getActiveConnectionCount() +
      this.muxerStreams.size +
      this.pendingMuxerSockets.size +
      this.snapshotResolvers.length +
      this.metadataBootstrapConsumers
    );
  }

  /** TCP/muxer/snapshot consumers, excluding metadata and warm bootstrap holds. */
  private getRealConsumerCount(): number {
    return this.getTotalConsumers() - this.metadataBootstrapConsumers;
  }

  private getDesiredStreamSlotPriority(): "live" | "background" {
    if (this.warmLease) return "background";
    const liveConsumers =
      this.connectionManager.getActiveConnectionCount() +
      this.muxerStreams.size +
      this.pendingMuxerSockets.size +
      this.metadataBootstrapConsumers;
    return liveConsumers > 0 ? "live" : "background";
  }
  private connectionManager: ConnectionManager;
  private h264Parser: H264Parser;
  private isActive = false;
  private startTime?: Date;
  private eventRemover?: () => boolean;
  private audioEventRemover?: () => boolean;

  // Stream state management
  private livestreamIntendedState = false;
  private livestreamActualState = false;
  private startStopTimeout?: ReturnType<typeof setTimeout>;
  /**
   * Counts back-to-back `startLivestream` attempts that produced no video
   * data. Resets to 0 once `livestreamActualState` flips true or the
   * intended state is cleared. Used to cap the retry loop so a wedged
   * upstream (e.g. HomeBase that's accepting CMD_START_REALTIME_MEDIA but
   * not returning any P2P data) doesn't get hammered indefinitely — each
   * extra `startLivestream` we send to a stuck HomeBase compounds the
   * backpressure and slows recovery.
   */
  private consecutiveNoDataStarts = 0;
  /**
   * How many `startLivestream` commands with no resulting video data we
   * tolerate before declaring the upstream wedged. Set to 1: re-sending
   * `startLivestream` to a deeply-idle T86P2 doesn't help (each fresh start
   * tends to reset the half-open P2P negotiation), whereas a station P2P
   * recycle reliably does. So we send once, wait the full cold-start window
   * (`startStopTimeout` below uses `COLD_START_STALE_THRESHOLD_MS`), then go
   * straight to the recycle instead of hammering 3× and burning ~90s first.
   */
  private readonly MAX_NO_DATA_STARTS = 1;

  /**
   * Timestamp of the most recent `LIVESTREAM_VIDEO_DATA` event for this
   * device. Used by the mid-session wedge watchdog: if intent is "stream
   * should be flowing" but no bytes have arrived for STALE_DATA_THRESHOLD_MS
   * while consumers are still attached, we treat the upstream as wedged
   * and emit `upstreamWedged` (same path as the cold-start counter).
   *
   * Reset to 0 whenever the stream is intentionally stopped so a stale
   * timestamp can't trigger the watchdog on the next session.
   */
  private lastVideoDataAt = 0;
  /**
   * Mid-session threshold: data WAS flowing in this session
   * (`lastVideoDataAt > 0`) and has now stopped. 15s is plenty — a
   * working stream should never have a 15s data gap. Fires the wedge
   * fast so the station recycle path can recover the session quickly.
   */
  private readonly STALE_DATA_THRESHOLD_MS = 15000;

  /**
   * Cold-start threshold: no data has EVER arrived in this session
   * (`lastVideoDataAt === 0`), so we're waiting for the first frame.
   *
   * This is gated by the VIEWER'S patience, not the camera's wake time.
   * HomeKit kills a live session ~30s after the request if no video has
   * arrived (observed: "streaming session killed, duration: 30s"). The one
   * thing that reliably recovers a deeply-idle/wedged P2P session is a
   * station recycle — and on the cameras that actually stream here (Front
   * Door, garages) the camera itself wakes fast: it delivers its first
   * frame within ~1–2s AFTER the recycle. So the entire pre-recycle wait is
   * dead time. At 45s the recycle landed AFTER HomeKit had already given up
   * (and torn down the prebuffer ffmpeg output → "Connection refused"), so
   * the recovered video reached nobody.
   *
   * 18s leaves a healthy-but-cold camera room to deliver its first frame
   * with no recycle at all, yet still fits detect (~18s) + recycle/restart/
   * first-frame (~10s) ≈ 28s inside HomeKit's ~30s window, so the recovered
   * stream reaches the viewer that's still waiting. A genuinely deep-sleep
   * battery camera that needs >30s to wake was going to miss this live view
   * regardless of how long we wait; recycling early still warms the keyframe
   * cache + P2P session for the next tap. Signal-dead cameras can't loop on
   * this — recycle suppression (no-signal / chronic-failure) stops them.
   */
  private readonly COLD_START_STALE_THRESHOLD_MS = 18000;

  /**
   * Timestamp of when the current livestream "session" was established —
   * either when we issued `startLivestream` or when `ensureLivestreamState`
   * observed bropat reporting `isLivestreaming=true` while we have intent.
   *
   * The mid-session wedge watchdog uses `max(lastVideoDataAt, livestreamSessionStartedAt)`
   * as its freshness anchor, so the wedge can fire even on the "zombie
   * already-running" case where bropat says streaming is active but no
   * `LIVESTREAM_VIDEO_DATA` events ever arrive. Without this anchor the
   * watchdog skipped firing whenever `lastVideoDataAt === 0` (because
   * nothing had ever flowed), leaving snapshots/muxers to spin for the
   * full timeout against a wedged P2P session.
   *
   * Reset to 0 on graceful stop and in `markUpstreamWedged`.
   */
  private livestreamSessionStartedAt = 0;

  /**
   * Timer that holds the livestream open for a short window after a
   * snapshot completes — gives HomeKit/Home app time to follow up with a
   * stream request without paying the full cold-start penalty (~30s on
   * battery cameras like the T86P2 4G LTE). HomeKit's flow is reliably
   * "snapshot, then stream within seconds" when the user taps a tile.
   *
   * Cancelled the moment a consumer attaches (the consumer will keep the
   * stream alive on its own merit) OR when the next snapshot starts (it's
   * using the same warm session). Battery cost: at most LINGER_MS of
   * livestream per snapshot when no consumer follows up.
   */
  private postSnapshotLingerTimer?: ReturnType<typeof setTimeout>;
  private readonly POST_SNAPSHOT_LINGER_MS = 8000;

  /**
   * Set by the device layer while a station P2P recycle is in flight
   * (station.disconnect → station.connect → wait for CONNECTED event).
   * While true, `ensureLivestreamState` defers any `startLivestream`
   * command — sending one to a recovering station typically wastes the
   * attempt because bropat will accept the command but the underlying
   * P2P transport isn't ready to deliver frames. When the flag clears,
   * `setRecycleInFlight(false)` re-arms the livestream if consumers are
   * still waiting so the user gets data without having to retry.
   */
  private recycleInFlight = false;

  // Video metadata from first frame
  private videoMetadata: VideoMetadata | null = null;
  /**
   * Codec hint provided at construction time (see `StreamServerOptions.initialVideoCodec`).
   * Returned by `getVideoMetadata()` (as a synthetic metadata object with
   * codec only, dimensions/fps zeroed) ONLY when no real live metadata
   * has been captured yet. The first live `LIVESTREAM_VIDEO_DATA` event
   * replaces this with full real metadata.
   */
  private hintedVideoCodec?: "H264" | "H265";
  /**
   * Metadata is only authoritative for the P2P session that delivered it.
   * Keep the last record as a compatibility hint, but require every new
   * session to verify it with a fresh video event before consumers trust it.
   */
  private metadataGeneration = 0;
  private metadataVerifiedGeneration = -1;
  private metadataWaiters: MetadataWaiter[] = [];

  // Audio metadata from first audio frame
  private audioMetadata: AudioMetadata | null = null;

  /**
   * Whether this camera actually delivers an audio track. Many Eufy cameras
   * run with the mic disabled (`microphone: false`) and send video only.
   * JMuxer in `both` mode never emits fMP4 until EVERY declared track has a
   * sample (see remux `isReady()`), so muxing a video-only camera as `both`
   * hangs forever and the downstream ffmpeg times out. We detect audio
   * empirically (set true the first time any audio frame arrives) and pick
   * the muxer mode accordingly. `undefined` = not yet determined.
   */
  private deliversAudio: boolean | undefined = undefined;

  /**
   * How long a `both`-mode muxer may produce zero fMP4 output before we give up
   * on audio and rebuild it video-only. A camera with a real, continuous audio
   * track emits in well under a second; this only fires for cameras that report
   * audio but don't actually deliver a usable track (which would otherwise hang
   * the live view forever). Kept short so it still lands inside the consumer's
   * patience window after the handoff/cold-start latency.
   */
  private readonly BOTH_TO_VIDEO_FALLBACK_MS = 4000;

  /**
   * Lease on the shared HomeBase stream slot (see
   * `StreamServerOptions.acquireStreamSlot`). Held while this camera is the
   * one streaming on its station; released when the stream stops.
   */
  private streamLease: StationSlotLease | null = null;
  private streamLeasePriority: "live" | "background" | null = null;
  /** A preemptible, no-viewer window retained after a cold metadata attempt. */
  private warmLease?: {
    id: number;
    timer: ReturnType<typeof setTimeout>;
  };
  private nextWarmLeaseId = 0;
  /**
   * Set when a higher-priority camera on the same HomeBase preempted us. While
   * true we stay down (don't re-start) despite lingering consumers and don't
   * treat the resulting "no video" as an upstream wedge. Cleared once our
   * consumers drain (the viewer gave up) so a future tap starts fresh.
   */
  private slotRevoked = false;

  // Client activity monitoring for battery optimization
  private lastClientActivity = 0;
  private activityCheckInterval?: ReturnType<typeof setInterval>;
  // How long to keep a battery camera streaming after the last consumer
  // detaches (e.g. you close the Home app). `lastClientActivity` advances on
  // every frame WHILE a muxer is attached, so this never trips during active
  // viewing — it only governs the post-close drain. Kept long enough to reuse
  // a warm stream across Scrypted Rebroadcast's quick reconnect churn (~1-2s)
  // and avoid a cold "find sync frame" on a fast reopen, but short enough not
  // to burn battery for 30s after every view. 12s balances both.
  private readonly ACTIVITY_TIMEOUT = 12000;

  // Statistics
  private stats = {
    framesProcessed: 0,
    bytesTransferred: 0,
    lastFrameTime: null as Date | null,
  };

  // Snapshot capture state
  private snapshotResolvers: Array<{
    resolve: (buffer: Buffer) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];

  // Parameter-set cache for new client initialization.
  // H.264 uses SPS (type 7) + PPS (type 8).
  // H.265 uses VPS (type 32) + SPS (type 33) + PPS (type 34).
  private cachedSPS: Buffer | null = null;
  private cachedPPS: Buffer | null = null;
  private cachedVPS: Buffer | null = null; // H.265 Video Parameter Set

  /** Annex-B 4-byte start code used to re-frame cached parameter-set NALs. */
  private static readonly ANNEX_B_START_CODE = Buffer.from([
    0x00, 0x00, 0x00, 0x01,
  ]);

  // Last decodable keyframe, retained so snapshots/thumbnails can be served
  // without waking the camera. Populated whenever a keyframe flows through —
  // from live view, HKSV recording, a motion-triggered stream, or a prior
  // snapshot — so the Home app grid can be served instantly from cache
  // instead of forcing one cold P2P wake per camera (which all contend on the
  // single HomeBase and mostly time out, leaving stale tiles). The buffer is
  // self-contained: parameter sets are prepended so it decodes on its own.
  private lastKeyframe: {
    data: Buffer;
    codec: "H264" | "H265";
    timestamp: number;
  } | null = null;

  constructor(options: StreamServerOptions) {
    super();

    this.options = {
      port: options.port ?? 8080,
      host: options.host ?? "0.0.0.0",
      maxConnections: options.maxConnections ?? 10,
      logger: options.logger,
      wsClient: options.wsClient,
      serialNumber: options.serialNumber,
      initialVideoCodec: options.initialVideoCodec ?? "H264",
      acquireStreamSlot: options.acquireStreamSlot,
    };

    this.hintedVideoCodec = options.initialVideoCodec;

    // Use external logger if provided, otherwise create internal tslog Logger
    // Note: When external logger is provided, it controls its own debug level
    this.logger =
      options.logger ??
      new Logger({
        name: "StreamServer",
        minLevel: 3, // info level - external loggers control their own debug level
      });

    this.connectionManager = new ConnectionManager(
      this.logger,
      this.options.maxConnections,
    );
    this.h264Parser = new H264Parser(this.logger);

    this.setupEventHandlers();
    this.setupWebSocketListener();
  }

  /**
   * Setup event handlers for connection manager
   */
  private setupEventHandlers(): void {
    this.connectionManager.on(
      "clientConnected",
      async (connectionId, connectionInfo) => {
        this.notifyNextConsumerAttached();
        this.logger.info(
          `Client connected: ${connectionId} from ${connectionInfo.remoteAddress}:${connectionInfo.remotePort}`,
        );
        this.emit("clientConnected", connectionId, connectionInfo);

        // Send cached SPS/PPS headers immediately so FFmpeg can parse the stream
        this.sendCachedHeaders(connectionId);

        // Start livestream if this is the first consumer overall
        // (TCP clients + muxer clients combined). The helper internally
        // checks `livestreamIntendedState` so re-entering on every connect
        // is a no-op once the stream is up — equivalent to the old
        // `previousCount === 0` guard but muxer-aware.
        await this.updateLivestreamStateForMuxerClients();
      },
    );

    this.connectionManager.on("clientDisconnected", async (connectionId) => {
      this.logger.info(`Client disconnected: ${connectionId}`);
      this.emit("clientDisconnected", connectionId);

      // Stop livestream only if no consumers remain.
      await this.updateLivestreamStateForMuxerClients();
    });
  }

  /** Invoke callbacks waiting to hand a bootstrap stream to its first viewer. */
  private notifyNextConsumerAttached(): void {
    // A real viewer replaces a preemptible warm bootstrap. Drop its background
    // grant so the normal live path reacquires the station slot at live
    // priority; the timer is generation guarded and can no longer tear down
    // the viewer's replacement lease.
    if (this.warmLease) this.endWarmLease("consumer attached", true);
    const callbacks = Array.from(this.nextConsumerAttachedCallbacks);
    this.nextConsumerAttachedCallbacks.clear();
    for (const callback of callbacks) callback();
  }

  /** Register a one-shot notification for the next raw or muxed consumer. */
  onNextConsumerAttached(callback: () => void): () => void {
    this.nextConsumerAttachedCallbacks.add(callback);
    return () => this.nextConsumerAttachedCallbacks.delete(callback);
  }

  /**
   * Retain one preemptible background consumer after an unsuccessful cold
   * start. It belongs to the ordinary consumer accounting so recycle recovery
   * can re-arm it, but never competes with a real viewer for a live slot.
   */
  holdWarmLease(ms: number = 60000): void {
    if (this.warmLease || this.getRealConsumerCount() > 0) return;
    // A previous metadata bootstrap may have acquired a live grant. It must
    // not leak into the warm period: release it before the background retry.
    if (this.streamLeasePriority === "live") this.releaseStreamSlot();
    const id = ++this.nextWarmLeaseId;
    this.metadataBootstrapConsumers++;
    this.warmLease = {
      id,
      timer: setTimeout(() => this.endWarmLease("expired", false, id), ms),
    };
    this.warmLease.timer.unref?.();
    this.livestreamIntendedState = true;
    this.lastClientActivity = Date.now();
    this.startActivityMonitoring();
    void this.ensureLivestreamState().catch((error) =>
      this.logger.warn(`Failed to start warm lease: ${error}`),
    );
  }

  private endWarmLease(
    reason: string,
    replacedByRealConsumer: boolean,
    expectedId?: number,
  ): void {
    const warmLease = this.warmLease;
    if (
      !warmLease ||
      (expectedId !== undefined && warmLease.id !== expectedId)
    ) {
      return;
    }
    clearTimeout(warmLease.timer);
    this.warmLease = undefined;
    this.metadataBootstrapConsumers--;

    if (replacedByRealConsumer && this.getRealConsumerCount() > 0) {
      // Never let a later warm expiry release the new live grant. Reacquire it
      // at live priority; release the background grant before asking for it.
      if (this.streamLeasePriority === "background") this.releaseStreamSlot();
      void this.updateLivestreamStateForMuxerClients();
      return;
    }

    // Safety ordering matters to station handoff: stop the P2P session before
    // freeing its background slot, so a sibling's whenReady cannot overlap it.
    this.livestreamIntendedState = false;
    void this.ensureLivestreamState().catch((error) =>
      this.logger.warn(`Failed to end warm lease (${reason}): ${error}`),
    );
  }

  /**
   * Send cached SPS/PPS headers to a specific client
   * This ensures new clients can immediately decode the stream
   * @param connectionId - The connection ID to send headers to
   */
  private sendCachedHeaders(connectionId: string): void {
    const hasHeaders = this.cachedVPS || this.cachedSPS || this.cachedPPS;
    if (!hasHeaders) {
      this.logger.debug(
        `No cached parameter-set headers available for client ${connectionId}`,
      );
      return;
    }

    // H.265: send VPS → SPS → PPS (order matters for decoder initialisation)
    if (this.cachedVPS) {
      this.logger.debug(
        `Sending cached VPS header (${this.cachedVPS.length} bytes) to ${connectionId}`,
      );
      this.connectionManager.sendToClient(connectionId, this.cachedVPS);
    }

    if (this.cachedSPS) {
      this.logger.debug(
        `Sending cached SPS header (${this.cachedSPS.length} bytes) to ${connectionId}`,
      );
      this.connectionManager.sendToClient(connectionId, this.cachedSPS);
    }

    if (this.cachedPPS) {
      this.logger.debug(
        `Sending cached PPS header (${this.cachedPPS.length} bytes) to ${connectionId}`,
      );
      this.connectionManager.sendToClient(connectionId, this.cachedPPS);
    }
  }

  /**
   * Start monitoring client activity to detect idle connections
   */
  private startActivityMonitoring(): void {
    this.stopActivityMonitoring(); // Clear any existing interval

    this.activityCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - this.lastClientActivity;

      // Clean up any stale connections first
      this.cleanupStaleConnections();

      const totalConsumers = this.getTotalConsumers();

      // Mid-session wedge detection. Runs BEFORE the idle-stop check so
      // that the wedge path (which clears intent + emits recycle signal)
      // takes precedence over a graceful inactivity stop.
      //
      // Freshness anchor = max(lastVideoDataAt, livestreamSessionStartedAt).
      // Using sessionStartedAt as a fallback means we also catch the
      // "zombie already-running" case: bropat reports `isLivestreaming=true`
      // so `ensureLivestreamState` doesn't issue a fresh `startLivestream`
      // (and therefore doesn't increment the cold-start counter), but no
      // video data ever arrives. Without this anchor, `lastVideoDataAt`
      // stayed at 0 and the watchdog skipped firing — snapshots and
      // HomeKit sessions would hang for the full 60s/30s timeout.
      //
      // Battery-safe gating, in order:
      //   1. `livestreamIntendedState === true`  — we want a stream.
      //   2. `anchor > 0`                        — a session is established
      //      (so we don't false-fire before anything has happened).
      //   3. `now - anchor > STALE_DATA_THRESHOLD_MS` — data has not
      //      flowed (or has stopped flowing) for too long.
      //   4. `totalConsumers > 0`                — somebody is actually
      //      waiting on bytes. With zero consumers the existing
      //      inactivity stop below handles cleanup more gracefully.
      const freshnessAnchor = Math.max(
        this.lastVideoDataAt,
        this.livestreamSessionStartedAt,
      );
      const staleMs = now - freshnessAnchor;
      // Pick the right threshold for the situation. See the comments
      // on `STALE_DATA_THRESHOLD_MS` and `COLD_START_STALE_THRESHOLD_MS`
      // for the rationale.
      const isColdStart = this.lastVideoDataAt === 0;
      const threshold = isColdStart
        ? this.COLD_START_STALE_THRESHOLD_MS
        : this.STALE_DATA_THRESHOLD_MS;
      if (
        this.livestreamIntendedState &&
        !this.slotRevoked &&
        freshnessAnchor > 0 &&
        staleMs > threshold &&
        totalConsumers > 0
      ) {
        this.markUpstreamWedged("data-flow-stale", {
          staleMs,
          consumers: totalConsumers,
        });
      } else if (
        timeSinceActivity > this.ACTIVITY_TIMEOUT &&
        totalConsumers === 0
      ) {
        this.logger.info(
          `🕒 No client activity for ${Math.round(timeSinceActivity / 1000)}s and no active clients, stopping camera stream`,
        );
        this.livestreamIntendedState = false;
        this.lastVideoDataAt = 0;
        this.livestreamSessionStartedAt = 0;
        this.stopActivityMonitoring();
        this.ensureLivestreamState();
      } else if (totalConsumers === 0 && this.livestreamIntendedState) {
        // Brought over from main: useful diagnostic when the stream is
        // intended to be running but everyone has temporarily detached
        // (e.g. between Rebroadcast cycles). `totalConsumers` replaces
        // the old `activeClients` so muxer clients count.
        this.logger.debug(
          `No active clients but stream is intended to run - waiting for connections`,
        );
      }
    }, 5000); // Check every 5 seconds

    this.logger.debug("Started client activity monitoring");
  }

  /**
   * Stop monitoring client activity
   */
  private stopActivityMonitoring(): void {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = undefined;
      this.logger.debug("Stopped client activity monitoring");
    }
  }

  /**
   * Destroy TCP connections older than 5 minutes. Previously this just
   * logged; it now actually force-disconnects the socket. Necessary because
   * when a peer ffmpeg gets SIGKILL-ed the OS sometimes never surfaces a
   * `close` event on our side, leaving a zombie connection that would keep
   * the activity-monitor interval alive forever (and spam the logs every
   * 5 seconds with "Cleaning up stale connection").
   */
  private cleanupStaleConnections(): void {
    const connectionStats = this.connectionManager.getConnectionStats();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [connectionId, info] of Object.entries(connectionStats)) {
      const connectionAge = now - info.connectedAt.getTime();
      if (connectionAge > 5 * 60 * 1000) {
        this.logger.info(
          `Cleaning up stale connection: ${connectionId} (age: ${Math.round(connectionAge / 1000)}s)`,
        );
        this.connectionManager.disconnectClient(connectionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(
        `Identified ${cleanedCount} stale connections for cleanup`,
      );
    }
  }

  /**
   * Setup WebSocket event listener for video data
   */
  private setupWebSocketListener(): void {
    this.logger.info(
      `Setting up WebSocket listener for device: ${this.options.serialNumber}`,
    );

    // Listen for livestream video data events
    this.eventRemover = this.options.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA,
      (event) => {
        // Filter events by device serial number
        if (event.serialNumber !== this.options.serialNumber) {
          return;
        }

        // Log that we received a video data event (first few only to avoid spam)
        if (this.stats.framesProcessed < 3) {
          this.logger.debug(
            `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes, metadata present: ${!!event.metadata}`,
          );
          if (event.metadata) {
            this.logger.debug(
              `Video metadata: codec=${event.metadata.videoCodec}, ${event.metadata.videoWidth}x${event.metadata.videoHeight} @ ${event.metadata.videoFPS}fps`,
            );
          }
        }

        // Capture metadata once for each P2P session. The previous session's
        // record remains available as a hint, but cannot verify this one.
        if (event.metadata && !this.isMetadataVerifiedForCurrentSession()) {
          this.videoMetadata = {
            videoCodec: event.metadata.videoCodec,
            videoFPS: event.metadata.videoFPS,
            videoWidth: event.metadata.videoWidth,
            videoHeight: event.metadata.videoHeight,
          };
          this.metadataVerifiedGeneration = this.metadataGeneration;
          this.logger.info(
            `📐 Captured video metadata: ${this.videoMetadata.videoWidth}x${this.videoMetadata.videoHeight} @ ${this.videoMetadata.videoFPS}fps, codec: ${this.videoMetadata.videoCodec}`,
          );
          this.emit("metadataReceived", this.videoMetadata);
          for (const waiter of this.metadataWaiters.splice(0)) {
            waiter.resolve(this.videoMetadata);
          }
        }

        // Mark livestream as actually running when we receive data
        if (this.warmLease) this.endWarmLease("first live frame", false);
        if (!this.livestreamActualState) {
          this.setLivestreamActual(true);
          this.consecutiveNoDataStarts = 0;
          this.logger.info(
            "📹 Livestream confirmed active - receiving video data",
          );
        }

        // Kick the stale-data watchdog. Unconditional — we want to track
        // upstream liveness regardless of whether anyone is consuming the
        // bytes downstream. (Bropat pushes events whenever the camera
        // delivers; if those events stop while we still want a stream,
        // the bropat session is wedged.)
        this.lastVideoDataAt = Date.now();

        // Log video data events based on client activity
        const activeClients = this.connectionManager.getActiveConnectionCount();
        if (activeClients > 0) {
          this.logger.debug(
            `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes (${activeClients} active clients)`,
          );
        } else {
          // Log less frequently when no clients - only every 10th frame
          if (this.stats.framesProcessed % 10 === 0) {
            this.logger.debug(
              `Received video data event for ${event.serialNumber}: ${event.buffer.data.length} bytes (no active clients, frame ${this.stats.framesProcessed})`,
            );
          }
        }

        // Convert JSONBuffer to Buffer if needed
        const videoBuffer = Buffer.isBuffer(event.buffer.data)
          ? event.buffer.data
          : Buffer.from(event.buffer.data);

        // Fan-out to muxer clients (fMP4 via in-process JMuxer). Update
        // the activity clock so the inactivity timer doesn't kill the
        // livestream while muxer clients are actively consuming it.
        if (this.muxerStreams.size > 0) {
          this.lastClientActivity = Date.now();
          for (const { muxer } of this.muxerStreams.values()) {
            try {
              muxer.feed({ video: videoBuffer });
            } catch (e) {
              this.logger.warn(`Muxer video feed error: ${e}`);
            }
          }
        }

        // Stream the video data to raw TCP clients (snapshot service,
        // direct-video stream consumers).
        this.streamVideo(videoBuffer, Date.now(), undefined);
      },
      {
        source: "device",
        serialNumber: this.options.serialNumber,
      },
    );

    this.logger.info(
      `WebSocket listener setup complete for device: ${this.options.serialNumber}`,
    );

    // Listen for livestream audio data events
    let audioFrameCount = 0;
    this.audioEventRemover = this.options.wsClient.addEventListener(
      DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA,
      (event) => {
        if (event.serialNumber !== this.options.serialNumber) {
          return;
        }

        if (!this.audioMetadata && event.metadata) {
          this.audioMetadata = event.metadata;
          this.logger.info(
            `Captured audio metadata: codec=${event.metadata.audioCodec}`,
          );
        }

        const audioBuffer = Buffer.isBuffer(event.buffer.data)
          ? event.buffer.data
          : Buffer.from(event.buffer.data);

        if (audioFrameCount < 3) {
          const hex = audioBuffer
            .subarray(0, Math.min(16, audioBuffer.length))
            .toString("hex");
          this.logger.debug(
            `Audio frame #${audioFrameCount}: ${audioBuffer.length} bytes, first bytes: ${hex}`,
          );
          audioFrameCount++;
        }

        // Eufy delivers AAC pre-wrapped in ADTS — JMuxer consumes ADTS
        // directly. Anything else (e.g. AudioSpecificConfig, the 2-byte codec
        // config packet that arrives ahead of the first frame) is dropped
        // because synthesizing an ADTS header without the real sample
        // rate/channel count would produce a stream the decoder misinterprets.
        const isAdts = this.isAdtsFrame(audioBuffer);

        // Only a real ADTS frame counts as "this camera delivers audio". JMuxer
        // `both` mode never emits a byte until it has an actual audio SAMPLE, so
        // a camera that sends audio events but no usable ADTS (seen on some
        // models — only the config packet arrives) would hang the muxer forever
        // and the live view would stay black. Gating on ADTS means such a camera
        // is detected as video-only and muxed in `video` mode instead. Set this
        // before the no-muxer early-return so detection works even when the
        // first ADTS frame arrives before any muxer client has attached.
        if (isAdts) this.deliversAudio = true;

        if (this.muxerStreams.size === 0) {
          return;
        }

        if (!isAdts) {
          return;
        }

        for (const { muxer } of this.muxerStreams.values()) {
          try {
            muxer.feed({ audio: audioBuffer });
          } catch (e) {
            this.logger.warn(`Muxer audio feed error: ${e}`);
          }
        }
      },
      {
        source: "device",
        serialNumber: this.options.serialNumber,
      },
    );
  }

  /**
   * ADTS sync word check. Bytes 0..1 must be 0xFFFx (12-bit sync).
   */
  private isAdtsFrame(data: Buffer): boolean {
    return data.length >= 7 && data[0] === 0xff && (data[1] & 0xf0) === 0xf0;
  }

  /**
   * Called by the device layer around a station P2P recycle.
   *
   * When set to `true`, defers further `startLivestream` commands (see
   * the comment on `recycleInFlight`). When cleared to `false`, if
   * consumers are still attached, re-trigger `ensureLivestreamState` so
   * the user automatically gets a stream as soon as the bropat P2P
   * session is back up — they don't have to retry HomeKit.
   *
   * Safe to call multiple times with the same value; only state
   * transitions perform work.
   */
  setRecycleInFlight(value: boolean): void {
    if (this.recycleInFlight === value) return;
    this.recycleInFlight = value;

    if (value) {
      this.logger.info(
        "🧊 Stream server entering recycle-in-flight state — startLivestream deferred",
      );
      return;
    }

    const totalConsumers = this.getTotalConsumers();

    this.logger.info(
      `🔥 Stream server exiting recycle-in-flight state (consumers: ${totalConsumers})`,
    );

    if (totalConsumers > 0) {
      // Consumers are waiting on a stream that we deferred. Re-arm
      // intent and kick off a fresh start. The counter was already
      // cleared by markUpstreamWedged so this attempt starts clean.
      this.livestreamIntendedState = true;
      this.lastClientActivity = Date.now();
      this.startActivityMonitoring();
      this.ensureLivestreamState().catch((e) =>
        this.logger.warn(`Post-recycle ensureLivestreamState failed: ${e}`),
      );
    }
  }

  /**
   * Signal that the upstream P2P session is wedged. Two callers:
   *  - cold-start: `consecutiveNoDataStarts` reached `MAX_NO_DATA_STARTS`
   *    (3 fresh `startLivestream` attempts produced zero video bytes).
   *  - mid-session: data was flowing, then stopped for more than
   *    `STALE_DATA_THRESHOLD_MS` while consumers still want a stream.
   *
   * Resets every piece of state that could cause us to keep poking the
   * upstream: livestream intent, the cold-start counter, the data-flow
   * watchdog, and the in-flight start/stop timeout. We deliberately do
   * NOT auto-restart — the listener (eufy-device.ts) recycles the bropat
   * station P2P session, and the next consumer that attaches will trigger
   * a fresh livestream organically. This keeps the camera from being
   * woken unnecessarily when no one is actually watching.
   */
  private markUpstreamWedged(
    reason: "cold-start-counter-maxed" | "data-flow-stale",
    detail: { attempts?: number; staleMs?: number; consumers?: number },
  ): void {
    if (reason === "cold-start-counter-maxed") {
      this.logger.error(
        `❌ Giving up after ${detail.attempts} consecutive startLivestream attempts with no data — upstream P2P (HomeBase/station) appears wedged. Will not auto-retry until a fresh consumer attaches.`,
      );
    } else {
      this.logger.error(
        `❌ Mid-session wedge: ${detail.staleMs}ms since last video data while ${detail.consumers} consumer(s) attached — upstream P2P appears wedged. Will not auto-retry until a fresh consumer attaches.`,
      );
    }

    this.livestreamIntendedState = false;
    this.setLivestreamActual(false);
    this.releaseStreamSlot();
    this.consecutiveNoDataStarts = 0;
    this.lastVideoDataAt = 0;
    this.livestreamSessionStartedAt = 0;
    this.cancelPostSnapshotLinger("upstream wedged");
    if (this.startStopTimeout) {
      clearTimeout(this.startStopTimeout);
      this.startStopTimeout = undefined;
    }

    this.emit("upstreamWedged", {
      serialNumber: this.options.serialNumber,
      reason,
      ...detail,
    });
    this.emit(
      "streamError",
      new Error(
        reason === "cold-start-counter-maxed"
          ? "Upstream livestream not delivering data after multiple attempts"
          : "Upstream livestream stopped delivering data mid-session",
      ),
    );
  }

  /** Release our HomeBase stream-slot lease, if held. Idempotent. */
  private releaseStreamSlot(): void {
    if (this.streamLease) {
      this.streamLease.release();
      this.streamLease = null;
    }
    this.streamLeasePriority = null;
  }

  /**
   * Invoked (synchronously, by the coordinator) when a higher-priority camera
   * on the same HomeBase preempts our slot. Stop our livestream and stay down
   * — WITHOUT recycling, since this is contention, not a wedge — until our own
   * consumers drain. The slot already belongs to the preemptor at this point.
   */
  private handleSlotRevoked(): void {
    if (this.slotRevoked) return;
    this.logger.info(
      "↩️  HomeBase stream slot revoked by another camera — yielding",
    );
    this.slotRevoked = true;
    if (this.warmLease) this.endWarmLease("slot revoked", false);
    this.livestreamIntendedState = false;
    // Stop our P2P livestream FIRST, then release the slot — do NOT release
    // synchronously here. The preemptor's `whenReady` is gated on our release,
    // so releasing before our stream has actually stopped lets the preemptor
    // call `startLivestream` while our P2P is still up. On the one-stream-at-a-
    // time HomeBase that overlap starves the handoff: the preemptor gets a
    // frame or two (enough for metadata) and then stalls, while our redundant
    // stop races its start (`device_livestream_not_running`). Deferring the
    // release until after our stop completes (in `ensureLivestreamState`'s stop
    // branch, with the `finally` as a backstop for the already-stopped case)
    // makes it a clean staggered handoff: we stop → free the HomeBase → the
    // preemptor starts on an idle station. `whenReady`'s timeout still bounds
    // the preemptor's wait if our stop hangs.
    void this.ensureLivestreamState()
      .catch((e) =>
        this.logger.warn(`Post-revoke ensureLivestreamState failed: ${e}`),
      )
      .finally(() => this.releaseStreamSlot());
  }

  /**
   * Update whether the livestream is actually delivering video, emitting a
   * `livestreamActive` / `livestreamInactive` transition event (with the
   * device serial) when it changes. Consumers (eufy-device.ts) use these to
   * maintain the cross-camera station-stream registry that gates P2P
   * recycles. Idempotent — emits only on an actual state change.
   */
  private setLivestreamActual(active: boolean): void {
    if (this.livestreamActualState === active) return;
    this.livestreamActualState = active;
    if (active) {
      // We're delivering video now — protect our HomeBase slot from being
      // preempted by another camera's (e.g. grid-preview) live request.
      this.streamLease?.markDelivering();
    }
    this.emit(active ? "livestreamActive" : "livestreamInactive", {
      serialNumber: this.options.serialNumber,
    });
  }

  /**
   * Ensure the livestream is in the correct state with retry logic
   */
  private async ensureLivestreamState(): Promise<void> {
    // Clear any existing timeout
    if (this.startStopTimeout) {
      clearTimeout(this.startStopTimeout);
      this.startStopTimeout = undefined;
    }

    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // First, check the actual livestream status from the device
        let actualStreamingStatus = false;
        try {
          const statusResponse = await this.options.wsClient.commands
            .device(this.options.serialNumber)
            .isLivestreaming();
          actualStreamingStatus = statusResponse.livestreaming;
          this.logger.debug(
            `Current device livestream status: ${actualStreamingStatus}`,
          );
        } catch (error: any) {
          this.logger.warn(
            "Failed to check livestream status, continuing with command:",
            error.message || error,
          );
        }

        // Maintain the station grant independently of bropat's status. A
        // real consumer can take over a background warm stream while bropat
        // still reports it running; it nevertheless needs a live-priority
        // lease before that stream is allowed to continue.
        if (
          this.livestreamIntendedState &&
          !this.slotRevoked &&
          !this.recycleInFlight &&
          this.options.acquireStreamSlot
        ) {
          const priority = this.getDesiredStreamSlotPriority();
          if (
            this.streamLease?.active &&
            this.streamLeasePriority !== priority
          ) {
            this.releaseStreamSlot();
          }
          if (!this.streamLease?.active) {
            const lease = this.options.acquireStreamSlot(priority, () =>
              this.handleSlotRevoked(),
            );
            if (!lease) {
              this.logger.info(
                `⛔ HomeBase stream slot busy — deferring ${priority} start`,
              );
              this.livestreamIntendedState = false;
              break;
            }
            this.logger.info(`🎟️  Acquired HomeBase stream slot (${priority})`);
            this.streamLease = lease;
            this.streamLeasePriority = priority;
            await lease.whenReady;
            if (!this.livestreamIntendedState || this.slotRevoked) break;
          }
        }

        if (this.livestreamIntendedState && !actualStreamingStatus) {
          // Defer if a station P2P recycle is in flight — startLivestream
          // sent during the recovery window typically lands on a station
          // that bropat hasn't finished re-connecting, wasting the attempt
          // and (worse) burning a slot in the cold-start counter. The
          // recycle handler will re-arm the livestream when it completes
          // if consumers are still waiting.
          if (this.recycleInFlight) {
            this.logger.info(
              "⏸️  Deferring startLivestream — station P2P recycle is in flight",
            );
            break;
          }

          // Stop hammering a wedged upstream. After MAX_NO_DATA_STARTS
          // consecutive startLivestream commands without ever receiving
          // video data, give up and signal an upstream wedge.
          if (this.consecutiveNoDataStarts >= this.MAX_NO_DATA_STARTS) {
            this.markUpstreamWedged("cold-start-counter-maxed", {
              attempts: this.consecutiveNoDataStarts,
            });
            break;
          }

          // If a higher-priority camera on this HomeBase preempted us, stay
          // down until our own consumers drain — don't fight for the slot.
          if (this.slotRevoked) {
            this.logger.info(
              "⏸️  Slot revoked by another camera on this HomeBase — not starting until consumers drain",
            );
            break;
          }

          // Need to start livestream
          this.consecutiveNoDataStarts++;
          this.livestreamSessionStartedAt = Date.now();
          this.logger.info(
            `🎥 Starting livestream (attempt ${attempt}/${maxRetries}, consecutive-no-data=${this.consecutiveNoDataStarts}/${this.MAX_NO_DATA_STARTS})`,
          );
          this.beginMetadataSession();
          await this.options.wsClient.commands
            .device(this.options.serialNumber)
            .startLivestream();
          this.logger.info("✅ Livestream start command sent successfully");

          // Wait the full cold-start window before re-evaluating. A
          // deeply-idle battery camera can legitimately take 30–45s to wake
          // and deliver its first frame, so checking sooner just provokes a
          // premature re-send/recycle. With MAX_NO_DATA_STARTS=1 this
          // re-entry will conclude the upstream is wedged (no data after a
          // full window) and hand off to the station P2P recycle.
          this.startStopTimeout = setTimeout(() => {
            if (this.livestreamIntendedState && !this.livestreamActualState) {
              this.logger.warn(
                `⚠️ No video data ${this.COLD_START_STALE_THRESHOLD_MS / 1000}s after startLivestream — escalating to wedge/recycle`,
              );
              this.ensureLivestreamState();
            }
          }, this.COLD_START_STALE_THRESHOLD_MS);
        } else if (this.livestreamIntendedState && actualStreamingStatus) {
          // Stream is already running and we want it running - all good.
          // Set the session anchor if it's not already set so the
          // mid-session watchdog can fire on the "zombie already-running"
          // case (bropat reports streaming but no LIVESTREAM_VIDEO_DATA
          // events ever arrive — no startLivestream command means no
          // cold-start counter increment to catch it the other way).
          if (this.livestreamSessionStartedAt === 0) {
            this.livestreamSessionStartedAt = Date.now();
            this.beginMetadataSession();
            this.logger.info(
              "📡 Bropat reports livestream already active — anchoring session for wedge watchdog",
            );
          } else {
            this.logger.debug("Livestream already running as desired");
          }
        } else if (!this.livestreamIntendedState && actualStreamingStatus) {
          // Need to stop livestream
          this.logger.info(
            `🛑 Stopping livestream (attempt ${attempt}/${maxRetries})`,
          );
          await this.options.wsClient.commands
            .device(this.options.serialNumber)
            .stopLivestream();
          this.logger.info("✅ Livestream stop command sent successfully");
          this.setLivestreamActual(false);
          this.releaseStreamSlot();
          // Clear the stale-data watchdog timestamp on graceful stop so
          // the next session's watchdog starts fresh (won't false-fire
          // from a previous session's last-data timestamp).
          this.lastVideoDataAt = 0;
          this.livestreamSessionStartedAt = 0;
        } else {
          // Stream is not running and we don't want it running - all good.
          // Still flip actual→false: bropat may have stopped the stream on
          // its own (so we never hit the explicit stop branch above), and
          // leaving `livestreamActualState` stuck true would leak a stale
          // "active" entry into the cross-camera station registry.
          this.setLivestreamActual(false);
          this.releaseStreamSlot();
          this.logger.debug("Livestream already stopped as desired");
        }

        // Success - break out of retry loop
        break;
      } catch (error: any) {
        // Stopping a stream that isn't actually running is a no-op success,
        // not a failure. This happens when we yield/stop a camera that was
        // told to start but never delivered (e.g. a preempted dead camera):
        // bropat reports it "livestreaming" but stop_livestream then fails
        // with device_livestream_not_running. Treat it as already stopped.
        const msg = String(error?.message || error);
        if (msg.includes("device_livestream_not_running")) {
          this.logger.info(
            "Livestream already stopped upstream (not running) — treating as success",
          );
          this.setLivestreamActual(false);
          this.releaseStreamSlot();
          this.lastVideoDataAt = 0;
          this.livestreamSessionStartedAt = 0;
          break;
        }

        this.logger.warn(
          `❌ Livestream command failed (attempt ${attempt}/${maxRetries}):`,
          error.message || error,
        );

        if (attempt === maxRetries) {
          this.logger.error(
            `❌ Failed to set livestream state after ${maxRetries} attempts`,
          );
          this.emit("streamError", error);
        } else {
          // Wait before retrying
          this.logger.info(`⏳ Retrying in ${retryDelay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }
  }

  /**
   * Start the TCP server
   */
  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error("Server is already running");
    }

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer();

      this.server.on("connection", (socket) => {
        this.connectionManager.handleConnection(socket);
      });

      this.server.on("error", (error) => {
        this.logger.error("Server error:", error);
        this.emit("error", error);
        reject(error);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        this.isActive = true;
        this.startTime = new Date();
        this.logger.info(
          `🚀 Stream server started on ${this.options.host}:${this.options.port}`,
        );
        this.emit("started");
        resolve();
      });
    });

    // Start muxed server — each client connection gets its own in-process
    // JMuxer that produces fragmented MP4 directly from the camera's raw
    // H.264 + ADTS AAC frames. No ffmpeg subprocess, no audio re-encoding.
    await new Promise<void>((resolve, reject) => {
      this.muxedServer = net.createServer((socket) => {
        this.handleMuxedClient(socket);
      });

      let started = false;
      this.muxedServer.on("error", (error) => {
        if (!started) {
          reject(error);
        } else {
          this.logger.error(`Muxed server runtime error: ${error}`);
          this.emit("error", error);
        }
      });

      this.muxedServer.listen(0, "127.0.0.1", () => {
        started = true;
        const address = this.muxedServer!.address();
        const port =
          address && typeof address === "object" ? address.port : "?";
        this.logger.info(`Muxed (fMP4) server started on port ${port}`);
        resolve();
      });
    });
  }

  /**
   * Handle a new connection to the muxed TCP server. Each client gets its
   * own in-process JMuxer instance that consumes raw H.264 NAL units and
   * ADTS AAC frames directly from the WebSocket events (no TCP detour,
   * no ffmpeg subprocess) and emits fragmented MP4 on the socket. This is
   * meaningfully faster than the previous ffmpeg-subprocess approach and
   * matches what the Eufy cameras actually deliver byte-for-byte.
   */
  private async handleMuxedClient(socket: net.Socket): Promise<void> {
    // Mark this socket as a pending consumer immediately so the upstream
    // livestream starts even though we don't yet have a JMuxer to feed.
    // `updateLivestreamStateForMuxerClients` counts both pending and active
    // muxers as consumers.
    this.pendingMuxerSockets.add(socket);
    this.notifyNextConsumerAttached();

    const pendingCleanup = () => {
      this.pendingMuxerSockets.delete(socket);
    };
    socket.on("close", pendingCleanup);
    socket.on("error", pendingCleanup);

    // A pending muxer client owns a metadata waiter. If its downstream
    // socket disappears before the first frame arrives, abort that waiter
    // immediately instead of retaining it until the 60s metadata timeout.
    const metadataWaitAbortController = new AbortController();
    this.pendingMetadataWaitAbortControllers.set(
      socket,
      metadataWaitAbortController,
    );
    const cancelMetadataWait = () => metadataWaitAbortController.abort();
    socket.once("close", cancelMetadataWait);
    socket.once("error", cancelMetadataWait);

    // Kick off the upstream livestream (no-op if already running).
    this.updateLivestreamStateForMuxerClients();

    // Wait for the codec to be known via the first video event's metadata.
    // Defaults to H.264 if the camera/stream never delivers metadata in
    // time — matches the previous (silently-wrong-for-H.265) behaviour
    // rather than dropping the client.
    // Default to the construction-time hint (persisted from the last
    // detected codec for this device). Without this, the muxer would
    // build an avcC sample description (H.264) for an H.265 camera that
    // happens to time out the metadata wait — producing un-decodable
    // fMP4 the moment H.265 data does arrive. Falls back to H.264 only
    // if there's no hint either.
    let videoCodec: "H264" | "H265" = this.hintedVideoCodec ?? "H264";
    try {
      // 60s — battery cameras (T8170 S340 sleep mode, T86P2 4G LTE cold-start)
      // can take 30–45s to deliver their first IDR after startLivestream.
      const metadata = await this.waitForVideoMetadata(60000, {
        signal: metadataWaitAbortController.signal,
      });
      const c = metadata.videoCodec.toUpperCase();
      videoCodec = c === "H265" || c === "HEVC" ? "H265" : "H264";
    } catch (e) {
      if (!metadataWaitAbortController.signal.aborted) {
        this.logger.warn(
          `Muxer client: timed out waiting for video metadata, falling back to hinted codec ${videoCodec}. ${e}`,
        );
      }
    } finally {
      socket.removeListener("close", cancelMetadataWait);
      socket.removeListener("error", cancelMetadataWait);
      this.pendingMetadataWaitAbortControllers.delete(socket);
    }

    // Socket may have given up while we waited.
    if (socket.destroyed || !this.pendingMuxerSockets.has(socket)) {
      this.pendingMuxerSockets.delete(socket);
      return;
    }

    const videoFps = this.videoMetadata?.videoFPS ?? 15;

    // Pick the muxer mode by whether this camera actually delivers audio.
    // JMuxer `both` will not emit a single fMP4 byte until BOTH the video
    // AND audio tracks have a sample (remux `isReady()`), so a mic-off,
    // video-only camera muxed as `both` hangs forever and the downstream
    // ffmpeg dies with "timeout waiting for data" — live view never starts.
    //
    // If we've already seen audio from this device, use `both`. If we know
    // it's video-only, use `video`. If we don't know yet (first stream,
    // muxer connects before the first audio frame), briefly wait for an
    // audio frame now that video is confirmed flowing — a mic-on camera
    // delivers audio within ~1-2s of video; if none arrives, it's video-only.
    // The socket stays in `pendingMuxerSockets` during this wait so it still
    // counts as a consumer (keeping the livestream alive).
    if (this.deliversAudio === undefined) {
      const audioDeadline = Date.now() + 2500;
      while (Date.now() < audioDeadline && this.deliversAudio === undefined) {
        if (socket.destroyed) {
          this.pendingMuxerSockets.delete(socket);
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (this.deliversAudio === undefined) this.deliversAudio = false;
    }

    // Now graduate the socket from pending → active muxer.
    this.pendingMuxerSockets.delete(socket);
    const mode: "both" | "video" = this.deliversAudio ? "both" : "video";
    this.logger.info(
      `Muxer mode=${mode} (deliversAudio=${this.deliversAudio}) for ${this.options.serialNumber}`,
    );

    let emittedFirstChunk = false;
    let bothFallbackTimer: ReturnType<typeof setTimeout> | undefined;

    // Build (or rebuild) the JMuxer for this socket in the given mode and wire
    // its output to the socket. Replacing the entry in `muxerStreams` is how the
    // `both`→`video` fallback swaps modes without dropping the client.
    const buildMuxer = (useMode: "both" | "video"): void => {
      const muxer = new JMuxer({
        mode: useMode,
        videoCodec,
        fps: videoFps,
        flushingTime: 0,
        clearBuffer: false,
        debug: false,
      });
      const duplex: Duplex = muxer.createStream();
      duplex.on("data", (chunk: Buffer) => {
        if (!emittedFirstChunk) {
          emittedFirstChunk = true;
          if (bothFallbackTimer) {
            clearTimeout(bothFallbackTimer);
            bothFallbackTimer = undefined;
          }
          this.logger.info(
            `JMuxer emitting fMP4 (first chunk: ${chunk.length} bytes, mode=${useMode}, codec=${videoCodec}, fps=${videoFps})`,
          );
        }
        if (!socket.destroyed) socket.write(chunk);
      });
      duplex.on("error", (err) => {
        this.logger.warn(`JMuxer duplex error: ${err.message}`);
      });
      this.muxerStreams.set(socket, { muxer, duplex });
    };

    buildMuxer(mode);
    this.logger.info(
      `Muxed client attached (codec=${videoCodec}, total active muxers: ${this.muxerStreams.size})`,
    );

    // `both` mode never emits a single fMP4 byte until JMuxer has BOTH a video
    // keyframe and an audio sample (remux `isReady()`). Some cameras report
    // audio (a stray ADTS frame flips `deliversAudio`) but don't actually
    // deliver a continuous audio track once muxing starts — so `both` waits
    // forever and the live view stays black. Guarantee video by rebuilding the
    // muxer video-only if no output appears shortly. Video-capable cameras with
    // real audio emit in well under this window, so they keep their audio.
    if (mode === "both") {
      bothFallbackTimer = setTimeout(() => {
        bothFallbackTimer = undefined;
        if (emittedFirstChunk || socket.destroyed) return;
        if (!this.muxerStreams.has(socket)) return;
        this.logger.warn(
          `Muxer 'both' produced no fMP4 in ${this.BOTH_TO_VIDEO_FALLBACK_MS}ms — rebuilding video-only for ${this.options.serialNumber} (camera reports audio but isn't delivering a usable track)`,
        );
        const existing = this.muxerStreams.get(socket);
        try {
          existing?.muxer.destroy();
        } catch {
          // ignore — being replaced anyway
        }
        buildMuxer("video");
      }, this.BOTH_TO_VIDEO_FALLBACK_MS);
    }

    // Re-evaluate consumer state now that the socket moved from pending →
    // active. No-op if the livestream is already running.
    this.updateLivestreamStateForMuxerClients();

    const cleanup = () => {
      if (bothFallbackTimer) {
        clearTimeout(bothFallbackTimer);
        bothFallbackTimer = undefined;
      }
      const existing = this.muxerStreams.get(socket);
      if (!existing) return;
      this.muxerStreams.delete(socket);
      try {
        existing.muxer.destroy();
      } catch (e) {
        this.logger.warn(`JMuxer destroy threw during cleanup: ${e}`);
      }
      this.logger.info(
        `Muxed client detached (total active muxers: ${this.muxerStreams.size})`,
      );
      this.updateLivestreamStateForMuxerClients();
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  /**
   * Start or stop the upstream livestream based on total consumer count
   * (TCP video clients + in-process muxer clients). Called on every
   * muxer-client attach/detach.
   */
  private cancelPostSnapshotLinger(reason: string): void {
    if (this.postSnapshotLingerTimer) {
      clearTimeout(this.postSnapshotLingerTimer);
      this.postSnapshotLingerTimer = undefined;
      this.logger.debug(`Cancelled post-snapshot linger: ${reason}`);
    }
  }

  private async updateLivestreamStateForMuxerClients(): Promise<void> {
    const totalConsumers = this.getTotalConsumers();

    // A consumer is attaching (or detaching). If we were lingering after a
    // snapshot waiting for exactly this, cancel — the consumer's own
    // lifecycle now governs the livestream.
    if (totalConsumers > 0) {
      this.cancelPostSnapshotLinger("consumer attached");
    } else if (this.slotRevoked) {
      // Our consumers have all drained after a preemption — reset so a future
      // viewer can start fresh (and re-take the slot, newest-wins).
      this.slotRevoked = false;
      this.logger.debug("Consumers drained after slot revoke — cleared");
    }

    // While preempted, stay down despite a reconnecting consumer — don't fight
    // the camera that took the HomeBase slot.
    if (
      totalConsumers > 0 &&
      !this.livestreamIntendedState &&
      !this.slotRevoked
    ) {
      this.livestreamIntendedState = true;
      this.lastClientActivity = Date.now();
      this.startActivityMonitoring();
      await this.ensureLivestreamState();
    } else if (
      totalConsumers > 0 &&
      this.livestreamIntendedState &&
      !this.slotRevoked &&
      (!this.streamLease?.active ||
        this.streamLeasePriority !== this.getDesiredStreamSlotPriority())
    ) {
      await this.ensureLivestreamState();
    }
    // Intentionally *not* stopping the livestream the moment consumer
    // count drops to 0. Scrypted's Rebroadcast plugin cycles its muxer
    // connection constantly — closes the old one, immediately opens a
    // new one for the next session. Tearing down the Eufy livestream on
    // every disconnect meant the new muxer connected to a cold pipeline,
    // and the downstream FFmpeg would hit "Unable to find sync frame in
    // rtsp prebuffer" until the next camera keyframe (2-4s).
    //
    // The activity monitor handles the genuine "everyone left" case: if
    // no data flows for ACTIVITY_TIMEOUT ms it stops the livestream
    // (lastClientActivity only advances while a consumer is reading).
  }

  /**
   * Get the port the muxed (MPEG-TS) server is listening on.
   */
  getMuxedPort(): number | undefined {
    if (this.muxedServer) {
      const address = this.muxedServer.address();
      if (address && typeof address === "object") {
        return address.port;
      }
    }
    return undefined;
  }

  /**
   * Stop the TCP server
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    // Clear any pending timeouts
    if (this.startStopTimeout) {
      clearTimeout(this.startStopTimeout);
      this.startStopTimeout = undefined;
    }
    this.cancelPostSnapshotLinger("server stopping");
    if (this.warmLease) {
      clearTimeout(this.warmLease.timer);
      this.warmLease = undefined;
      this.metadataBootstrapConsumers--;
    }

    // Stop activity monitoring
    this.stopActivityMonitoring();

    // Stop the upstream livestream if we intended it to run. Gate on intent,
    // not on raw TCP client count — the normal HomeKit path attaches only
    // muxed-port consumers (zero raw TCP clients), and skipping the stop for
    // them left the camera streaming after a plugin reload/shutdown until
    // the upstream idled it out (battery drain on every restart).
    if (this.livestreamIntendedState) {
      this.livestreamIntendedState = false;
      await this.ensureLivestreamState();
    }

    // Guarantee the registry sees this device as no longer streaming, even
    // if the teardown above didn't traverse the graceful-stop branch.
    this.setLivestreamActual(false);
    this.releaseStreamSlot();

    // Clean up WebSocket event listeners
    if (this.eventRemover) {
      this.eventRemover();
      this.eventRemover = undefined;
      this.logger.debug("WebSocket video event listener removed");
    }

    if (this.audioEventRemover) {
      this.audioEventRemover();
      this.audioEventRemover = undefined;
      this.logger.debug("WebSocket audio event listener removed");
    }

    // Tear down all in-process muxers and disconnect their clients
    for (const [socket, { muxer }] of this.muxerStreams) {
      try {
        muxer.destroy();
      } catch (e) {
        this.logger.warn(`JMuxer destroy threw during shutdown: ${e}`);
      }
      if (!socket.destroyed) socket.destroy();
    }
    this.muxerStreams.clear();

    // Also close any muxer clients still waiting for first-frame metadata
    // and synchronously cancel their waits before `stop()` resolves. Socket
    // close events are asynchronous, so relying on them alone leaks waiters
    // across the shutdown boundary.
    for (const controller of this.pendingMetadataWaitAbortControllers.values()) {
      controller.abort();
    }
    this.pendingMetadataWaitAbortControllers.clear();
    for (const socket of this.pendingMuxerSockets) {
      if (!socket.destroyed) socket.destroy();
    }
    this.pendingMuxerSockets.clear();

    // Close muxed server
    if (this.muxedServer) {
      this.muxedServer.close();
      this.muxedServer = undefined;
    }

    return new Promise((resolve) => {
      this.connectionManager.close();

      if (this.server) {
        this.server.close(() => {
          this.isActive = false;
          this.logger.info("🛑 Stream server stopped");
          this.emit("stopped");
          resolve();
        });
      } else {
        this.isActive = false;
        resolve();
      }
    });
  }

  /**
   * Stream raw H.264 video data to all connected clients
   *
   * @param data - Raw H.264 video data buffer
   * @param timestamp - Optional timestamp in milliseconds
   * @param isKeyFrame - Optional flag indicating if this is a key frame
   * @returns Promise<boolean> - True if data was successfully processed
   */
  async streamVideo(
    data: Buffer,
    timestamp?: number,
    isKeyFrame?: boolean,
  ): Promise<boolean> {
    if (!data || data.length === 0) {
      this.logger.warn("Cannot stream empty video data");
      return false;
    }

    const isHevc =
      this.videoMetadata?.videoCodec.toUpperCase() === "H265" ||
      this.videoMetadata?.videoCodec.toUpperCase() === "HEVC";

    try {
      // Single NAL scan per frame: extraction doubles as validation (an
      // empty result means no valid Annex-B structure). This runs for
      // every video event, so avoid scanning the buffer twice.
      const nalUnits = isHevc
        ? this.h264Parser.extractNALUnitsHevc(data)
        : this.h264Parser.extractNALUnits(data);

      if (nalUnits.length === 0) {
        this.logger.warn(
          `Invalid ${isHevc ? "H.265" : "H.264"} data structure`,
        );
        return false;
      }

      if (isKeyFrame === undefined) {
        isKeyFrame = nalUnits.some((nal) => nal.isKeyFrame);
      }

      // Log NAL unit information for debugging. Building the NAL-name
      // string allocates per frame, so only do it when debug logging is
      // actually enabled (tslog: 0=silly … 2=debug … 3=info).
      if ((this.logger.settings?.minLevel ?? 3) <= 2) {
        const nalInfo = nalUnits
          .map((nal) =>
            isHevc
              ? `${this.h264Parser.getNALTypeNameHevc(nal.type)}(${nal.type})`
              : `${this.h264Parser.getNALTypeName(nal.type)}(${nal.type})`,
          )
          .join(", ");
        this.logger.debug(
          `Processing ${isHevc ? "H.265" : "H.264"} data: ${data.length} bytes, NALs: [${nalInfo}], keyFrame: ${isKeyFrame}`,
        );
      }

      // Cache parameter-set NAL units so new clients can decode mid-stream.
      // H.264: SPS=7, PPS=8   H.265: VPS=32, SPS=33, PPS=34
      //
      // Cache the individual NAL (re-framed with a start code), NOT the whole
      // event buffer. Eufy usually bundles the parameter sets with the IDR in
      // one event; caching the full event would put a stale keyframe inside
      // every cache slot — new clients would receive old frames ahead of the
      // live stream, and the snapshot prepend path would place an old IDR
      // before the fresh one (ffmpeg decodes the FIRST picture it finds).
      nalUnits.forEach((nal) => {
        const framedNal = () =>
          Buffer.concat([StreamServer.ANNEX_B_START_CODE, nal.data]);
        if (!isHevc && nal.type === 7) {
          this.cachedSPS = framedNal();
          this.logger.debug(
            `Cached H.264 SPS (${this.cachedSPS.length} bytes)`,
          );
        } else if (!isHevc && nal.type === 8) {
          this.cachedPPS = framedNal();
          this.logger.debug(
            `Cached H.264 PPS (${this.cachedPPS.length} bytes)`,
          );
        } else if (isHevc && nal.type === 32) {
          this.cachedVPS = framedNal();
          this.logger.debug(
            `Cached H.265 VPS (${this.cachedVPS.length} bytes)`,
          );
        } else if (isHevc && nal.type === 33) {
          this.cachedSPS = framedNal();
          this.logger.debug(
            `Cached H.265 SPS (${this.cachedSPS.length} bytes)`,
          );
        } else if (isHevc && nal.type === 34) {
          this.cachedPPS = framedNal();
          this.logger.debug(
            `Cached H.265 PPS (${this.cachedPPS.length} bytes)`,
          );
        }
      });

      // Resolve any pending snapshot requests with keyframe data.
      // Snapshot requests need a decodable picture, so parameter-set-only
      // events (H.264 SPS/PPS or H.265 VPS/SPS/PPS without an IRAP slice)
      // don't qualify — FFmpeg can't produce a JPEG from those alone.
      // H.264: require IDR (type 5).  H.265: require an IRAP slice
      // (types 16–23: BLA/IDR/CRA and reserved IRAP).
      //
      // This happens BEFORE checking if server is active, so snapshots
      // work without TCP server.
      const hasSnapshotKeyframe = isHevc
        ? nalUnits.some((nal) => nal.type >= 16 && nal.type <= 23)
        : nalUnits.some((nal) => nal.type === 5);
      let snapshotsHandled = false;
      if (hasSnapshotKeyframe) {
        // Build a self-contained, decodable bitstream for the JPEG
        // converter. H.265 IDR slices reference VPS/SPS/PPS by ID — without
        // those parameter sets in the same buffer, ffmpeg can't decode and
        // produces a malformed JPEG that Scrypted renders as a broken
        // image icon. We prepend the cached parameter sets unless they're
        // already present in this data event (Eufy sometimes bundles
        // them, sometimes delivers them as separate prior events).
        const types = new Set(nalUnits.map((n) => n.type));
        const parts: Buffer[] = [];
        if (isHevc) {
          if (!types.has(32) && this.cachedVPS) parts.push(this.cachedVPS);
          if (!types.has(33) && this.cachedSPS) parts.push(this.cachedSPS);
          if (!types.has(34) && this.cachedPPS) parts.push(this.cachedPPS);
        } else {
          if (!types.has(7) && this.cachedSPS) parts.push(this.cachedSPS);
          if (!types.has(8) && this.cachedPPS) parts.push(this.cachedPPS);
        }
        const snapshotPayload =
          parts.length > 0 ? Buffer.concat([...parts, data]) : data;

        // Retain this keyframe for cache-served snapshots/thumbnails. This
        // fires for EVERY keyframe regardless of whether a snapshot is
        // pending, so the cache refreshes for free whenever the camera is
        // already awake (live view, HKSV, motion, or a prior snapshot).
        this.lastKeyframe = {
          data: snapshotPayload,
          codec: isHevc ? "H265" : "H264",
          timestamp: Date.now(),
        };

        // Resolve any pending snapshot requests with the same decodable buffer.
        if (this.snapshotResolvers.length > 0) {
          this.logger.debug(
            `Resolving ${this.snapshotResolvers.length} snapshot request(s) with keyframe data`,
          );
          if (parts.length > 0) {
            this.logger.debug(
              `Prepended ${parts.length} parameter set(s) to snapshot keyframe (${snapshotPayload.length} bytes total)`,
            );
          }
          const resolvers = [...this.snapshotResolvers];
          this.snapshotResolvers = [];
          resolvers.forEach(({ resolve }) => resolve(snapshotPayload));
          snapshotsHandled = true;
        }
      }

      // If server is not active, we've already handled snapshot resolution above
      // Return success only if snapshots were handled, otherwise return false
      if (!this.isActive) {
        if (snapshotsHandled) {
          this.stats.framesProcessed++;
          return true; // Return true because snapshot was handled successfully
        } else {
          return false; // Server not active and no snapshots to handle
        }
      }

      // Broadcast to all connected clients
      const success = this.connectionManager.broadcast(data);

      // Update client activity timestamp when data is successfully sent
      if (success) {
        this.lastClientActivity = Date.now();
      }

      // Update statistics
      this.stats.framesProcessed++;
      this.stats.bytesTransferred += data.length;
      this.stats.lastFrameTime = new Date();

      // Log frame streaming activity
      const activeClients = this.connectionManager.getActiveConnectionCount();
      if (activeClients > 0) {
        this.logger.debug(
          `Streamed video frame: ${data.length} bytes to ${activeClients} clients`,
        );
      } else {
        this.logger.debug(
          `Processed video frame: ${data.length} bytes (no active clients)`,
        );
      }

      // Emit event
      this.emit("videoStreamed", {
        data,
        timestamp,
        isKeyFrame,
      } as StreamData);

      return true;
    } catch (error) {
      this.logger.error("Failed to stream video data:", error);
      this.emit("streamError", error);
      return false;
    }
  }

  /**
   * Get video metadata. Returns real metadata captured from the first
   * `LIVESTREAM_VIDEO_DATA` event if available, otherwise falls back to a
   * synthetic record built from the construction-time codec hint. Width,
   * height, and fps in the synthetic record are 0 — callers that need
   * those should treat 0 as "not yet known" and use their own fallbacks.
   *
   * The codec field is the load-bearing one: downstream consumers (stream
   * service, snapshot service) use it to advertise the correct codec to
   * Scrypted's media pipeline. Reporting the wrong codec causes the
   * Rebroadcast prebuffer to set up sync-frame detection for the wrong
   * NAL unit types and never find a keyframe.
   */
  getVideoMetadata(): VideoMetadata | null {
    if (this.videoMetadata) return this.videoMetadata;
    if (this.hintedVideoCodec) {
      return {
        videoCodec: this.hintedVideoCodec,
        videoWidth: 0,
        videoHeight: 0,
        videoFPS: 0,
      };
    }
    return null;
  }

  /** Audio capability as observed by the live stream. */
  getAudioStatus(): "unknown" | "aac" | "none" {
    if (this.deliversAudio === true) return "aac";
    if (this.deliversAudio === false) return "none";
    return "unknown";
  }

  /** Start a new P2P session whose metadata must be freshly confirmed. */
  private beginMetadataSession(): void {
    this.metadataGeneration++;
  }

  /** Whether metadata has been confirmed by video data for this P2P session. */
  isMetadataVerifiedForCurrentSession(): boolean {
    return this.metadataVerifiedGeneration === this.metadataGeneration;
  }

  /**
   * Wait for video metadata to be received
   */
  async waitForVideoMetadata(
    timeoutMs: number = 10000,
    options?: { signal?: AbortSignal },
  ): Promise<VideoMetadata> {
    if (this.videoMetadata && this.isMetadataVerifiedForCurrentSession()) {
      this.logger.debug("Video metadata already verified for this session");
      return this.videoMetadata;
    }

    if (options?.signal?.aborted) {
      throw new Error("Video metadata wait cancelled");
    }

    this.logger.debug(
      `Waiting for video metadata (timeout: ${timeoutMs}ms)...`,
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const signal = options?.signal;
      const waiter: MetadataWaiter = {
        resolve: (metadata) => settle(() => resolve(metadata)),
        reject: (error) => settle(() => reject(error)),
      };
      const removeWaiter = () => {
        const index = this.metadataWaiters.indexOf(waiter);
        if (index !== -1) this.metadataWaiters.splice(index, 1);
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };
      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        removeWaiter();
        complete();
      };
      const onAbort = () => {
        waiter.reject(new Error("Video metadata wait cancelled"));
      };

      this.metadataWaiters.push(waiter);
      timeout = setTimeout(() => {
        this.logger.warn(
          `Timeout waiting for video metadata (${timeoutMs}ms). Livestream state: ${this.livestreamActualState}, intended: ${this.livestreamIntendedState}`,
        );
        waiter.reject(
          new Error(`Timeout waiting for video metadata (${timeoutMs}ms)`),
        );
      }, timeoutMs);
      timeout.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Reserve an upstream consumer while a caller waits for freshly-confirmed
   * video metadata. This is intentionally independent of TCP clients: codec
   * selection has to wake the camera before Rebroadcast attaches its socket.
   */
  acquireMetadataWaiter(timeoutMs: number = 10000): MetadataBootstrapWaiter {
    const controller = new AbortController();
    let held = true;
    let settled = false;
    this.metadataBootstrapConsumers++;
    void this.updateLivestreamStateForMuxerClients();

    const release = () => {
      if (!held) return;
      held = false;
      this.metadataBootstrapConsumers--;
      if (!settled) controller.abort();
      if (this.getTotalConsumers() === 0 && !this.warmLease) {
        // A cancelled bootstrap must reclaim its live station lease rather
        // than leaving a P2P session held until the activity watchdog fires.
        this.livestreamIntendedState = false;
        void this.ensureLivestreamState();
      } else {
        void this.updateLivestreamStateForMuxerClients();
      }
    };

    const promise = this.waitForVideoMetadata(timeoutMs, {
      signal: controller.signal,
    }).then(
      (metadata) => {
        settled = true;
        return metadata;
      },
      (error) => {
        settled = true;
        if (/timeout/i.test(String(error?.message || error))) {
          this.holdWarmLease();
        }
        release();
        throw error;
      },
    );

    return { promise, release, cancel: release };
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get server statistics
   */
  getStats(): ServerStats {
    const connectionStats = this.connectionManager.getConnectionStats();

    return {
      isActive: this.isActive,
      port: this.options.port,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      connections: {
        active: this.connectionManager.getActiveConnectionCount(),
        total: Object.keys(connectionStats).length,
        connections: connectionStats,
      },
      streaming: {
        framesProcessed: this.stats.framesProcessed,
        bytesTransferred: this.stats.bytesTransferred,
        lastFrameTime: this.stats.lastFrameTime,
      },
    };
  }

  /**
   * Get the actual port the server is listening on
   */
  getPort(): number | undefined {
    if (this.server) {
      const address = this.server.address();
      if (address && typeof address === "object") {
        return address.port;
      }
    }
    return undefined;
  }

  /**
   * Get number of active connections
   */
  getActiveConnectionCount(): number {
    return this.connectionManager.getActiveConnectionCount();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      framesProcessed: 0,
      bytesTransferred: 0,
      lastFrameTime: null,
    };
  }

  /**
   * Return the most recently seen keyframe if it is no older than `maxAgeMs`,
   * otherwise null. Lets callers serve a snapshot/thumbnail without waking a
   * (battery) camera. The returned buffer is self-contained — parameter sets
   * are prepended — so it decodes to a JPEG on its own.
   *
   * @param maxAgeMs - Maximum acceptable age of the cached keyframe, in ms
   */
  getCachedKeyframe(
    maxAgeMs: number,
  ): { data: Buffer; codec: "H264" | "H265"; ageMs: number } | null {
    if (!this.lastKeyframe) return null;
    const ageMs = Date.now() - this.lastKeyframe.timestamp;
    if (ageMs > maxAgeMs) return null;
    return {
      data: this.lastKeyframe.data,
      codec: this.lastKeyframe.codec,
      ageMs,
    };
  }

  /**
   * Seed the keyframe cache from a previously-persisted frame (e.g. restored
   * from Scrypted storage after a plugin reload) so snapshots/thumbnails serve
   * the last-seen image immediately, without waking the camera. Only seeds if
   * the cache is currently empty (a live frame always wins). Timestamp is set
   * to now so the restored frame isn't treated as stale right after a restart.
   */
  setCachedKeyframe(data: Buffer, codec: "H264" | "H265"): void {
    if (this.lastKeyframe) return;
    this.lastKeyframe = { data, codec, timestamp: Date.now() };
  }

  /**
   * Capture a single snapshot frame from the stream.
   * Starts the livestream if not already running, waits for a keyframe,
   * captures the frame, and stops the stream.
   *
   * @param timeoutMs - Maximum time to wait for a snapshot (default: 15000ms)
   * @returns Promise<Buffer> - Raw H.264 keyframe data
   */
  async captureSnapshot(timeoutMs: number = 15000): Promise<Buffer> {
    this.logger.info("📸 Capturing snapshot...");

    // Cancel any pending post-snapshot stop — this snapshot is about to
    // use the (possibly still-warm) livestream, so we don't want it torn
    // down while we wait for a keyframe.
    this.cancelPostSnapshotLinger("new snapshot starting");

    const wasStreamRunning = this.livestreamIntendedState;

    try {
      // Start livestream if not already running or being started
      if (!this.livestreamIntendedState) {
        this.logger.debug("Starting livestream for snapshot capture");
        this.livestreamIntendedState = true;
        // Kick off the activity monitor so the mid-session wedge watchdog
        // can fire if upstream P2P stalls. Without this, snapshots that
        // started the livestream (with no muxer client attached yet) had
        // no watchdog at all — a wedged session would only surface after
        // the 60s snapshot timeout.
        this.lastClientActivity = Date.now();
        this.startActivityMonitoring();
        await this.ensureLivestreamState();
      } else {
        this.logger.debug(
          "Livestream already intended/running, waiting for keyframe",
        );
      }

      // Wait for a keyframe
      const snapshotBuffer = await new Promise<Buffer>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          // Remove this resolver from the list
          this.snapshotResolvers = this.snapshotResolvers.filter(
            (r) => r.resolve !== resolve,
          );
          reject(
            new Error(
              `Snapshot capture timed out after ${timeoutMs}ms - no keyframe received`,
            ),
          );
        }, timeoutMs);

        // Add resolver to the queue
        this.snapshotResolvers.push({
          resolve: (buffer: Buffer) => {
            clearTimeout(timeoutHandle);
            resolve(buffer);
          },
          reject: (error: Error) => {
            clearTimeout(timeoutHandle);
            reject(error);
          },
          timestamp: Date.now(),
        });

        this.logger.debug(
          `Waiting for next keyframe (timeout: ${timeoutMs}ms)...`,
        );
      });

      this.logger.info(
        `✅ Snapshot captured: ${snapshotBuffer.length} bytes (keyframe)`,
      );

      return snapshotBuffer;
    } finally {
      // Only stop the livestream if (a) we were the ones who started it
      // (`!wasStreamRunning`) AND (b) no other consumer has attached during
      // our snapshot wait. Without (b) we tear down the livestream out from
      // under a concurrently-attached HomeKit muxer client, which causes the
      // downstream Rebroadcast ffmpeg to get `Connection refused` and the
      // streaming session to fail. The activity monitor will stop the
      // stream gracefully once consumers detach.
      const totalConsumers = this.getTotalConsumers();

      if (!wasStreamRunning && totalConsumers === 0) {
        // LINGER instead of immediate stop. The Home app pattern is a
        // snapshot request followed within seconds by a stream request.
        // Tearing the livestream down here forces the follow-up stream
        // to pay the full cold-start cost (~30s on battery cameras),
        // which often exceeds HomeKit's session timeout (~30s) and the
        // stream visibly fails. Lingering briefly bridges the gap.
        this.logger.info(
          `⏳ Snapshot complete, no consumers — lingering livestream for ${this.POST_SNAPSHOT_LINGER_MS}ms`,
        );
        this.postSnapshotLingerTimer = setTimeout(() => {
          this.postSnapshotLingerTimer = undefined;
          const consumersNow = this.getTotalConsumers();
          if (consumersNow > 0) {
            this.logger.info(
              `🔌 Linger expired with ${consumersNow} consumer(s) attached — keeping livestream`,
            );
            return;
          }
          if (!this.livestreamIntendedState) {
            // Someone else already cleared intent (e.g. recycle/wedge)
            return;
          }
          this.logger.info(
            "🕒 Post-snapshot linger expired, no consumers — stopping livestream",
          );
          this.livestreamIntendedState = false;
          this.ensureLivestreamState().catch((error) => {
            this.logger.warn(
              `Failed to stop livestream after snapshot linger: ${error}`,
            );
          });
        }, this.POST_SNAPSHOT_LINGER_MS);
      } else if (!wasStreamRunning && totalConsumers > 0) {
        this.logger.info(
          `📌 Snapshot complete but ${totalConsumers} consumer(s) attached — leaving livestream running`,
        );
      }
    }
  }
}
