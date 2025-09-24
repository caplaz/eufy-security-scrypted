/**
 * Unified device properties interface for Eufy devices
 *
 * Contains all possible device properties from all schema versions, including battery, network, and feature-specific fields.
 * Used for type safety and property mapping throughout the client and plugin.
 */

import { CommonEufyProperties } from "../types/common-properties";
import { PropertyMetadataAny } from "../types/shared";
import {
  PowerWorkingMode,
  ChargingStatus,
  MotionDetectionType,
  SoundDetectionType,
  WatermarkMode,
  VideoQuality,
  LockStatus,
  ContinuousRecordingType,
  NotificationType,
} from "./constants";

/**
 * Unified device properties interface.
 * Contains all possible device properties from all schema versions.
 * Properties may be optional since not all devices support all features.
 */
export interface DeviceProperties extends CommonEufyProperties {
  // Basic device info
  stationSerialNumber: string;

  // Battery & Power
  battery: number;
  batteryTemperature: number;
  batteryLow: boolean;
  batteryIsCharging: boolean;
  lastChargingDays: number;
  lastChargingTotalEvents: number;
  lastChargingRecordedEvents: number;
  lastChargingFalseEvents: number;
  batteryUsageLastWeek: number;
  powerSource: number;
  powerWorkingMode: PowerWorkingMode;
  chargingStatus: ChargingStatus;
  powerSave?: boolean;

  // Network & Connectivity
  wifiRssi: number;
  wifiSignalLevel: number;
  cellularRSSI?: number;
  cellularSignalLevel?: number;
  cellularSignal?: string;
  cellularBand?: string;
  cellularIMEI?: string;
  cellularICCID?: string;

  // Basic Settings
  enabled: boolean;
  statusLed: boolean;
  state: number;

  // Motion Detection
  motionDetection: boolean;
  motionDetectionType: MotionDetectionType;
  motionDetectionSensitivity: number;
  motionDetectionTypeHuman: boolean;
  motionDetectionTypeHumanRecognition: boolean;
  motionDetectionTypePet: boolean;
  motionDetectionTypeVehicle: boolean;
  motionDetectionTypeAllOtherMotions: boolean;
  motionZone: string;
  motionDetectionRange: boolean;
  motionDetectionRangeStandardSensitivity: number;
  motionDetectionRangeAdvancedLeftSensitivity: number;
  motionDetectionRangeAdvancedMiddleSensitivity: number;
  motionDetectionRangeAdvancedRightSensitivity: number;
  motionDetectionTestMode: boolean;
  motionDetected: boolean;
  motionTracking: boolean;
  motionTrackingSensitivity: number;
  motionAutoCruise: boolean;
  motionOutOfViewDetection: boolean;
  motionDetectionSensitivityMode?: number;
  motionDetectionSensitivityStandard?: number;
  motionDetectionSensitivityAdvancedA?: number;
  motionDetectionSensitivityAdvancedB?: number;
  motionDetectionSensitivityAdvancedC?: number;
  motionDetectionSensitivityAdvancedD?: number;
  motionDetectionSensitivityAdvancedE?: number;
  motionDetectionSensitivityAdvancedF?: number;
  motionDetectionSensitivityAdvancedG?: number;
  motionDetectionSensitivityAdvancedH?: number;

  // Person & AI Detection
  personDetected: boolean;
  personName: string;
  identityPersonDetected?: boolean;
  strangerPersonDetected?: boolean;

  // Pet Detection
  petDetection: boolean;
  petDetected: boolean;
  dogDetected?: boolean;
  dogLickDetected?: boolean;
  dogPoopDetected?: boolean;

  // Vehicle Detection
  vehicleDetected?: boolean;

  // Sound Detection
  soundDetection: boolean;
  soundDetectionType: SoundDetectionType;
  soundDetectionSensitivity: number;
  soundDetected: boolean;
  cryingDetected: boolean;
  soundDetectionRoundLook?: boolean;

  // Video & Streaming
  rtspStream: boolean;
  rtspStreamUrl: string;
  watermark: WatermarkMode;
  videoStreamingQuality: VideoQuality;
  videoRecordingQuality: VideoQuality;
  videoWdr: boolean;
  videoHdr: boolean;
  videoDistortionCorrection: boolean;
  videoRingRecord: number;
  videoNightvisionImageAdjustment: boolean;
  videoColorNightvision: boolean;
  videoTypeStoreToNAS?: number;

