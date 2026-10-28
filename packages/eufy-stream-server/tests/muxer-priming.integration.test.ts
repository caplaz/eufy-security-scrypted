/**
 * Integration test: a muxer that attaches mid-GOP must emit fMP4 without
 * waiting for the camera's next keyframe.
 *
 * This file deliberately does NOT mock `jmuxer`. The bug it guards against is
 * jmuxer's own contract — a remuxer emits nothing until it has parsed the
 * parameter sets (`readyToDecode`), and cameras only repeat those with a
 * keyframe — so a mocked muxer cannot reproduce it. On an Indoor Cam C220 the
 * keyframe interval is 4s, which is exactly `BOTH_TO_VIDEO_FALLBACK_MS`: the
 * muxer stayed silent, `both` was downgraded to video-only, and the downstream
 * ffmpeg died on its (already mapped) audio output with "Output file does not
 * contain any stream".
 *
 * A real fMP4 init segment written by jmuxer contains an `mp4a` sample entry
 * only when the audio track is part of the muxed output, so that is what this
 * test asserts on.
 */

import * as net from "net";
import { StreamServer } from "../src/stream-server";
import { wait } from "./test-utils";

jest.mock("@caplaz/eufy-security-client", () => ({
  DEVICE_EVENTS: {
    LIVESTREAM_VIDEO_DATA: "livestream video data",
    LIVESTREAM_AUDIO_DATA: "livestream audio data",
  },
}));

const START = Buffer.from([0x00, 0x00, 0x00, 0x01]);
// Synthetic SPS/PPS/IDR shaped like the ones eufy bundles with a keyframe.
const SPS = Buffer.concat([
  START,
  Buffer.from([0x67, 0x42, 0xe0, 0x1e, 0x9a, 0x74, 0x05, 0x03, 0x78]),
]);
const PPS = Buffer.concat([START, Buffer.from([0x68, 0xce, 0x3c, 0x80])]);
const IDR = Buffer.concat([
  START,
  Buffer.from([0x65, 0x88, 0x84, 0x00, 0x33, 0xff, 0xfe, 0xf6, 0xf0]),
]);
// Non-IDR slice (type 1): no parameter sets, no keyframe.
const pFrame = (seed: number): Buffer =>
  Buffer.concat([
    START,
    Buffer.from([0x41, 0x9a, seed & 0xff, 0x18, 0xff, 0xee, 0xdd]),
  ]);

// One real ADTS AAC frame captured from an Indoor Cam C220 (16kHz, 1024
// samples, 171 bytes) — the exact payload the plugin forwards to jmuxer.
const ADTS_FRAME = Buffer.from(
  "fff96040157ffc01203587e6212048401002c05928422da96e2ef306eabdd37169357922e2e42be5f6eac3684f7bceb615e54751933fd270bef57efd70d2f8f32f864670b403eae904660531ba6ca5104d78b4b22b194c4f690893c42ab11bc8a92427931dc130448c278218cd895bea1397d9072e11c51371127ec37846020e5fdf0485d3c82eda61b790998b97556882e629e388212009410a61c3029ad60000000000000000000001c0",
  "hex",
);

describe("muxer priming with the real JMuxer", () => {
  it("emits an fMP4 init segment carrying the audio track without a post-attach keyframe", async () => {
    const mockWsClient: any = {
      addEventListener: jest.fn().mockReturnValue(() => {}),
      commands: {
        device: jest.fn().mockReturnValue({
          startLivestream: jest.fn().mockResolvedValue({}),
          stopLivestream: jest.fn().mockResolvedValue({}),
        }),
      },
    };

    const server = new StreamServer({
      port: 9000 + Math.floor(Math.random() * 1000),
      host: "127.0.0.1",
      wsClient: mockWsClient,
      serialNumber: "TEST_DEVICE_123",
    });

    await server.start();

    let socket: net.Socket | undefined;
    try {
      const received: Buffer[] = [];
      socket = net.createConnection({
        port: server.getMuxedPort()!,
        host: "127.0.0.1",
      });
      socket.on("data", (chunk) => received.push(chunk as Buffer));
      await new Promise((resolve) => socket!.on("connect", resolve));

      // The connect opens a fresh metadata session, so audio capability is
      // re-declared afterwards to skip the 2.5s audio probe.
      await wait(0);
      (server as any).deliversAudio = true;

      const videoHandler = mockWsClient.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === "livestream video data",
      )[1];
      const audioHandler = mockWsClient.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === "livestream audio data",
      )[1];

      const metadata = {
        videoCodec: "H264",
        videoFPS: 15,
        videoWidth: 1920,
        videoHeight: 1080,
      };

      // Opening keyframe: caches SPS/PPS and unblocks the muxer build. It is
      // not fanned out — the muxer for this socket does not exist yet.
      videoHandler({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: Buffer.concat([SPS, PPS, IDR]) },
        metadata,
      });
      await wait(150);

      // Everything after the attach is mid-GOP: no parameter sets, no keyframe.
      for (let i = 0; i < 4; i++) {
        videoHandler({
          serialNumber: "TEST_DEVICE_123",
          buffer: { data: pFrame(i) },
        });
      }
      audioHandler({
        serialNumber: "TEST_DEVICE_123",
        buffer: { data: ADTS_FRAME },
        metadata: { audioCodec: "aac", sampleRate: 16000, channelCount: 1 },
      });

      // Poll instead of a fixed sleep so the assertion is about the behaviour,
      // not about how fast the machine is.
      for (let i = 0; i < 40 && Buffer.concat(received).length === 0; i++) {
        await wait(50);
      }

      const output = Buffer.concat(received);

      // Without priming this is empty: jmuxer waits for the next keyframe.
      expect(output.length).toBeGreaterThan(0);
      expect(output.includes("ftyp")).toBe(true);
      expect(output.includes("moov")).toBe(true);
      // The audio track survived into the muxed output (mp4a sample entry).
      expect(output.includes("mp4a")).toBe(true);
    } finally {
      socket?.destroy();
      await server.stop();
    }
  });
});
