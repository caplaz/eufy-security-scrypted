#!/usr/bin/env node

/**
 * Simple example of using the eufy-stream-server
 *
 * This example demonstrates how to start a TCP streaming server
 * and stream test H.264 data to connected clients.
 */

import { StreamServer } from "../src/index";

// Create test H.264 data (this would come from your camera in a real application)
function createTestH264Data(): Buffer {
  const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);

  // SPS NAL unit (type 7)
  const spsNal = Buffer.from([
    0x67, 0x42, 0xe0, 0x1e, 0x9a, 0x74, 0x05, 0x03, 0x78,
  ]);

  // PPS NAL unit (type 8)
  const ppsNal = Buffer.from([0x68, 0xce, 0x3c, 0x80]);

  // IDR NAL unit (type 5) - key frame
  const idrNal = Buffer.from([
    0x65, 0x88, 0x84, 0x00, 0x33, 0xff, 0xfe, 0xf6, 0xf0,
  ]);

  return Buffer.concat([
    startCode,
    spsNal,
    startCode,
    ppsNal,
    startCode,
    idrNal,
  ]);
}

async function main() {
  console.log("🚀 Starting Eufy Stream Server Example");

  // Create server instance
  const server = new StreamServer({
    port: 8080,
    host: "0.0.0.0",
    maxConnections: 5,
    debug: true,
  });

  // Set up event handlers
  server.on("started", () => {
    console.log("✅ Server started successfully");
    console.log("📡 You can now connect clients to tcp://localhost:8080");
    console.log("💡 Try: ffplay tcp://localhost:8080");
  });

  server.on("clientConnected", (connectionId, connectionInfo) => {
    console.log(
      `🔗 Client connected: ${connectionId} from ${connectionInfo.remoteAddress}:${connectionInfo.remotePort}`
    );
  });

  server.on("clientDisconnected", (connectionId) => {
    console.log(`❌ Client disconnected: ${connectionId}`);
  });

  server.on("videoStreamed", (streamData) => {
    console.log(
      `📹 Streamed ${streamData.data.length} bytes, keyFrame: ${streamData.isKeyFrame}`
    );
  });

  server.on("error", (error) => {
    console.error("❗ Server error:", error);
  });

  // Start the server
  try {
    await server.start();

    // Generate some test video frames
    console.log("🎬 Starting to generate test video frames...");

    let frameCount = 0;
    const testData = createTestH264Data();

    const streamInterval = setInterval(async () => {
      frameCount++;
      const timestamp = Date.now();
      const isKeyFrame = frameCount % 30 === 1; // Key frame every 30 frames

      await server.streamVideo(testData, timestamp, isKeyFrame);

      // Show statistics every 100 frames
      if (frameCount % 100 === 0) {
        const stats = server.getStats();
        console.log(
          `📊 Stats - Frames: ${stats.streaming.framesProcessed}, Clients: ${stats.connections.active}, Bytes: ${stats.streaming.bytesTransferred}`
        );
      }
    }, 33); // ~30 FPS

    // Handle shutdown gracefully
    process.on("SIGINT", async () => {
      console.log("\n🛑 Shutting down server...");
      clearInterval(streamInterval);
      await server.stop();
      console.log("✅ Server stopped gracefully");
      process.exit(0);
    });
  } catch (error) {
    console.error("❗ Failed to start server:", error);
    process.exit(1);
  }
}

// Run the example
main().catch((error) => {
  console.error("❗ Example failed:", error);
  process.exit(1);
});
