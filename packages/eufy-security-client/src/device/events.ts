/**
 * Eufy WebSocket API Device Events
 *
 * Contains TypeScript interfaces for device-level event payloads in the Eufy Security WebSocket API.
 * Uses official types from the upstream eufy-security-client repository where possible.
 *
 * See: eufy-security-ws/docs/api_events.md for event schema details.
 */

/**
 * Eufy WebSocket API Device Events
 * Schema 13+ Compatible Events
 *
 * This file contains TypeScript interfaces for
 * device-level event payloads in the Eufy Security WebSocket API.
 *
 * Based on eufy-security-ws/docs/api_events.md
 * Only includes events that are compatible with schema version 13+.
 * Note: timestamp fields were removed in schema version 10+.
 *
 * IMPORTANT: This file now uses official type definitions from the upstream
 * eufy-security-client repository (https://github.com/bropat/eufy-security-client)
 * instead of custom JSONValue placeholders where possible:
 *
 * - Schedule interface: Official Schedule type for user schedule events
 * - StreamMetadata: Official metadata type for video/audio stream events
 * - VideoMetadata/AudioMetadata: Type aliases derived from StreamMetadata
 *
 * These types provide better type safety and align with the canonical
 * eufy-security-client implementation.
 */

// Import constants and types
import { DEVICE_EVENTS, DeviceEventType } from "./constants";
import { EVENT_SOURCES } from "../common/constants";
import { JSONValue } from "../types/shared";
import { DevicePropertyName } from "./properties";

// Import official types from eufy-security-client upstream repository
// Based on: https://github.com/bropat/eufy-security-client

// Official Schedule interface from eufy-security-client
export interface Schedule {
  startDateTime?: Date;
  endDateTime?: Date;
  week?: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
  };
}

export interface JSONBuffer {
  type: "Buffer";
  data: number[]; // Array of numbers representing binary data
}

// WebSocket API specific metadata interfaces (codec fields are strings in WebSocket API)
export interface VideoMetadata {
  videoCodec: string; // String codec name like "H264", "H265" in WebSocket API
  videoFPS: number;
  videoWidth: number;
  videoHeight: number;
}

export interface AudioMetadata {
  audioCodec: string; // String codec name like "AAC", "AAC_LC" in WebSocket API
}

// Event source types
export type DeviceEventSource = typeof EVENT_SOURCES.DEVICE;

// Base server event payload - minimal structure
export interface BaseDeviceEventPayload<TEventName extends DeviceEventType> {
  source: DeviceEventSource;
  event: TEventName;
}

// Base device event payload with serial number (for most device events)
export interface BaseDeviceEventPayloadWithSerial<
  TEventName extends DeviceEventType
> extends BaseDeviceEventPayload<TEventName> {
  serialNumber: string;
}

// Device management event payloads (use base without serial number)
export interface DeviceAddedEventPayload
  extends BaseDeviceEventPayload<typeof DEVICE_EVENTS.DEVICE_ADDED> {
  device: string; // Device serial number (schema 13+)
}

export interface DeviceRemovedEventPayload
  extends BaseDeviceEventPayload<typeof DEVICE_EVENTS.DEVICE_REMOVED> {
  device: string; // Device serial number (schema 13+)
}

// Property change event payload
// Updated to match API documentation schema 13+ (timestamp removed in schema 10+)
export interface DevicePropertyChangedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.PROPERTY_CHANGED
  > {
  name: DevicePropertyName;
  value: JSONValue;
}

// Motion and detection event payloads
// Updated to match API documentation schema 13+
export interface DeviceMotionDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.MOTION_DETECTED
  > {
  state: boolean;
}

export interface DevicePersonDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.PERSON_DETECTED
  > {
  state: boolean;
  person: string;
}

export interface DevicePetDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.PET_DETECTED> {
  state: boolean;
}

export interface DeviceSoundDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.SOUND_DETECTED
  > {
  state: boolean;
}

export interface DeviceCryingDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.CRYING_DETECTED
  > {
  state: boolean;
}

// Doorbell event payload - updated to use "rings" instead of "doorbell pressed"
export interface DeviceRingsEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.RINGS> {
  state: boolean;
}

// Additional detection events
export interface DeviceStrangerPersonDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.STRANGER_PERSON_DETECTED
  > {
  state: boolean;
}

