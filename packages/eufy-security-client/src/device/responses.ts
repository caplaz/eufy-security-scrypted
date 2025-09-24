/**
 * Response types for device-level commands
 * Based on API documentation in eufy-security-ws/docs/api_cmds.md
 */

import {
  DeviceProperties,
  DevicePropertyMetadata,
  DevicePropertyName,
} from "./properties";

/**
 * Response from device.get_properties_metadata
 * Can be either success with metadata or error
 */
export type DeviceGetPropertiesMetadataResponse = {
  serialNumber: string; // added with schema version: 4+
  properties: {
    [K in DevicePropertyName]?: DevicePropertyMetadata;
  };
};

/**
 * Response from device.get_properties
 * Can be either success with properties or error
 */
export type DeviceGetPropertiesResponse = {
  serialNumber: string; // added with schema version: 4+
  properties: DeviceProperties;
};

/**
 * Response from device.has_property
 * Can be either success with exists flag or error
 */
export type DeviceHasPropertyResponse = {
  serialNumber: string; // added with schema version: 4+
  exists: boolean;
};

/**
 * Response from device.has_command
 * Can be either success with exists flag or error
 */
export type DeviceHasCommandResponse = {
  serialNumber: string; // added with schema version: 4+
  exists: boolean;
};

// ================= DEVICE STREAMING RESPONSES =================

/**
 * Response from device.is_livestreaming
 * Can be either success with livestreaming status or error
 */
export type DeviceIsLivestreamingResponse = {
  serialNumber: string; // added with schema version: 4+
  livestreaming: boolean;
};

/**
 * Response from device.is_rtsp_livestreaming
 * Can be either success with livestreaming status or error
 */
export type DeviceIsRtspLivestreamingResponse = {
  serialNumber: string; // added with schema version: 4+
  livestreaming: boolean;
};

/**
 * Response from device.is_downloading
 * Can be either success with downloading status or error
 */
export type DeviceIsDownloadingResponse = {
  serialNumber: string; // added with schema version: 4+
  downloading: boolean;
};

// ================= DEVICE USER MANAGEMENT RESPONSES =================

/**
 * User information structure
 */
export interface DeviceUser {
  username: string;
  userId?: string;
  passcode?: string;
  schedule?: any; // Schedule object structure would need more definition
  [key: string]: any; // Allow additional user properties
}

/**
 * Response from device.get_users
 * Returns users array without serialNumber according to API docs
 */
export type DeviceGetUsersResponse = {
  users: DeviceUser[];
};

/**
 * Response from device.get_voices
 * Can be either success with voices or error
 */
export type DeviceGetVoicesResponse = {
  serialNumber: string; // added with schema version: 4+
  voices: any; // Voices type would need more definition
};

/**
 * Response from device.get_commands
 * Can be either success with commands array or error
 */
export type DeviceGetCommandsResponse = {
  serialNumber: string; // added with schema version: 4+
  commands: string[];
};

/**
 * Response from device.is_talkback_ongoing
 * Can be either success with talkback status or error
 */
export type DeviceIsTalkbackOngoingResponse = {
  serialNumber: string;
  talkbackOngoing: boolean;
};

// ================= UNION TYPES =================

/**
 * Union type of all device response types
 * All responses can potentially be success or error responses
 */
export type DeviceResponse =
  | DeviceGetPropertiesMetadataResponse
  | DeviceGetPropertiesResponse
  | DeviceHasPropertyResponse
  | DeviceHasCommandResponse
  | DeviceIsLivestreamingResponse
  | DeviceIsRtspLivestreamingResponse
  | DeviceIsDownloadingResponse
  | DeviceGetUsersResponse
  | DeviceGetVoicesResponse
  | DeviceGetCommandsResponse
  | DeviceIsTalkbackOngoingResponse;

// ================= COMMAND-RESPONSE MAPPING =================

import { DEVICE_COMMANDS } from "./constants";

/**
 * Maps device commands to their expected response types
 */
