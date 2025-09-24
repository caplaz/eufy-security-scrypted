import {
  WebSocketMessageProcessor,
  MessageProcessorConfig,
} from "../../src/utils/websocket-message-processor";
import { DEVICE_EVENTS } from "../../src/device/constants";
import { MESSAGE_TYPES } from "../../src/websocket-types";

// Mock tslog to avoid console noise in tests
jest.mock("tslog", () => ({
  Logger: jest.fn().mockImplementation(() => ({
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  })),
}));

describe("Utils Module", () => {
  describe("WebSocketMessageProcessor", () => {
    let processor: WebSocketMessageProcessor;

    beforeEach(() => {
      processor = new WebSocketMessageProcessor();
    });

    describe("initialization", () => {
      it("should create processor with default configuration", () => {
        expect(processor).toBeDefined();
        expect(processor.getStats()).toEqual({
          processedMessages: 0,
          invalidMessages: 0,
          rateLimitedMessages: 0,
          rateLimiter: expect.objectContaining({
            messageCount: 0,
            maxMessages: 100,
            windowMs: 1000,
          }),
        });
      });

      it("should create processor with custom configuration", () => {
        const config: MessageProcessorConfig = {
          maxMessageSize: 1000,
          maxMessagesPerSecond: 50,
          rateLimitWindowMs: 2000,
        };
        const customProcessor = new WebSocketMessageProcessor(
          undefined,
          config
        );
        expect(customProcessor).toBeDefined();
      });
    });

    describe("message processing", () => {
      it("should process valid JSON messages", () => {
        const validMessage = { type: "test", data: "hello" };
        const result = processor.processMessage(JSON.stringify(validMessage));

        expect(result.valid).toBe(true);
        expect(result.message).toEqual(validMessage);
        expect(result.error).toBeUndefined();
      });

      it("should reject empty messages", () => {
        const result = processor.processMessage(null);

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Empty message data");
      });

      it("should reject invalid JSON", () => {
        const result = processor.processMessage("invalid json {");

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Invalid JSON");
      });

      it("should reject messages without type field", () => {
        const result = processor.processMessage(
          JSON.stringify({ data: "no type" })
        );

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message must have a string type field");
      });

      it("should reject messages with non-string type", () => {
        const result = processor.processMessage(JSON.stringify({ type: 123 }));

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message must have a string type field");
      });

      it("should reject messages with extremely long type", () => {
        const longType = "a".repeat(100);
        const result = processor.processMessage(
          JSON.stringify({ type: longType })
        );

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message type too long");
      });

      it("should reject non-object messages", () => {
        const result = processor.processMessage(
          JSON.stringify("string message")
        );

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message must be an object");
      });

      it("should validate messageId if present", () => {
        const validResult = processor.processMessage(
          JSON.stringify({
            type: "test",
            messageId: "valid-id",
          })
        );
        expect(validResult.valid).toBe(true);

        const invalidResult = processor.processMessage(
          JSON.stringify({
            type: "test",
            messageId: 123,
          })
        );
        expect(invalidResult.valid).toBe(false);
        expect(invalidResult.error).toBe("MessageId must be a string");
      });
    });

    describe("rate limiting", () => {
      it("should handle rate limiting", () => {
        const config: MessageProcessorConfig = {
          maxMessagesPerSecond: 2,
          rateLimitWindowMs: 1000,
        };
        const rateLimitedProcessor = new WebSocketMessageProcessor(
          undefined,
          config
        );

        // First two messages should pass
        const message = JSON.stringify({ type: "test" });
        expect(rateLimitedProcessor.processMessage(message).valid).toBe(true);
        expect(rateLimitedProcessor.processMessage(message).valid).toBe(true);

        // Third message should be rate limited
        const result = rateLimitedProcessor.processMessage(message);
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Rate limit exceeded");

        const stats = rateLimitedProcessor.getStats();
        expect(stats.rateLimitedMessages).toBe(1);
      });
    });

    describe("large message handling", () => {
      it("should allow large livestream video messages", () => {
        const largeMessage = {
          type: MESSAGE_TYPES.EVENT,
          event: {
            event: DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA,
            data: "x".repeat(600000), // 600KB
          },
        };

        const result = processor.processMessage(JSON.stringify(largeMessage));
        expect(result.valid).toBe(true);
      });

      it("should allow large livestream audio messages", () => {
        const largeMessage = {
          type: MESSAGE_TYPES.EVENT,
          event: {
            event: DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA,
            data: "x".repeat(600000), // 600KB
          },
        };

        const result = processor.processMessage(JSON.stringify(largeMessage));
        expect(result.valid).toBe(true);
      });

      it("should reject large non-streaming messages", () => {
        const config: MessageProcessorConfig = {
          maxMessageSize: 1000,
        };
        const strictProcessor = new WebSocketMessageProcessor(
          undefined,
          config
        );

        const largeMessage = {
          type: "regular",
          data: "x".repeat(2000),
        };

        const result = strictProcessor.processMessage(
          JSON.stringify(largeMessage)
        );
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message too large");
      });

      it("should handle malformed large messages", () => {
        const malformedLargeData = "x".repeat(600000);
        const result = processor.processMessage(malformedLargeData);

        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message too large");
      });
    });

    describe("circular reference detection", () => {
      it("should detect circular references during validation", () => {
        // Create a test message that passes basic JSON but would fail our circular reference check
        const processor = new WebSocketMessageProcessor();

        // Create a message with proper type that we can modify after stringification
        const testMessage = { type: "test", data: "valid" };
        const messageStr = JSON.stringify(testMessage);

        // Mock JSON.stringify to simulate circular reference detection
        const originalStringify = JSON.stringify;
        jest.spyOn(JSON, "stringify").mockImplementationOnce(() => {
          throw new TypeError("Converting circular structure to JSON");
        });

        const result = processor.processMessage(messageStr);
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Message contains circular references");

        // Restore original implementation
        JSON.stringify = originalStringify;
      });
    });

    describe("statistics", () => {
      it("should track processing statistics", () => {
        const validMessage = JSON.stringify({ type: "valid" });
        const invalidMessage = "invalid";

        processor.processMessage(validMessage);
        processor.processMessage(invalidMessage);

        const stats = processor.getStats();
        expect(stats.processedMessages).toBe(1);
        expect(stats.invalidMessages).toBe(1);
        expect(stats.rateLimitedMessages).toBe(0);
      });

      it("should reset statistics", () => {
        processor.processMessage(JSON.stringify({ type: "test" }));
        processor.processMessage("invalid");

        processor.resetStats();

        const stats = processor.getStats();
        expect(stats.processedMessages).toBe(0);
        expect(stats.invalidMessages).toBe(0);
        expect(stats.rateLimitedMessages).toBe(0);
      });
    });

    describe("buffer message handling", () => {
      it("should handle buffer messages", () => {
        const bufferMessage = Buffer.from(
          JSON.stringify({ type: "buffer-test" })
        );
        const result = processor.processMessage(bufferMessage);

        expect(result.valid).toBe(true);
        expect(result.message).toEqual({ type: "buffer-test" });
      });

      it("should handle buffer conversion errors", () => {
        // Create a mock object that will throw when toString() is called
        const mockBuffer = {
          toString: () => {
            throw new Error("Conversion error");
          },
        };

        const result = processor.processMessage(mockBuffer);
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Failed to convert message to string");
      });
    });

    describe("smart message type detection", () => {
      it("should allow large EVENT messages", () => {
        // Create a message with event type that will be detected properly
        const largeEventMessage = {
          type: MESSAGE_TYPES.EVENT,
          data: "x".repeat(600000),
        };

        const messageStr = JSON.stringify(largeEventMessage);
        // Ensure the type appears early in the message for proper detection
        expect(messageStr.substring(0, 100)).toContain('"type":"event"');

        const result = processor.processMessage(messageStr);
        expect(result.valid).toBe(true);
      });

      it("should allow large RESULT messages", () => {
        // Create a message with result type that will be detected properly
        const largeResultMessage = {
          type: MESSAGE_TYPES.RESULT,
          data: "x".repeat(600000),
        };

        const messageStr = JSON.stringify(largeResultMessage);
        // Ensure the type appears early in the message for proper detection
        expect(messageStr.substring(0, 100)).toContain('"type":"result"');

        const result = processor.processMessage(messageStr);
        expect(result.valid).toBe(true);
      });

      it("should handle parsing errors for large messages gracefully", () => {
        // Create a large message that will fail to parse but contains livestream keywords
        const malformedLargeMessage =
          `{"incomplete": true, "${DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA}": ` +
          "x".repeat(600000);

        const result = processor.processMessage(malformedLargeMessage);
        expect(result.valid).toBe(false);
        expect(result.error).toBe("Invalid JSON");
      });
    });
  });
});
