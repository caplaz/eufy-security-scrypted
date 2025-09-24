/**
 * Driver command types and interfaces for Eufy driver
 *
 * Defines all command interfaces for driver-level operations in the Eufy Security WebSocket API.
 * Includes authentication, connection, event, and log commands.
 */

import { DRIVER_COMMANDS, DriverCommandType, StorageType } from "./constants";
import { BaseCommand } from "../types/commands";

/**
 * EventFilterType is used for event queries, as per upstream API documentation.
 */
export interface EventFilterType {
  stationSN?: string;
  storageType?: StorageType;
}

/**
 * Base interface for driver commands
 */
export interface BaseDriverCommand<T extends DriverCommandType>
  extends BaseCommand<T> {}

/**
 * Connect to Eufy Cloud command
 */
export interface ConnectCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.CONNECT> {}

/**
 * Disconnect from Eufy Cloud command
 */
export interface DisconnectCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.DISCONNECT> {}

/**
 * Check if driver is connected to Eufy Cloud
 */
export interface IsConnectedCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.IS_CONNECTED> {}

/**
 * Check if push notifications are connected
 */
export interface IsPushConnectedCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.IS_PUSH_CONNECTED> {}

/**
 * Set verification code for 2FA
 */
export interface SetVerifyCodeCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.SET_VERIFY_CODE> {
  captchaId: string;
  verifyCode: string;
}

/**
 * Set captcha for login
 */
export interface SetCaptchaCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.SET_CAPTCHA> {
  captchaId: string;
  captcha: string;
}

/**
 * Poll refresh command
 */
export interface PollRefreshCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.POLL_REFRESH> {}

/**
 * Get video events command
 */
export interface GetVideoEventsCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.GET_VIDEO_EVENTS> {
  startTimestampMs?: number;
  endTimestampMs?: number;
  filter?: EventFilterType;
  maxResults?: number;
}

/**
 * Get alarm events command
 */
export interface GetAlarmEventsCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.GET_ALARM_EVENTS> {
  startTimestampMs?: number;
  endTimestampMs?: number;
  filter?: EventFilterType;
  maxResults?: number;
}

/**
 * Get history events command
 */
export interface GetHistoryEventsCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.GET_HISTORY_EVENTS> {
  startTimestampMs?: number;
  endTimestampMs?: number;
  filter?: EventFilterType;
  maxResults?: number;
}

/**
 * Check if MQTT is connected
 */
export interface IsMqttConnectedCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.IS_MQTT_CONNECTED> {}

/**
 * Set log level command
 */
export interface SetLogLevelCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.SET_LOG_LEVEL> {
  level: string;
}

/**
 * Get log level command
 */
export interface GetLogLevelCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.GET_LOG_LEVEL> {}

/**
 * Start listening to logs command
 */
export interface StartListeningLogsCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.START_LISTENING_LOGS> {}

/**
 * Stop listening to logs command
 */
export interface StopListeningLogsCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.STOP_LISTENING_LOGS> {}

/**
 * Check if listening to logs is started
 */
export interface IsListeningLogsCommand
  extends BaseDriverCommand<typeof DRIVER_COMMANDS.IS_LISTENING_LOGS> {}

/**
 * Union type for all driver commands
 */
export type DriverCommand =
  | ConnectCommand
  | DisconnectCommand
  | IsConnectedCommand
  | IsPushConnectedCommand
  | SetVerifyCodeCommand
  | SetCaptchaCommand
  | PollRefreshCommand
  | GetVideoEventsCommand
  | GetAlarmEventsCommand
  | GetHistoryEventsCommand
  | IsMqttConnectedCommand
  | SetLogLevelCommand
  | GetLogLevelCommand
  | StartListeningLogsCommand
  | StopListeningLogsCommand
  | IsListeningLogsCommand;