export interface DeviceCommandResponseMap {
  [DEVICE_COMMANDS.GET_PROPERTIES]: DeviceGetPropertiesResponse;
  [DEVICE_COMMANDS.GET_PROPERTIES_METADATA]: DeviceGetPropertiesMetadataResponse;
  [DEVICE_COMMANDS.HAS_PROPERTY]: DeviceHasPropertyResponse;
  [DEVICE_COMMANDS.HAS_COMMAND]: DeviceHasCommandResponse;
  [DEVICE_COMMANDS.GET_COMMANDS]: DeviceGetCommandsResponse;
  [DEVICE_COMMANDS.IS_LIVESTREAMING]: DeviceIsLivestreamingResponse;
  [DEVICE_COMMANDS.START_LIVESTREAM]: {};
  [DEVICE_COMMANDS.STOP_LIVESTREAM]: {};
  [DEVICE_COMMANDS.IS_RTSP_LIVESTREAMING]: DeviceIsRtspLivestreamingResponse;
  [DEVICE_COMMANDS.START_RTSP_LIVESTREAM]: {};
  [DEVICE_COMMANDS.STOP_RTSP_LIVESTREAM]: {};
  [DEVICE_COMMANDS.IS_DOWNLOADING]: DeviceIsDownloadingResponse;
  [DEVICE_COMMANDS.START_DOWNLOAD]: {};
  [DEVICE_COMMANDS.CANCEL_DOWNLOAD]: {};
  [DEVICE_COMMANDS.TRIGGER_ALARM]: {};
  [DEVICE_COMMANDS.RESET_ALARM]: {};
  [DEVICE_COMMANDS.PAN_AND_TILT]: {};
  [DEVICE_COMMANDS.CALIBRATE]: {};
  [DEVICE_COMMANDS.QUICK_RESPONSE]: {};
  [DEVICE_COMMANDS.GET_VOICES]: DeviceGetVoicesResponse;
  [DEVICE_COMMANDS.START_TALKBACK]: {};
  [DEVICE_COMMANDS.STOP_TALKBACK]: {};
  [DEVICE_COMMANDS.IS_TALKBACK_ONGOING]: DeviceIsTalkbackOngoingResponse;
  [DEVICE_COMMANDS.TALKBACK_AUDIO_DATA]: {};
  [DEVICE_COMMANDS.CALIBRATE_LOCK]: {};
  [DEVICE_COMMANDS.UNLOCK]: {};
  [DEVICE_COMMANDS.SNOOZE]: {};

  // User management
  [DEVICE_COMMANDS.ADD_USER]: {};
  [DEVICE_COMMANDS.DELETE_USER]: {};
  [DEVICE_COMMANDS.GET_USERS]: DeviceGetUsersResponse;
  [DEVICE_COMMANDS.UPDATE_USER]: {};
  [DEVICE_COMMANDS.UPDATE_USER_PASSCODE]: {};
  [DEVICE_COMMANDS.UPDATE_USER_SCHEDULE]: {};
  [DEVICE_COMMANDS.VERIFY_PIN]: {};

  // Device control
  [DEVICE_COMMANDS.OPEN]: {};
  [DEVICE_COMMANDS.SET_STATUS_LED]: {};
  [DEVICE_COMMANDS.SET_AUTO_NIGHT_VISION]: {};
  [DEVICE_COMMANDS.SET_MOTION_DETECTION]: {};
  [DEVICE_COMMANDS.SET_SOUND_DETECTION]: {};
  [DEVICE_COMMANDS.SET_PET_DETECTION]: {};
  [DEVICE_COMMANDS.SET_RTSP_STREAM]: {};
  [DEVICE_COMMANDS.SET_ANTI_THEFT_DETECTION]: {};
  [DEVICE_COMMANDS.SET_WATERMARK]: {};
  [DEVICE_COMMANDS.ENABLE_DEVICE]: {};
  [DEVICE_COMMANDS.LOCK_DEVICE]: {};

  [DEVICE_COMMANDS.SET_PROPERTY]: {};
}
