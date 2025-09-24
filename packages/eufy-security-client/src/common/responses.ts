/**
 * Common response types used across all command sources in the Eufy WebSocket API
 *
 * Defines standard success, error, and base response types for device, station, driver, and server operations.
 */

import { JSONValue } from "../types/shared";

/**
 * Standard success response for commands that only return success status
 * Used by many commands across device, station, driver, and server operations
 */
export type SuccessApiResponse<T extends JSONValue> = {
  success: true;
} & T;

export interface ErrorApiResponse {
  success: false;
  errorCode: string;
}
/**
 * Base response structure shared by all API responses
 */
export type BaseApiResponse<T extends JSONValue = {}> =
  | {
      type: "result";
      messageId: string;
    }
  | SuccessApiResponse<T>
  | ErrorApiResponse;
