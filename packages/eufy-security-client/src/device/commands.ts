/**
 * Device command types and interfaces for Eufy devices
 *
 * Defines all command interfaces for device-level operations in the Eufy Security WebSocket API.
 * Includes property, streaming, alarm, camera control, and talkback commands.
 */

// Device command types and interfaces for Eufy devices
import {
  DEVICE_COMMANDS,
  DeviceCommandType,
  PanTiltDirection,
} from "./constants";
import { BaseCommandWithSerial } from "../types/commands";
import { DeviceProperties } from "./properties";

/**
 * Base interface for device commands
 */
export interface BaseDeviceCommand<T extends DeviceCommandType>
  extends BaseCommandWithSerial<T> {}

/**
 * Get device properties metadata
 */
export interface DeviceGetPropertiesMetadataCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.GET_PROPERTIES_METADATA> {}

/**
 * Get device properties
 */
export interface DeviceGetPropertiesCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.GET_PROPERTIES> {}

/**
 * Set device property
 */
export interface DeviceSetPropertyCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.SET_PROPERTY> {
  name: keyof DeviceProperties;
  value: DeviceProperties[keyof DeviceProperties];
}

/**
 * Check if device has property
 */
export interface DeviceHasPropertyCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.HAS_PROPERTY> {
  propertyName: keyof DeviceProperties;
}

/**
 * Get device commands
 */
export interface DeviceGetCommandsCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.GET_COMMANDS> {}

/**
 * Check if device has command
 */
export interface DeviceHasCommandCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.HAS_COMMAND> {
  commandName: string;
}

/**
 * Start livestream
 */
export interface DeviceStartLivestreamCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.START_LIVESTREAM> {}

/**
 * Stop livestream
 */
export interface DeviceStopLivestreamCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.STOP_LIVESTREAM> {}

/**
 * Check if livestreaming
 */
export interface DeviceIsLivestreamingCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.IS_LIVESTREAMING> {}

/**
 * Start RTSP livestream
 */
export interface DeviceStartRtspLivestreamCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.START_RTSP_LIVESTREAM> {}

/**
 * Stop RTSP livestream
 */
export interface DeviceStopRtspLivestreamCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.STOP_RTSP_LIVESTREAM> {}

/**
 * Pan and tilt camera
 */
export interface DevicePanAndTiltCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.PAN_AND_TILT> {
  direction: PanTiltDirection;
}

/**
 * Calibrate camera
 */
export interface DeviceCalibrateCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.CALIBRATE> {}

/**
 * Quick response
 */
export interface DeviceQuickResponseCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.QUICK_RESPONSE> {
  voiceId: number;
}

/**
 * Get available voices
 */
export interface DeviceGetVoicesCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.GET_VOICES> {}

/**
 * Start talkback
 */
export interface DeviceStartTalkbackCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.START_TALKBACK> {}

/**
 * Stop talkback
 */
export interface DeviceStopTalkbackCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.STOP_TALKBACK> {}

/**
 * Unlock device (for locks)
 */
export interface DeviceUnlockCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.UNLOCK> {}

/**
 * Trigger device alarm
 */
export interface DeviceTriggerAlarmCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.TRIGGER_ALARM> {
  seconds: number;
}

/**
 * Reset device alarm
 */
export interface DeviceResetAlarmCommand
  extends BaseDeviceCommand<typeof DEVICE_COMMANDS.RESET_ALARM> {}

/**
 * Union type for all device commands
 */
export type DeviceCommand =
  | DeviceGetPropertiesMetadataCommand
  | DeviceGetPropertiesCommand
  | DeviceSetPropertyCommand
  | DeviceHasPropertyCommand
  | DeviceGetCommandsCommand
  | DeviceHasCommandCommand
  | DeviceStartLivestreamCommand
  | DeviceStopLivestreamCommand
  | DeviceIsLivestreamingCommand
  | DeviceStartRtspLivestreamCommand
  | DeviceStopRtspLivestreamCommand
  | DevicePanAndTiltCommand
  | DeviceCalibrateCommand
  | DeviceQuickResponseCommand
  | DeviceGetVoicesCommand
  | DeviceStartTalkbackCommand
  | DeviceStopTalkbackCommand
  | DeviceUnlockCommand
  | DeviceTriggerAlarmCommand
  | DeviceResetAlarmCommand;
