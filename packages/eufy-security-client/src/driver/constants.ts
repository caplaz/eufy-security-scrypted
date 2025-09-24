/**
 * Driver level command constants for Eufy WebSocket API
 *
 * Contains all driver command string constants and enums for driver operations and events.
 */
export const DRIVER_COMMANDS = {
  SET_VERIFY_CODE: "driver.set_verify_code",
  SET_CAPTCHA: "driver.set_captcha",
  POLL_REFRESH: "driver.poll_refresh",
  IS_CONNECTED: "driver.is_connected",
  IS_PUSH_CONNECTED: "driver.is_push_connected",
  CONNECT: "driver.connect",
  DISCONNECT: "driver.disconnect",
  GET_VIDEO_EVENTS: "driver.get_video_events",
  GET_ALARM_EVENTS: "driver.get_alarm_events",
  GET_HISTORY_EVENTS: "driver.get_history_events",
  IS_MQTT_CONNECTED: "driver.is_mqtt_connected",
  SET_LOG_LEVEL: "driver.set_log_level",
  GET_LOG_LEVEL: "driver.get_log_level",
  START_LISTENING_LOGS: "driver.start_listening_logs",
  STOP_LISTENING_LOGS: "driver.stop_listening_logs",
  IS_LISTENING_LOGS: "driver.is_listening_logs",
} as const;

export type DriverCommandType =
  (typeof DRIVER_COMMANDS)[keyof typeof DRIVER_COMMANDS];

/**
 * Driver event constants
 */
export const DRIVER_EVENTS = {
  VERIFY_CODE: "verify code",
  CAPTCHA_REQUEST: "captcha request",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  PUSH_CONNECTED: "push connected",
  PUSH_DISCONNECTED: "push disconnected",
  MQTT_CONNECTED: "mqtt connected",
  MQTT_DISCONNECTED: "mqtt disconnected",
  LOG_LEVEL_CHANGED: "log level changed",
  LOGGING: "logging",
  CONNECTION_ERROR: "connection error",
} as const;

export type DriverEventType =
  (typeof DRIVER_EVENTS)[keyof typeof DRIVER_EVENTS];

export enum StorageType {
  NONE = 0,
  LOCAL = 1,
  CLOUD = 2,
  LOCAL_AND_CLOUD = 3,
}