  // Picture/Image
  picture?: Picture;

  // Audio
  microphone: boolean;
  speaker: boolean;
  speakerVolume: number;
  ringtoneVolume: number;
  audioRecording: boolean;
  chirpVolume: number;
  chirpTone: number;
  alarmVolume?: number;
  promptVolume?: number;
  beepVolume?: number;

  // Night Vision
  autoNightvision: boolean;
  nightvision: boolean;
  nightvisionOptimization?: boolean;
  nightvisionOptimizationSide?: number;

  // Security & Anti-theft
  antitheftDetection: boolean;
  locked: boolean;
  lockStatus: LockStatus;
  autoLock: boolean;
  autoLockTimer: number;
  autoLockSchedule: boolean;
  autoLockScheduleStartTime: string;
  autoLockScheduleEndTime: string;
  oneTouchLocking: boolean;
  wrongTryProtection: boolean;
  wrongTryAttempts: number;
  wrongTryLockdownTime: number;
  scramblePasscode: boolean;
  dualUnlock?: boolean;
  remoteUnlock?: boolean;
  remoteUnlockMasterPIN?: boolean;
  tamperAlarm?: number;
  tamperingAlert?: boolean;
  jammedAlert?: boolean;
  "911Alert"?: boolean;
  "911AlertEvent"?: boolean;
  shakeAlert?: boolean;
  shakeAlertEvent?: boolean;
  lowBatteryAlert?: boolean;
  longTimeNotCloseAlert?: boolean;
  wrongTryProtectAlert?: boolean;
  leftOpenAlarm?: boolean;
  leftOpenAlarmDuration?: number;
  lowTemperatureAlert?: boolean;
  highTemperatureAlert?: boolean;
  lidStuckAlert?: boolean;
  pinIncorrectAlert?: boolean;
  batteryFullyChargedAlert?: boolean;
  hasMasterPin?: boolean;

  // Sensors
  sensorOpen: boolean;
  sensorChangeTime: number;
  motionSensorPirEvent: number;

  // Lighting
  light: boolean;
  lightSettingsEnable: boolean;
  lightSettingsBrightnessManual: number;
  lightSettingsColorTemperatureManual: number;
  lightSettingsBrightnessMotion: number;
  lightSettingsColorTemperatureMotion: number;
  lightSettingsBrightnessSchedule: number;
  lightSettingsColorTemperatureSchedule: number;
  lightSettingsMotionTriggered: boolean;
  lightSettingsMotionActivationMode: number;
  lightSettingsMotionTriggeredDistance: number;
  lightSettingsMotionTriggeredTimer: number;
  lightSettingsManualLightingActiveMode?: number;
  lightSettingsManualDailyLighting?: number;
  lightSettingsManualColoredLighting?: RGBColor;
  lightSettingsManualDynamicLighting?: number;
  lightSettingsMotionLightingActiveMode?: number;
  lightSettingsMotionDailyLighting?: number;
  lightSettingsMotionColoredLighting?: RGBColor;
  lightSettingsMotionDynamicLighting?: number;
  lightSettingsScheduleLightingActiveMode?: number;
  lightSettingsScheduleDailyLighting?: number;
  lightSettingsScheduleColoredLighting?: RGBColor;
  lightSettingsScheduleDynamicLighting?: number;
  lightSettingsColoredLightingColors?: RGBColor[];
  lightSettingsDynamicLightingThemes?: DynamicLighting[];
  interiorBrightness?: number;
  interiorBrightnessDuration?: number;
  flickerAdjustment?: number;

  // Recording
  recordingEndClipMotionStops: boolean;
  recordingClipLength: number;
  recordingRetriggerInterval: number;
  continuousRecording: boolean;
  continuousRecordingType: ContinuousRecordingType;

  // Chime & Notifications
  chimeIndoor: boolean;
  chimeHomebase: boolean;
  chimeHomebaseRingtoneVolume: number;
  chimeHomebaseRingtoneType: number;
  notificationType: NotificationType;
  notification: boolean;
  notificationPerson: boolean;
  notificationPet: boolean;
  notificationAllOtherMotion: boolean;
  notificationCrying: boolean;
  notificationAllSound: boolean;
  notificationIntervalTime: boolean;
  notificationRing: boolean;
  notificationMotion: boolean;
  notificationRadarDetector: boolean;
  notificationUnlocked: boolean;
  notificationLocked: boolean;
  notificationUnlockByKey?: boolean;
  notificationUnlockByPIN?: boolean;
  notificationUnlockByFingerprint?: boolean;
  notificationUnlockByApp?: boolean;
  notificationDualUnlock?: boolean;
  notificationDualLock?: boolean;
  notificationWrongTryProtect?: boolean;
  notificationJammed?: boolean;
  notificationVehicle?: boolean;

