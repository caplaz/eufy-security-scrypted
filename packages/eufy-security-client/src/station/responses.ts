/**
 * Response types for station-level commands
 * Based on API documentation in eufy-security-ws/docs/api_cmds.md
 */

import {
  StationPropertyMetadata,
  StationProperties,
  StationPropertyName,
} from "./properties";

// ================= STATION CONNECTION RESPONSES =================

/**
 * Response from station.is_connected
 * Can be either success with connection status or error
 */
export type StationIsConnectedResponse = {
  serialNumber: string; // added with schema version: 4+
  connected: boolean;
};

// ================= STATION PROPERTY RESPONSES =================

/**
 * Response from station.get_properties_metadata
 * Can be either success with metadata or error
 */
export type StationGetPropertiesMetadataResponse = {
  properties: {
    [K in StationPropertyName]?: StationPropertyMetadata;
  };
};

/**
 * Response from station.get_properties
 * Can be either success with properties or error
 */
export type StationGetPropertiesResponse = {
  serialNumber: string; // added with schema version: 4+
  properties: StationProperties;
};

/**
 * Response from station.has_property
 * Can be either success with exists flag or error
 */
export type StationHasPropertyResponse = {
  serialNumber: string; // added with schema version: 4+
  exists: boolean;
};

/**
 * Response from station.has_command
 * Can be either success with exists flag or error
 */
export type StationHasCommandResponse = {
  serialNumber: string; // added with schema version: 4+
  exists: boolean;
};

// ================= STATION DATABASE RESPONSES =================

/**
 * Database query result structure
 */
export interface StationDatabaseRecord {
  id?: string;
  timestamp?: number;
  eventType?: number;
}

/**
 * Response from station.database_query_latest_info
 * Can be either success with records or error
 */
export type StationDatabaseQueryLatestInfoResponse = {
  records: StationDatabaseRecord[];
};

/**
 * Response from station.database_query_local
 * Can be either success with records or error
 */
export type StationDatabaseQueryLocalResponse = {
  records: StationDatabaseRecord[];
};

/**
 * Response from station.database_count_by_date
 * Can be either success with count and date or error
 */
export type StationDatabaseCountByDateResponse = {
  count: number;
  date: string;
};

// ================= COMMAND-RESPONSE MAPPING =================

import { STATION_COMMANDS } from "./constants";

/**
 * Maps station commands to their expected response types
 */
export interface StationCommandResponseMap {
  [STATION_COMMANDS.GET_PROPERTIES]: StationGetPropertiesResponse;
  [STATION_COMMANDS.GET_PROPERTIES_METADATA]: StationGetPropertiesMetadataResponse;
  [STATION_COMMANDS.HAS_PROPERTY]: StationHasPropertyResponse;
  [STATION_COMMANDS.HAS_COMMAND]: StationHasCommandResponse;
  [STATION_COMMANDS.GET_COMMANDS]: StationGetPropertiesResponse; // Re-using StationGetPropertiesResponse for now
  [STATION_COMMANDS.IS_CONNECTED]: StationIsConnectedResponse;
  [STATION_COMMANDS.CONNECT]: {};
  [STATION_COMMANDS.DISCONNECT]: {};
  [STATION_COMMANDS.REBOOT]: {};
  [STATION_COMMANDS.TRIGGER_ALARM]: {};
  [STATION_COMMANDS.RESET_ALARM]: {};
  [STATION_COMMANDS.CHIME]: {};
  [STATION_COMMANDS.DOWNLOAD_IMAGE]: {};
  [STATION_COMMANDS.DATABASE_QUERY_LATEST_INFO]: StationDatabaseQueryLatestInfoResponse;
  [STATION_COMMANDS.DATABASE_QUERY_LOCAL]: StationDatabaseQueryLocalResponse;
  [STATION_COMMANDS.DATABASE_COUNT_BY_DATE]: StationDatabaseCountByDateResponse;
  [STATION_COMMANDS.DATABASE_DELETE]: {};
  [STATION_COMMANDS.SET_PROPERTY]: {};
}

// ================= UNION TYPES =================

/**
 * Union type of all station response types
 * All responses can potentially be success or error responses
 */
export type StationResponse =
  | StationIsConnectedResponse
  | StationGetPropertiesMetadataResponse
  | StationGetPropertiesResponse
  | StationHasPropertyResponse
  | StationHasCommandResponse
  | StationDatabaseQueryLatestInfoResponse
  | StationDatabaseQueryLocalResponse
  | StationDatabaseCountByDateResponse;
