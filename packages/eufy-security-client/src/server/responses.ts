/**
 * Response types for server-level commands in the Eufy WebSocket API
 *
 * Defines all response types for server commands, based on the API documentation.
 * Server responses are direct WebSocket protocol responses, not BaseApiResponse wrappers.
 */

// ================= SERVER SETUP RESPONSES =================

/**
 * Response from start_listening command
 * Returns the current server state with devices, stations, and driver info
 */
export interface StartListeningResponse {
  state: {
    driver: {
      version: string;
      connected: boolean;
      pushConnected: boolean;
    };
    stations: string[];
    devices: string[];
  };
}

/**
 * Response from set_api_schema command
 * No specific return documented, but returns standard WebSocket response structure
 */
export interface SetApiSchemaResponse {
  // No specific data returned, command succeeds or fails
}

// ================= UNION TYPES =================

/**
 * Union type of all server response types
 */
export type ServerResponse = StartListeningResponse | SetApiSchemaResponse;

// ================= COMMAND-RESPONSE MAPPING =================

import { SERVER_COMMANDS } from "./constants";

/**
 * Maps server commands to their expected response types
 * Note: Server responses are direct objects, not {} wrappers
 */
export interface ServerCommandResponseMap {
  [SERVER_COMMANDS.START_LISTENING]: StartListeningResponse;
  [SERVER_COMMANDS.SET_API_SCHEMA]: SetApiSchemaResponse;
}
