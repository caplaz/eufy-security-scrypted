/**
 * Command base types and helpers for Eufy Security WebSocket Client.
 *
 * Provides base command interfaces, command/response mapping types, and helpers for all command sources.
 * These types ensure type safety across all command operations and provide compile-time validation.
 *
 * @public
 */

/**
 * Base interface for all WebSocket commands
 *
 * @template TCommand - The specific command type string
 * @public
 */
export interface BaseCommand<TCommand extends string> {
  /** The command identifier */
  command: TCommand;
}

/**
 * Base interface for commands that require a device/station serial number
 *
 * @template TCommand - The specific command type string
 * @public
 */
export interface BaseCommandWithSerial<TCommand extends string>
  extends BaseCommand<TCommand> {
  /** Device or station serial number */
  serialNumber: string;
}

// Command/response mapping types and helpers
// These are imported from device, station, driver, server responses
import { DeviceCommandResponseMap } from "../device/responses";
import { StationCommandResponseMap } from "../station/responses";
import { DriverCommandResponseMap } from "../driver/responses";
import { ServerCommandResponseMap } from "../server/responses";
import {
  DEVICE_COMMANDS,
  STATION_COMMANDS,
  DRIVER_COMMANDS,
  SERVER_COMMANDS,
} from "../common/constants";
import type { DeviceCommand } from "../device/commands";
import type { StationCommand } from "../station/commands";
import type { DriverCommand } from "../driver/commands";
import type { ServerCommand } from "../server/commands";

export type AllCommandResponseMap = DeviceCommandResponseMap &
  StationCommandResponseMap &
  DriverCommandResponseMap &
  ServerCommandResponseMap;

/**
 * Maps a command type to its corresponding response type.
 * Ensures type safety for command responses.
 */
export type ResponseForCommand<T extends keyof AllCommandResponseMap> =
  AllCommandResponseMap[T];

/**
 * Represents the parameters for a specific command.
 * Ensures type safety for command parameters.
 *
 * @template T - The type of the command.
 */
export type ParamsForCommand<T extends SupportedCommandType> =
  T extends keyof AllParameterMaps ? AllParameterMaps[T] : {};

export type SupportedCommandType = keyof AllCommandResponseMap;

// Union of all supported command types
export type EufySupportedCommand =
  | DeviceCommand
  | StationCommand
  | DriverCommand
  | ServerCommand;

export type ExtractParams<T> = Omit<T, "command" | "messageId">;
/**
 * Extracts the parameters for a specific command type.
 * Omits the `command` and `messageId` fields from the command definition.
 *
 * @template T - The command type to extract parameters for.
 */

/**
 * Maps all supported commands to their parameter types.
 * Used internally for type safety in command parameter handling.
 */
export type AllParameterMaps = {
  [K in EufySupportedCommand as K["command"]]: ExtractParams<K>;
};

/**
 * Type guard to check if a command string is a supported command type
 *
 * @param command - Command string to validate
 * @returns true if the command is supported, false otherwise
 *
 * @example
 * ```typescript
 * if (isSupportedCommand(userInput)) {
 *   // userInput is now typed as SupportedCommandType
 *   await client.sendCommand(userInput, params);
 * }
 * ```
 *
 * @public
 */
export function isSupportedCommand(
  command: string,
): command is SupportedCommandType {
  const allSupportedCommands = [
    ...Object.values(DEVICE_COMMANDS),
    ...Object.values(STATION_COMMANDS),
    ...Object.values(DRIVER_COMMANDS),
    ...Object.values(SERVER_COMMANDS),
  ];
  return allSupportedCommands.includes(command as SupportedCommandType);
}
