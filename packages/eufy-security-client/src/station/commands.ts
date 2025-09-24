/**
 * Station command types and interfaces for Eufy stations
 *
 * Defines all command interfaces for station-level operations in the Eufy Security WebSocket API.
 * Includes property, connection, alarm, and database commands.
 */

import { BaseCommandWithSerial } from "../types/commands";
import { STATION_COMMANDS, StationCommandType } from "./constants";
import { StationProperties } from "./properties";

/**
 * Base interface for station commands
 */
export interface BaseStationCommand<T extends StationCommandType>
  extends BaseCommandWithSerial<T> {}

/**
 * Station reboot command
 */
export interface StationRebootCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.REBOOT> {}

/**
 * Check if station is connected
 */
export interface StationIsConnectedCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.IS_CONNECTED> {}

/**
 * Connect to station
 */
export interface StationConnectCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.CONNECT> {}

/**
 * Disconnect from station
 */
export interface StationDisconnectCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.DISCONNECT> {}

/**
 * Get station properties metadata
 */
export interface StationGetPropertiesMetadataCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.GET_PROPERTIES_METADATA> {}

/**
 * Get station properties
 */
export interface StationGetPropertiesCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.GET_PROPERTIES> {}

/**
 * Set station property
 */
export interface StationSetPropertyCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.SET_PROPERTY> {
  name: keyof StationProperties;
  value: StationProperties[keyof StationProperties];
}

/**
 * Check if station has property
 */
export interface StationHasPropertyCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.HAS_PROPERTY> {
  propertyName: keyof StationProperties;
}

/**
 * Get station commands
 */
export interface StationGetCommandsCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.GET_COMMANDS> {}

/**
 * Check if station has command
 */
export interface StationHasCommandCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.HAS_COMMAND> {
  commandName: string;
}

/**
 * Trigger station alarm
 */
export interface StationTriggerAlarmCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.TRIGGER_ALARM> {
  seconds: number;
}

/**
 * Reset station alarm
 */
export interface StationResetAlarmCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.RESET_ALARM> {}

/**
 * Station chime command
 */
export interface StationChimeCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.CHIME> {
  ringtone: number;
}

/**
 * Download image from station
 */
export interface StationDownloadImageCommand
  extends BaseStationCommand<typeof STATION_COMMANDS.DOWNLOAD_IMAGE> {
  file: string;
}

/**
 * Union type for all station commands
 */
export type StationCommand =
  | StationRebootCommand
  | StationIsConnectedCommand
  | StationConnectCommand
  | StationDisconnectCommand
  | StationGetPropertiesMetadataCommand
  | StationGetPropertiesCommand
  | StationSetPropertyCommand
  | StationHasPropertyCommand
  | StationGetCommandsCommand
  | StationHasCommandCommand
  | StationTriggerAlarmCommand
  | StationResetAlarmCommand
  | StationChimeCommand
  | StationDownloadImageCommand;
