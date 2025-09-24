/**
 * Response types for driver-level commands in the Eufy WebSocket API
 *
 * Defines all response types for driver commands, based on the API documentation.
 * Driver responses are direct WebSocket protocol responses, not BaseApiResponse wrappers.
 */

/**
 * Response from driver.set_verify_code
 * Returns: { result: boolean }
 */
export interface DriverSetVerifyCodeResponse {
  result: boolean;
}

/**
 * Response from driver.set_captcha
 * Returns: { result: boolean }
 */
export interface DriverSetCaptchaResponse {
  result: boolean;
}

// ================= DRIVER CONNECTION RESPONSES =================

/**
 * Response from driver.is_connected
 * Returns: { connected: boolean }
 */
export interface DriverIsConnectedResponse {
  connected: boolean;
}

/**
 * Response from driver.is_push_connected
 * Returns: { connected: boolean }
 */
export interface DriverIsPushConnectedResponse {
  connected: boolean;
}

/**
 * Response from driver.is_mqtt_connected
 * Returns: { connected: boolean }
 */
export interface DriverIsMqttConnectedResponse {
  connected: boolean;
}

/**
 * Response from driver.connect
 * Returns: { result: boolean }
 */
export interface DriverConnectResponse {
  result: boolean;
}

// ================= DRIVER EVENT RESPONSES =================

/**
 * Event record structure for video/alarm/history events
 */
export interface DriverEventRecord {
  startTime: number;
  endTime: number;
  thumbnailUrl?: string;
  videoUrl?: string;
  eventType: number;
  stationSN: string;
  storageType: number;
}

/**
 * Response from driver.get_video_events
 * Returns: { events: Array<EventRecordResponse> }
 */
export interface DriverGetVideoEventsResponse {
  events: DriverEventRecord[];
}

/**
 * Response from driver.get_alarm_events
 * Returns: { events: Array<EventRecordResponse> }
 */
export interface DriverGetAlarmEventsResponse {
  events: DriverEventRecord[];
}

/**
 * Response from driver.get_history_events
 * Returns: { events: Array<EventRecordResponse> }
 */
export interface DriverGetHistoryEventsResponse {
  events: DriverEventRecord[];
}

// ================= DRIVER LOG RESPONSES =================

/**
 * Response from driver.get_log_level
 * Returns: { level: string }
 */
export interface DriverGetLogLevelResponse {
  level: "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

/**
 * Response from driver.is_listening_logs
 * Returns: { started: boolean }
 */
export interface DriverIsListeningLogsResponse {
  started: boolean;
}

// ================= COMMAND-RESPONSE MAPPING =================

import { DRIVER_COMMANDS } from "./constants";

/**
 * Maps driver commands to their expected response types
 * Note: Driver responses are direct objects, not {} wrappers
 */
export interface DriverCommandResponseMap {
  [DRIVER_COMMANDS.CONNECT]: DriverConnectResponse;
  [DRIVER_COMMANDS.DISCONNECT]: {};
  [DRIVER_COMMANDS.IS_CONNECTED]: DriverIsConnectedResponse;
  [DRIVER_COMMANDS.IS_PUSH_CONNECTED]: DriverIsPushConnectedResponse;
  [DRIVER_COMMANDS.IS_MQTT_CONNECTED]: DriverIsMqttConnectedResponse;
  [DRIVER_COMMANDS.SET_VERIFY_CODE]: DriverSetVerifyCodeResponse;
  [DRIVER_COMMANDS.SET_CAPTCHA]: DriverSetCaptchaResponse;
  [DRIVER_COMMANDS.GET_VIDEO_EVENTS]: DriverGetVideoEventsResponse;
  [DRIVER_COMMANDS.GET_ALARM_EVENTS]: DriverGetAlarmEventsResponse;
  [DRIVER_COMMANDS.GET_HISTORY_EVENTS]: DriverGetHistoryEventsResponse;
  [DRIVER_COMMANDS.POLL_REFRESH]: {};
  [DRIVER_COMMANDS.SET_LOG_LEVEL]: {};
  [DRIVER_COMMANDS.GET_LOG_LEVEL]: DriverGetLogLevelResponse;
  [DRIVER_COMMANDS.START_LISTENING_LOGS]: {};
  [DRIVER_COMMANDS.STOP_LISTENING_LOGS]: {};
  [DRIVER_COMMANDS.IS_LISTENING_LOGS]: DriverIsListeningLogsResponse;
}

// ================= UNION TYPES =================

/**
 * Union type of all driver response types
 * Driver responses are direct objects, not wrapped in BaseApiResponse
 */
export type DriverResponse =
  | DriverSetVerifyCodeResponse
  | DriverSetCaptchaResponse
  | DriverIsConnectedResponse
  | DriverIsPushConnectedResponse
  | DriverIsMqttConnectedResponse
  | DriverConnectResponse
  | DriverGetVideoEventsResponse
  | DriverGetAlarmEventsResponse
  | DriverGetHistoryEventsResponse
  | DriverGetLogLevelResponse
  | DriverIsListeningLogsResponse;