export interface DeviceVehicleDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.VEHICLE_DETECTED
  > {
  state: boolean;
}

export interface DeviceDogDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.DOG_DETECTED> {
  state: boolean;
}

export interface DeviceDogLickDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.DOG_LICK_DETECTED
  > {
  state: boolean;
}

export interface DeviceDogPoopDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.DOG_POOP_DETECTED
  > {
  state: boolean;
}

export interface DeviceRadarMotionDetectedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.RADAR_MOTION_DETECTED
  > {
  state: boolean;
}

// Sensor events
export interface DeviceSensorOpenEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.SENSOR_OPEN> {
  state: boolean;
}

// Package detection events
export interface DevicePackageDeliveredEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.PACKAGE_DELIVERED
  > {
  state: boolean;
}

export interface DevicePackageStrandedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.PACKAGE_STRANDED
  > {
  state: boolean;
}

export interface DevicePackageTakenEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.PACKAGE_TAKEN> {
  state: boolean;
}

export interface DeviceSomeoneLoiteringEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.SOMEONE_LOITERING
  > {
  state: boolean;
}

// Security events
export interface DeviceLockedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.LOCKED> {
  state: boolean;
}

export interface DeviceWrongTryProtectAlarmEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.WRONG_TRY_PROTECT_ALARM
  > {
  state: boolean;
}

export interface DeviceLongTimeNotCloseEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.LONG_TIME_NOT_CLOSE
  > {
  state: boolean;
}

export interface DeviceLowBatteryEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.LOW_BATTERY> {
  state: boolean;
}

export interface DeviceJammedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.JAMMED> {
  state: boolean;
}

export interface DeviceAlarm911EventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.ALARM_911> {
  state: boolean;
}

export interface DeviceShakeAlarmEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.SHAKE_ALARM> {
  state: boolean;
}

export interface DeviceTamperingEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.TAMPERING> {
  state: boolean;
}

export interface DeviceLowTemperatureEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.LOW_TEMPERATURE
  > {
  state: boolean;
}

export interface DeviceHighTemperatureEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.HIGH_TEMPERATURE
  > {
  state: boolean;
}

export interface DevicePinIncorrectEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.PIN_INCORRECT> {
  state: boolean;
}

export interface DeviceLidStuckEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.LID_STUCK> {
  state: boolean;
}

export interface DeviceBatteryFullyChargedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.BATTERY_FULLY_CHARGED
  > {
  state: boolean;
}

// User management events
export interface DeviceUserAddedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.USER_ADDED> {
  username: string;
  schedule?: Schedule; // Schedule object from upstream eufy-security-client
}

export interface DeviceUserDeletedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.USER_DELETED> {
  username: string;
}

export interface DeviceUserErrorEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.USER_ERROR> {
  username: string;
  error: string;
}

export interface DeviceUserUsernameUpdatedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.USER_USERNAME_UPDATED
  > {
  username: string;
}

export interface DeviceUserScheduleUpdatedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.USER_SCHEDULE_UPDATED
  > {
  username: string;
  schedule: Schedule; // Schedule object from upstream eufy-security-client
}

export interface DeviceUserPasscodeUpdatedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.USER_PASSCODE_UPDATED
  > {
  username: string;
}

export interface DevicePinVerifiedEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.PIN_VERIFIED> {
  username: string;
}

// Streaming event payloads
export interface DeviceLivestreamStartedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.LIVESTREAM_STARTED
  > {
  // No additional properties beyond base
}

export interface DeviceLivestreamStoppedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.LIVESTREAM_STOPPED
  > {
  // No additional properties beyond base
}

export interface DeviceLivestreamVideoDataEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.LIVESTREAM_VIDEO_DATA
  > {
  buffer: JSONBuffer;
  metadata: VideoMetadata; // Video metadata using upstream types
}

export interface DeviceLivestreamAudioDataEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.LIVESTREAM_AUDIO_DATA
  > {
  buffer: JSONBuffer;
  metadata: AudioMetadata; // Audio metadata using upstream types
}

export interface DeviceGotRtspUrlEventPayload
  extends BaseDeviceEventPayloadWithSerial<typeof DEVICE_EVENTS.GOT_RTSP_URL> {
  rtspUrl: string;
}

// Download event payloads
export interface DeviceDownloadStartedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.DOWNLOAD_STARTED
  > {
  // No additional properties beyond base
}