  // Physical Controls
  ringing: boolean;
  rotationSpeed: number;
  imageMirrored: boolean;
  autoCalibration: boolean;
  sound: number;
  defaultAngle?: boolean;
  defaultAngleIdleTime?: number;

  // Advanced Features
  loiteringDetection: boolean;
  loiteringDetectionRange: number;
  loiteringDetectionLength: number;
  loiteringCustomResponsePhoneNotification: boolean;
  loiteringCustomResponseAutoVoiceResponse: boolean;
  loiteringCustomResponseAutoVoiceResponseVoice: number;
  loiteringCustomResponseHomeBaseNotification: boolean;
  loiteringCustomResponseTimeFrom: string;
  loiteringCustomResponseTimeTo: string;
  someoneLoitering?: boolean;
  radarMotionDetected?: boolean;

  // Delivery & Package Management
  deliveryGuard: boolean;
  deliveryGuardPackageGuarding: boolean;
  deliveryGuardPackageGuardingVoiceResponseVoice: number;
  deliveryGuardPackageGuardingActivatedTimeFrom: string;
  deliveryGuardPackageGuardingActivatedTimeTo: string;
  deliveryGuardUncollectedPackageAlert: boolean;
  deliveryGuardUncollectedPackageAlertTimeToCheck: string;
  deliveryGuardPackageLiveCheckAssistance: boolean;
  packageDelivered?: boolean;
  packageStranded?: boolean;
  packageTaken?: boolean;
  deliveries?: number;
  isDeliveryDenied?: boolean;

  // Dual Camera Features
  dualCamWatchViewMode: number;

  // Auto Response
  ringAutoResponse: boolean;
  ringAutoResponseVoiceResponse: boolean;
  ringAutoResponseVoiceResponseVoice: number;
  ringAutoResponseTimeFrom: string;
  ringAutoResponseTimeTo: string;

  // Door Sensors
  doorControlWarning?: boolean;
  door1Open?: boolean;
  door2Open?: boolean;
  doorSensor1Status?: number;
  doorSensor2Status?: number;
  doorSensor1MacAddress?: string;
  doorSensor2MacAddress?: string;
  doorSensor1Name?: string;
  doorSensor2Name?: string;
  doorSensor1SerialNumber?: string;
  doorSensor2SerialNumber?: string;
  doorSensor1Version?: string;
  doorSensor2Version?: string;
  doorSensor1LowBattery?: boolean;
  doorSensor2LowBattery?: boolean;
  doorSensor1BatteryLevel?: number;
  doorSensor2BatteryLevel?: number;

  // Location & Tracking
  locationCoordinates?: string;
  locationAddress?: string;
  locationLastUpdate?: number;
  trackerType?: number;
  leftBehindAlarm?: boolean;
  findPhone?: boolean;

  // Advanced Motion & Behavior
  leavingDetection?: boolean;
  leavingReactionNotification?: boolean;
  leavingReactionStartTime?: string;
  leavingReactionEndTime?: string;
  someoneGoing?: boolean;
  lockEventOrigin?: number;
  openMethod?: number;
  motionActivatedPrompt?: boolean;
  open?: boolean;
  openedByType?: number;
  openedByName?: string;

  // Snooze Features
  snooze: boolean;
  snoozeTime: number;
  snoozeStartTime?: number;
  snoozeHomebase?: boolean;
  snoozeMotion?: boolean;
  snoozeChime?: boolean;

  // Detection Statistics
  detectionStatisticsWorkingDays: number;
  detectionStatisticsDetectedEvents: number;
  detectionStatisticsRecordedEvents: number;
}

export type DevicePropertyName = keyof DeviceProperties;
export type DevicePropertyMetadata = PropertyMetadataAny;
export type DevicePropertiesMetadata = Record<
  DevicePropertyName,
  PropertyMetadataAny
>;
export type RGBColor = [number, number, number];
export type DynamicLighting = any;
export type Picture = any;
