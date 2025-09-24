/**
 * Simple WebSocket Message Processor
 *
 * Fixes the root cause of P2P stability issues by adding proper message validation,
 * rate limiting, and structure checks to prevent infinite loops and parsing errors.
 */

import { Logger, ILogObj } from "tslog";
import { DEVICE_EVENTS } from "../device/constants";
import { MESSAGE_TYPES } from "../websocket-types";

/**
 * Message validation result
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Rate limiter for message processing
 */
class MessageRateLimiter {
  private messageCount = 0;
  private windowStart = Date.now();
  private readonly maxMessages: number;
  private readonly windowMs: number;

  constructor(maxMessages = 100, windowMs = 1000) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
  }

  canProcess(): boolean {
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.messageCount = 0;
      this.windowStart = now;
    }

    // Check if under limit
    if (this.messageCount < this.maxMessages) {
      this.messageCount++;
      return true;
    }

    return false;
  }

  getStats() {
    return {
      messageCount: this.messageCount,
      windowStart: this.windowStart,
      maxMessages: this.maxMessages,
      windowMs: this.windowMs,
    };
  }
}

/**
 * Configuration for message processor
 */
export interface MessageProcessorConfig {
  maxMessageSize?: number;
  maxMessagesPerSecond?: number;
  rateLimitWindowMs?: number;
}

/**
 * Simple message processor that fixes WebSocket parsing issues
 */
export class WebSocketMessageProcessor {
  private rateLimiter: MessageRateLimiter;
  private logger?: Logger<ILogObj>;
  private processedMessages = 0;
  private invalidMessages = 0;
  private rateLimitedMessages = 0;
  private maxMessageSize: number;

  constructor(logger?: Logger<ILogObj>, config: MessageProcessorConfig = {}) {
    this.logger = logger;
    this.maxMessageSize = config.maxMessageSize ?? 500000; // 500KB default to handle video data
    this.rateLimiter = new MessageRateLimiter(
      config.maxMessagesPerSecond ?? 100,
      config.rateLimitWindowMs ?? 1000
    );
  }

  /**
   * Process a raw WebSocket message with validation and rate limiting
   */
  processMessage(data: any): { valid: boolean; message?: any; error?: string } {
    // Rate limiting check
    if (!this.rateLimiter.canProcess()) {
      this.rateLimitedMessages++;
      this.logger?.warn("Message rate limit exceeded, dropping message");
      return { valid: false, error: "Rate limit exceeded" };
    }

    // Basic data validation
    if (!data) {
      this.invalidMessages++;
      return { valid: false, error: "Empty message data" };
    }

    // Convert to string if buffer
    let messageStr: string;
    try {
      messageStr = data.toString();
    } catch (error) {
      this.invalidMessages++;
      return { valid: false, error: "Failed to convert message to string" };
    }

    // Smart message size filtering - allow important message types to be larger
    if (messageStr.length > this.maxMessageSize) {
      // Try to extract message type for smart filtering
      let messageType = "unknown";
      let allowLargeMessage = false;

      try {
        // First check for livestream data using string matching (more reliable for large messages)
        const isLivestreamData =
          messageStr.includes(`"${DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA}"`) ||
          messageStr.includes(`"${DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA}"`);

        if (isLivestreamData) {
          messageType = "livestream-data";
          allowLargeMessage = true;
        } else {
          // Try to parse a preview for other message types
          const preview = JSON.parse(messageStr.substring(0, 1000)); // Parse first 1KB
          messageType = preview.type || preview.event?.event || "no-type";

          // Allow large messages for other important types
          const allowedLargeTypes = [MESSAGE_TYPES.EVENT, MESSAGE_TYPES.RESULT];

          allowLargeMessage = allowedLargeTypes.some(
            (type) =>
              messageType.includes(type) ||
              messageStr.includes(`"type":"${type}"`)
          );
        }
      } catch (e) {
        // If we can't parse even the beginning, check if it's livestream data by string matching
        const isLivestreamData =
          messageStr.includes(`"${DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA}"`) ||
          messageStr.includes(`"${DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA}"`);

        if (isLivestreamData) {
          messageType = "livestream-data";
          allowLargeMessage = true;
        } else {
          // Also check for EVENT and RESULT types using string matching
          const isEventMessage = messageStr.includes(
            `"type":"${MESSAGE_TYPES.EVENT}"`
          );
          const isResultMessage = messageStr.includes(
            `"type":"${MESSAGE_TYPES.RESULT}"`
          );

          if (isEventMessage) {
            messageType = "event";
            allowLargeMessage = true;
          } else if (isResultMessage) {
            messageType = "result";
            allowLargeMessage = true;
          } else {
            messageType = "parse-error";
            allowLargeMessage = false;
          }
        }
      }

      if (!allowLargeMessage) {
        this.invalidMessages++;
        this.logger?.warn(
          `Message too large and not streaming data: ${messageStr.length} bytes, ` +
            `type: ${messageType}, preview: ${messageStr.substring(0, 100)}...`
        );
        return { valid: false, error: "Message too large" };
      } else {
        // Log but allow the message
        this.logger?.debug(
          `Large message allowed for streaming: ${messageStr.length} bytes, type: ${messageType}`
        );
      }
    }

    // JSON parsing with validation
    let parsedMessage: any;
    try {
      parsedMessage = JSON.parse(messageStr);
    } catch (error) {
      this.invalidMessages++;
      this.logger?.warn("Invalid JSON message:", messageStr.substring(0, 100));
      return { valid: false, error: "Invalid JSON" };
    }

    // Message structure validation
    const validation = this.validateMessageStructure(parsedMessage);
    if (!validation.valid) {
      this.invalidMessages++;
      return { valid: false, error: validation.error };
    }

    this.processedMessages++;
    return { valid: true, message: parsedMessage };
  }

  /**
   * Validate basic message structure
   */
  private validateMessageStructure(message: any): ValidationResult {
    // Must be an object
    if (typeof message !== "object" || message === null) {
      return { valid: false, error: "Message must be an object" };
    }

    // Must have a type field
    if (!message.type || typeof message.type !== "string") {
      return { valid: false, error: "Message must have a string type field" };
    }

    // Type should be reasonable length
    if (message.type.length > 50) {
      return { valid: false, error: "Message type too long" };
    }

    // If messageId exists, it should be a string
    if (message.messageId && typeof message.messageId !== "string") {
      return { valid: false, error: "MessageId must be a string" };
    }

    // Basic circular reference check
    try {
      JSON.stringify(message);
    } catch (error) {
      return { valid: false, error: "Message contains circular references" };
    }

    return { valid: true };
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      processedMessages: this.processedMessages,
      invalidMessages: this.invalidMessages,
      rateLimitedMessages: this.rateLimitedMessages,
      rateLimiter: this.rateLimiter.getStats(),
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.processedMessages = 0;
    this.invalidMessages = 0;
    this.rateLimitedMessages = 0;
  }
}