export interface DeviceDownloadFinishedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.DOWNLOAD_FINISHED
  > {
  // No additional properties beyond base
}

export interface DeviceDownloadVideoDataEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.DOWNLOAD_VIDEO_DATA
  > {
  buffer: JSONValue; // Video data serialized as JSONValue (array of numbers or base64 string over WebSocket)
  metadata: VideoMetadata; // Video metadata using upstream types
}

export interface DeviceDownloadAudioDataEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.DOWNLOAD_AUDIO_DATA
  > {
  buffer: JSONValue; // Audio data serialized as JSONValue (array of numbers or base64 string over WebSocket)
  metadata: AudioMetadata; // Audio metadata using upstream types
}

// Command result event payloads
export interface DeviceCommandResultEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.COMMAND_RESULT
  > {
  command: string;
  returnCode: number;
  returnCodeName: string;
  customData?: JSONValue;
}

// Talkback event payloads
export interface DeviceTalkbackStartedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.TALKBACK_STARTED
  > {
  // No additional properties beyond base
}

export interface DeviceTalkbackStoppedEventPayload
  extends BaseDeviceEventPayloadWithSerial<
    typeof DEVICE_EVENTS.TALKBACK_STOPPED
  > {
  // No additional properties beyond base
}

// Union type for all device event payloads
export type DeviceEventPayload =
  | DeviceAddedEventPayload
  | DeviceRemovedEventPayload
  | DevicePropertyChangedEventPayload
  | DeviceMotionDetectedEventPayload
  | DevicePersonDetectedEventPayload
  | DeviceStrangerPersonDetectedEventPayload
  | DevicePetDetectedEventPayload
  | DeviceSoundDetectedEventPayload
  | DeviceCryingDetectedEventPayload
  | DeviceVehicleDetectedEventPayload
  | DeviceDogDetectedEventPayload
  | DeviceDogLickDetectedEventPayload
  | DeviceDogPoopDetectedEventPayload
  | DeviceRadarMotionDetectedEventPayload
  | DeviceRingsEventPayload
  | DeviceSensorOpenEventPayload
  | DevicePackageDeliveredEventPayload
  | DevicePackageStrandedEventPayload
  | DevicePackageTakenEventPayload
  | DeviceSomeoneLoiteringEventPayload
  | DeviceLockedEventPayload
  | DeviceWrongTryProtectAlarmEventPayload
  | DeviceLongTimeNotCloseEventPayload
  | DeviceLowBatteryEventPayload
  | DeviceJammedEventPayload
  | DeviceAlarm911EventPayload
  | DeviceShakeAlarmEventPayload
  | DeviceTamperingEventPayload
  | DeviceLowTemperatureEventPayload
  | DeviceHighTemperatureEventPayload
  | DevicePinIncorrectEventPayload
  | DeviceLidStuckEventPayload
  | DeviceBatteryFullyChargedEventPayload
  | DeviceUserAddedEventPayload
  | DeviceUserDeletedEventPayload
  | DeviceUserErrorEventPayload
  | DeviceUserUsernameUpdatedEventPayload
  | DeviceUserScheduleUpdatedEventPayload
  | DeviceUserPasscodeUpdatedEventPayload
  | DevicePinVerifiedEventPayload
  | DeviceLivestreamStartedEventPayload
  | DeviceLivestreamStoppedEventPayload
  | DeviceLivestreamVideoDataEventPayload
  | DeviceLivestreamAudioDataEventPayload
  | DeviceGotRtspUrlEventPayload
  | DeviceDownloadStartedEventPayload
  | DeviceDownloadFinishedEventPayload
  | DeviceDownloadVideoDataEventPayload
  | DeviceDownloadAudioDataEventPayload
  | DeviceCommandResultEventPayload
  | DeviceTalkbackStartedEventPayload
  | DeviceTalkbackStoppedEventPayload;

// Helper type to get specific event payload by event type
export type DeviceEventPayloadByType<T extends DeviceEventType> = Extract<
  DeviceEventPayload,
  { event: T }
>;

// Event listener type for device events
export type DeviceEventListener<T extends DeviceEventType> = (
  event: DeviceEventPayloadByType<T>
) => void;

// Generic device event listener
export type AnyDeviceEventListener = (event: DeviceEventPayload) => void;
