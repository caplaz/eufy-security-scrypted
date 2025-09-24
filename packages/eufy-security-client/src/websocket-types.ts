/**
 * WebSocket message and type definitions for Eufy Security WebSocket API
 *
 * Contains all message type constants, interfaces, and type definitions for WebSocket communication.
 * Used for type safety and message structure enforcement throughout the client.
 */

import { AllEventPayloads } from "./types/events";

export const MESSAGE_TYPES = {
  VERSION: "version",
  RESULT: "result",
  EVENT: "event",
} as const;

/* VERSION MESSAGE TYPES */
/**
 * Represents a version message received over WebSocket.
 * Contains version and schema compatibility information.
 */
export type WebSocketVersionMessage = {
  type: typeof MESSAGE_TYPES.VERSION;
  driverVersion: string;
  serverVersion: string;
  minSchemaVersion: number;
  maxSchemaVersion: number;
};

/* COMMAND MESSAGE TYPES */
/**
 * Represents a command sent over WebSocket.
 * Contains the command type, message ID, and additional parameters.
 */
export interface WebSocketCommand {
  messageId: string;
  command: string;
  [key: string]: any;
}

/**
 * Represents a successful WebSocket command response.
 * Contains the result of the command execution.
 */
export type WebSocketCommandSuccessResponse<T = any> = {
  success: true;
  result: T;
};

/**
 * Represents an error WebSocket command response.
 * Contains the error code and details.
 */
export type WebSocketCommandErrorResponse = {
  success: false;
  errorCode: string;
};

/**
 * Generic WebSocket command response
 */
export type WebSocketCommandResponse<T = any> = {
  type: typeof MESSAGE_TYPES.RESULT;
  messageId: string;
} & (WebSocketCommandSuccessResponse<T> | WebSocketCommandErrorResponse);

/**
 * Represents an event message received over WebSocket.
 * Contains the event type and payload.
 */
export type WebSocketEventMessage = {
  type: typeof MESSAGE_TYPES.EVENT;
  event: AllEventPayloads;
};

/**
 * Represents a generic WebSocket message.
 * Can be a version message, command response, or event message.
 */
export type WebSocketMessage =
  | WebSocketVersionMessage
  | WebSocketCommandResponse
  | WebSocketEventMessage;
