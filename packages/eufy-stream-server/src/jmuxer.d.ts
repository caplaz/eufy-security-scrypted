/**
 * Ambient module declaration for `jmuxer`. The package ships JS only — these
 * types cover the surface we use (constructor, feed, createStream, destroy).
 */
declare module "jmuxer" {
  import { Duplex } from "node:stream";

  export interface JMuxerOptions {
    mode?: "both" | "video" | "audio";
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
