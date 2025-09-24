/**
 * Unified station properties interface for Eufy stations
 *
 * Contains all possible station properties from all schema versions, including network, alarm, and security fields.
 * Used for type safety and property mapping throughout the client and plugin.
 */

import { CommonEufyProperties } from "../types/common-properties";
import { PropertyMetadataAny } from "../types/shared";
import { AlarmMode, GuardMode } from "./constants";

/**
 * Unified station properties interface.
 * Contains all possible station properties from all schema versions (up to schema 21).
 * Properties may be optional since not all stations support all features.
 */
export interface StationProperties extends CommonEufyProperties {
  // Network & Connectivity
  lanIpAddress?: string;
  macAddress?: string;
  wifiRssi?: number;
  wifiSignalLevel?: number;

  // Station Modes
  guardMode: GuardMode;
  currentMode: AlarmMode;

  // Time & Schedule
  timeFormat?: number;
  timezone?: string;
  dstOffset?: number;

  // Volumes
  alarmVolume?: number;
  alarmTone?: number;
  promptVolume?: number;
  ringtoneVolume?: number;

  // Notification Switches
  notificationSwitchModeSchedule?: boolean;
  notificationSwitchModeGeofence?: boolean;
  notificationSwitchModeApp?: boolean;
  notificationSwitchModeKeypad?: boolean;
  notificationStartAlarmDelay?: boolean;
  switchModeWithAccessCode?: boolean;
  autoEndAlarm?: boolean;
  turnOffAlarmWithButton?: boolean;

  // Security Settings
  stationHomeSecuritySettings?: string;
  stationAwaySecuritySettings?: string;
  stationCustom1SecuritySettings?: string;
  stationCustom2SecuritySettings?: string;
  stationCustom3SecuritySettings?: string;
  stationOffSecuritySettings?: string;

  // Alarm & Delay
  alarm?: boolean;
  alarmType?: number;
  alarmArmed?: boolean;
  alarmArmDelay?: number;
  alarmDelay?: number;
  alarmDelayType?: number;

  // Advanced Features (schema >= 21)
  storageInfoEmmc?: object;
  storageInfoHdd?: object;
  crossCameraTracking?: boolean;
  continuousTrackingTime?: number;
  trackingAssistance?: boolean;
  crossTrackingCameraList?: object;
  crossTrackingGroupList?: object;

  // Storage & Recording (legacy/extra)
  storageType?: number;
  storageCapacity?: number;
  storageAvailable?: number;

  // Firmware & Updates
  automaticFirmwareUpdate?: boolean;
  lastUpdateTime?: number;
}

export type StationPropertyName = keyof StationProperties;
export type StationPropertyMetadata = PropertyMetadataAny;
export type StationPropertiesMetadata = Record<
  StationPropertyName,
  PropertyMetadataAny
>;
