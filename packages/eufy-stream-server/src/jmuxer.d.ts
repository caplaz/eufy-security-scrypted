/**
 * Ambient module declaration for `jmuxer`. The package ships JS only — these
 * types cover the surface we use (constructor, feed, createStream, destroy).
 */
declare module "jmuxer" {
  import { Duplex } from "node:stream";

  export interface JMuxerOptions {
    mode?: "both" | "video" | "audio";
    /**
     * Either "H264" or "H265". Defaults to "H264" in JMuxer itself; must
     * be set to "H265" when feeding HEVC bitstreams or the muxer writes an
     * AVCC sample description over HEVC NAL units and the output fMP4 is
     * undecodable.
     */
    videoCodec?: "H264" | "H265";
    fps?: number;
    flushingTime?: number;
    clearBuffer?: boolean;
    debug?: boolean;
  }

  export interface JMuxerFeedData {
    video?: Buffer | Uint8Array;
    audio?: Buffer | Uint8Array;
    duration?: number;
  }

  export default class JMuxer {
    constructor(options: JMuxerOptions);
    feed(data: JMuxerFeedData): void;
    createStream(): Duplex;
    destroy(): void;
  }
}
