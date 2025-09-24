/**
 * Server level command constants for Eufy WebSocket API
 *
 * Contains all server command string constants and enums for server operations and events.
 */
export const SERVER_COMMANDS = {
  START_LISTENING: "start_listening",
  SET_API_SCHEMA: "set_api_schema",
} as const;

export type ServerCommandType =
  (typeof SERVER_COMMANDS)[keyof typeof SERVER_COMMANDS];

/**
 * Server event constants
 */
export const SERVER_EVENTS = {
  SHUTDOWN: "shutdown",
} as const;

export type ServerEventType =
  (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];
