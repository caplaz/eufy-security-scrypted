/**
 * Common constants used across all command sources in the Eufy WebSocket API
 *
 * Consolidates all shared event source constants and type guards for type safety and validation.
 */

// ================= EVENT SOURCES =================

/**
 * Event source constants for Eufy WebSocket API
 * Centralized definition of all event sources to ensure type safety
 */
export const EVENT_SOURCES = {
  SERVER: "server", // Events originating from the server
  DRIVER: "driver", // Events originating from the driver
  DEVICE: "device", // Events originating from the device
  STATION: "station", // Events originating from the station
} as const;

export type EventSource = (typeof EVENT_SOURCES)[keyof typeof EVENT_SOURCES];

// Type guards for event sources
export function isValidEventSource(source: string): source is EventSource {
  return Object.values(EVENT_SOURCES).includes(source as EventSource);
}

export function assertEventSource(
  source: string
): asserts source is EventSource {
  if (!isValidEventSource(source)) {
    throw new Error(
      `Invalid event source: ${source}. Valid sources are: ${Object.values(
        EVENT_SOURCES
      ).join(", ")}`
    );
  }
}

// ================= ALL COMMAND CONSTANTS =================

// Re-export all command constants from individual sources for convenience
export { DEVICE_COMMANDS, DeviceCommandType } from "../device/constants";
export { STATION_COMMANDS, StationCommandType } from "../station/constants";
export { DRIVER_COMMANDS, DriverCommandType } from "../driver/constants";
export { SERVER_COMMANDS, ServerCommandType } from "../server/constants";

// Import for local use
import { DEVICE_COMMANDS, DeviceCommandType } from "../device/constants";
import { STATION_COMMANDS, StationCommandType } from "../station/constants";
import { DRIVER_COMMANDS, DriverCommandType } from "../driver/constants";
import { SERVER_COMMANDS, ServerCommandType } from "../server/constants";

// ================= UNIFIED COMMAND TYPES =================

/**
 * Union of all command types from all sources
 */
export type AllCommandType =
  | DeviceCommandType
  | StationCommandType
  | DriverCommandType
  | ServerCommandType;

/**
 * All command constants in a single object for easy access
 */
export const ALL_COMMANDS = {
  DEVICE: DEVICE_COMMANDS,
  STATION: STATION_COMMANDS,
  DRIVER: DRIVER_COMMANDS,
  SERVER: SERVER_COMMANDS,
} as const;
