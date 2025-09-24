/**
 * Station level command constants for Eufy WebSocket API
 *
 * Contains all station command string constants and enums for station operations, alarm, and database control.
 */
export const STATION_COMMANDS = {
  REBOOT: "station.reboot",
  IS_CONNECTED: "station.is_connected",
  CONNECT: "station.connect",
  DISCONNECT: "station.disconnect",
  GET_PROPERTIES_METADATA: "station.get_properties_metadata",
  GET_PROPERTIES: "station.get_properties",
  SET_PROPERTY: "station.set_property",
  TRIGGER_ALARM: "station.trigger_alarm",
  RESET_ALARM: "station.reset_alarm",
  SET_GUARD_MODE: "station.set_guard_mode",
  GET_COMMANDS: "station.get_commands",
  HAS_COMMAND: "station.has_command",
  HAS_PROPERTY: "station.has_property",
  CHIME: "station.chime",
  DOWNLOAD_IMAGE: "station.download_image",
  DATABASE_QUERY_LATEST_INFO: "station.database_query_latest_info",
  DATABASE_QUERY_LOCAL: "station.database_query_local",
  DATABASE_COUNT_BY_DATE: "station.database_count_by_date",
  DATABASE_DELETE: "station.database_delete",
} as const;

export type StationCommandType =
  (typeof STATION_COMMANDS)[keyof typeof STATION_COMMANDS];

/**
 * Station event constants
 */
export const STATION_EVENTS = {
  STATION_ADDED: "station added",
  STATION_REMOVED: "station removed",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  PROPERTY_CHANGED: "property changed",
  ALARM_EVENT: "alarm event",
  ALARM_DELAY_EVENT: "alarm delay event",
  ALARM_ARMED_EVENT: "alarm armed event",
  ALARM_ARM_DELAY_EVENT: "alarm arm delay event",
  GUARD_MODE_CHANGED: "guard mode changed",
  CURRENT_MODE_CHANGED: "current mode changed",
  IMAGE_DOWNLOADED: "image downloaded",
  DATABASE_QUERY_LATEST: "database query latest",
  DATABASE_QUERY_LOCAL: "database query local",
  DATABASE_COUNT_BY_DATE: "database count by date",
  DATABASE_DELETE: "database delete",
  COMMAND_RESULT: "command result",
} as const;

export type StationEventType =
  (typeof STATION_EVENTS)[keyof typeof STATION_EVENTS];

export enum AlarmEvent {
  HUB_STOP = 0,
  DEV_STOP = 1,
  GSENSOR = 2,
  PIR = 3,
  APP = 4,
  HOT = 5,
  DOOR = 6,
  CAMERA_PIR = 7,
  MOTION_SENSOR = 8,
  CAMERA_GSENSOR = 9,
  CAMERA_APP = 10,
  CAMERA_LINKAGE = 11,
  HUB_KEYPAD = 13,
  HUB_STOP_BY_KEYPAD = 15,
  HUB_STOP_BY_APP = 16,
  HUB_STOP_BY_HAND = 17,
  APP_LIGHT = 22,
  APP_LIGHT_SOUND = 23,
  MOTION_APP_LIGHT = 24,
  MOTION_APP_LIGHT_ALARM = 25,
}

export enum AlarmMode {
  AWAY = 0,
  HOME = 1,
  CUSTOM1 = 3,
  CUSTOM2 = 4,
  CUSTOM3 = 5,
  DISARMED = 63,
}

export enum GuardMode {
  UNKNOWN = -1,
  AWAY = 0,
  HOME = 1,
  DISARMED = 63,
  SCHEDULE = 2,
  GEO = 47,
  CUSTOM1 = 3,
  CUSTOM2 = 4,
  CUSTOM3 = 5,
  OFF = 6,
}
