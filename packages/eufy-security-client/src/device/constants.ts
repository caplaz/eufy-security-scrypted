/**
 * Device level command constants for Eufy WebSocket API
 *
 * Contains all device command string constants and enums for device operations, streaming, alarm, and camera control.
 */
export const DEVICE_COMMANDS = {
  // Properties
  GET_PROPERTIES_METADATA: "device.get_properties_metadata",
  GET_PROPERTIES: "device.get_properties",
  SET_PROPERTY: "device.set_property",
  HAS_PROPERTY: "device.has_property",
  GET_COMMANDS: "device.get_commands",
  HAS_COMMAND: "device.has_command",

  // Streaming
  START_LIVESTREAM: "device.start_livestream",
  STOP_LIVESTREAM: "device.stop_livestream",
  IS_LIVESTREAMING: "device.is_livestreaming",
  START_RTSP_LIVESTREAM: "device.start_rtsp_livestream",
  STOP_RTSP_LIVESTREAM: "device.stop_rtsp_livestream",
  IS_RTSP_LIVESTREAMING: "device.is_rtsp_livestreaming",

  // Download
  START_DOWNLOAD: "device.start_download",
  CANCEL_DOWNLOAD: "device.cancel_download",
  IS_DOWNLOADING: "device.is_downloading",

  // Alarm
  TRIGGER_ALARM: "device.trigger_alarm",
  RESET_ALARM: "device.reset_alarm",

  // Camera control
  PAN_AND_TILT: "device.pan_and_tilt",
  CALIBRATE: "device.calibrate",
  QUICK_RESPONSE: "device.quick_response",
  GET_VOICES: "device.get_voices",

  // Talkback
  START_TALKBACK: "device.start_talkback",
  STOP_TALKBACK: "device.stop_talkback",
  IS_TALKBACK_ONGOING: "device.is_talkback_ongoing",
  TALKBACK_AUDIO_DATA: "device.talkback_audio_data",

  // Lock control
  CALIBRATE_LOCK: "device.calibrate_lock",
  UNLOCK: "device.unlock",

  // Sensor
  SNOOZE: "device.snooze",

  // User management
  ADD_USER: "device.add_user",
  DELETE_USER: "device.delete_user",
  GET_USERS: "device.get_users",
  UPDATE_USER: "device.update_user",
  UPDATE_USER_PASSCODE: "device.update_user_passcode",
  UPDATE_USER_SCHEDULE: "device.update_user_schedule",
  VERIFY_PIN: "device.verify_pin",

  // Device control
  OPEN: "device.open",
  SET_STATUS_LED: "device.set_status_led",
  SET_AUTO_NIGHT_VISION: "device.set_auto_night_vision",
  SET_MOTION_DETECTION: "device.set_motion_detection",
  SET_SOUND_DETECTION: "device.set_sound_detection",
  SET_PET_DETECTION: "device.set_pet_detection",
  SET_RTSP_STREAM: "device.set_rtsp_stream",
  SET_ANTI_THEFT_DETECTION: "device.set_anti_theft_detection",
  SET_WATERMARK: "device.set_watermark",
  ENABLE_DEVICE: "device.enable_device",
  LOCK_DEVICE: "device.lock_device",
} as const;

export type DeviceCommandType =
  (typeof DEVICE_COMMANDS)[keyof typeof DEVICE_COMMANDS];

/**
 * Device event constants
 */
export const DEVICE_EVENTS = {
  DEVICE_ADDED: "device added",
  DEVICE_REMOVED: "device removed",
  PROPERTY_CHANGED: "property changed",
  COMMAND_RESULT: "command result",

  // Streaming events
  LIVESTREAM_STARTED: "livestream started",
  LIVESTREAM_STOPPED: "livestream stopped",
  LIVESTREAM_VIDEO_DATA: "livestream video data",
  LIVESTREAM_AUDIO_DATA: "livestream audio data",
  GOT_RTSP_URL: "got rtsp url",

  // Download events
  DOWNLOAD_STARTED: "download started",
  DOWNLOAD_FINISHED: "download finished",
  DOWNLOAD_VIDEO_DATA: "download video data",
  DOWNLOAD_AUDIO_DATA: "download audio data",

  // Detection events
  MOTION_DETECTED: "motion detected",
  PERSON_DETECTED: "person detected",
  STRANGER_PERSON_DETECTED: "stranger person detected",
  CRYING_DETECTED: "crying detected",
  SOUND_DETECTED: "sound detected",
  PET_DETECTED: "pet detected",
  VEHICLE_DETECTED: "vehicle detected",
  DOG_DETECTED: "dog detected",
  DOG_LICK_DETECTED: "dog lick detected",
  DOG_POOP_DETECTED: "dog poop detected",
  RADAR_MOTION_DETECTED: "radar motion detected",

  // Doorbell and sensor events
  RINGS: "rings",
  SENSOR_OPEN: "sensor open",

  // Package events
  PACKAGE_DELIVERED: "package delivered",
  PACKAGE_STRANDED: "package stranded",
  PACKAGE_TAKEN: "package taken",
  SOMEONE_LOITERING: "someone loitering",

  // Security events
  LOCKED: "locked",
  WRONG_TRY_PROTECT_ALARM: "wrong try-protect alarm",
  LONG_TIME_NOT_CLOSE: "long time not close",
  LOW_BATTERY: "low battery",
  JAMMED: "jammed",
  ALARM_911: "alarm 911",
  SHAKE_ALARM: "shake alarm",
  TAMPERING: "tampering",
  LOW_TEMPERATURE: "low temperature",
  HIGH_TEMPERATURE: "high temperature",
  PIN_INCORRECT: "pin incorrect",
  LID_STUCK: "lid stuck",
  BATTERY_FULLY_CHARGED: "battery fully charged",

  // Talkback events
  TALKBACK_STARTED: "talkback started",
  TALKBACK_STOPPED: "talkback stopped",

  // User management events
  USER_ADDED: "user added",
  USER_DELETED: "user deleted",
  USER_ERROR: "user error",
  USER_USERNAME_UPDATED: "user username updated",
  USER_SCHEDULE_UPDATED: "user schedule updated",
  USER_PASSCODE_UPDATED: "user passcode updated",
  PIN_VERIFIED: "pin verified",
} as const;

export type DeviceEventType =
  (typeof DEVICE_EVENTS)[keyof typeof DEVICE_EVENTS];

/**
 * Enum values extracted from eufy-security-client upstream for type safety.
 * Source: https://github.com/bropat/eufy-security-client
 */

/**
 * Device type enum - corresponds to the `type` property in DeviceProperties
 * Source: eufy-security-client/src/http/types.ts
 */
export enum DeviceType {
  STATION = 0,
  CAMERA = 1,
  SENSOR = 2,
  FLOODLIGHT = 3,
  CAMERA_E = 4,
  DOORBELL = 5,
  BATTERY_DOORBELL = 7,
  CAMERA2C = 8,
  CAMERA2 = 9,
  MOTION_SENSOR = 10,
  KEYPAD = 11,
  CAMERA2_PRO = 14,
  CAMERA2C_PRO = 15,
  BATTERY_DOORBELL_2 = 16,
  HB3 = 18,
  CAMERA3 = 19,
  CAMERA3C = 23,
  PROFESSIONAL_247 = 24,
  MINIBASE_CHIME = 25,
  CAMERA3_PRO = 26,
  INDOOR_CAMERA = 30,
  INDOOR_PT_CAMERA = 31,
  SOLO_CAMERA = 32,
  SOLO_CAMERA_PRO = 33,
  INDOOR_CAMERA_1080 = 34,
  INDOOR_PT_CAMERA_1080 = 35,
  FLOODLIGHT_CAMERA_8422 = 37,
  FLOODLIGHT_CAMERA_8423 = 38,
  FLOODLIGHT_CAMERA_8424 = 39,
  INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT = 44,
  INDOOR_OUTDOOR_CAMERA_2K = 45,
  INDOOR_OUTDOOR_CAMERA_1080P = 46,
  FLOODLIGHT_CAMERA_8425 = 47,
  OUTDOOR_PT_CAMERA = 48,
  LOCK_BLE = 50,
  LOCK_WIFI = 51,
  LOCK_BLE_NO_FINGER = 52,
  LOCK_WIFI_NO_FINGER = 53,
  LOCK_8503 = 54,
  LOCK_8530 = 55,
  LOCK_85A3 = 56,
  LOCK_8592 = 57,
  LOCK_8504 = 58,
  SOLO_CAMERA_SPOTLIGHT_1080 = 60,
  SOLO_CAMERA_SPOTLIGHT_2K = 61,
  SOLO_CAMERA_SPOTLIGHT_SOLAR = 62,
  SOLO_CAMERA_SOLAR = 63,
  SOLO_CAMERA_C210 = 64,
  FLOODLIGHT_CAMERA_8426 = 87,
  SOLO_CAMERA_E30 = 88,
  SMART_DROP = 90,
  BATTERY_DOORBELL_PLUS = 91,
  DOORBELL_SOLO = 93,
  BATTERY_DOORBELL_PLUS_E340 = 94,
  BATTERY_DOORBELL_C30 = 95,
  BATTERY_DOORBELL_C31 = 96,
  INDOOR_COST_DOWN_CAMERA = 100,
  CAMERA_GUN = 101,
  CAMERA_SNAIL = 102,
  INDOOR_PT_CAMERA_S350 = 104,
  INDOOR_PT_CAMERA_E30 = 105,
  CAMERA_FG = 110,
  CAMERA_GARAGE_T8453_COMMON = 131,
  CAMERA_GARAGE_T8452 = 132,
  CAMERA_GARAGE_T8453 = 133,
  SMART_SAFE_7400 = 140,
  SMART_SAFE_7401 = 141,
  SMART_SAFE_7402 = 142,
  SMART_SAFE_7403 = 143,
  WALL_LIGHT_CAM = 151,
  SMART_TRACK_LINK = 157,
  SMART_TRACK_CARD = 159,
  LOCK_8502 = 180,
  LOCK_8506 = 184,
  WALL_LIGHT_CAM_81A0 = 10005,
  INDOOR_PT_CAMERA_C220 = 10008,
  INDOOR_PT_CAMERA_C210 = 10009,
}

/**
 * Power working mode enum - corresponds to the `powerWorkingMode` property
 * Represents different power management modes for battery devices
 */
export enum PowerWorkingMode {
  BATTERY_POWERED = 0,
  SOLAR_POWERED = 1,
  PLUGGED_IN = 2,
}

/**
 * Charging status enum - corresponds to the `chargingStatus` property
 * Indicates the current charging state of battery devices
 */
export enum ChargingStatus {
  NOT_CHARGING = 0,
  CHARGING = 1,
}

/**
 * Notification type enum - corresponds to the `notificationType` property
 * Defines different notification display modes
 */
export enum NotificationType {
  MOST_EFFICIENT = 1,
  INCLUDE_THUMBNAIL = 2,
  FULL_EFFECT = 3,
}

/**
 * Continuous recording type enum - corresponds to the `continuousRecordingType` property
 * Defines recording behavior for continuous recording mode
 */
export enum ContinuousRecordingType {
  ALWAYS = 0,
  ONLY_DURING_EVENTS = 1,
}

/**
 * Lock status enum - may correspond to the `lockStatus` property
 * Represents different lock states (values may vary by device)
 */
export enum LockStatus {
  UNKNOWN = 0,
  UNLOCKED = 1,
  LOCKED = 2,
  MECHANICAL_ANOMALY = 3,
  LOCKED_COMPLETED = 4,
  UNLOCK_COMPLETED = 5,
}

/**
 * Motion detection type enum - corresponds to `motionDetectionType` property
 * Defines what types of motion to detect
 */
export enum MotionDetectionType {
  HUMAN_ONLY = 0,
  ALL_MOTIONS = 1,
  HUMAN_AND_PET = 2,
}

/**
 * Sound detection type enum - corresponds to `soundDetectionType` property
 * Defines what types of sound to detect
 */
export enum SoundDetectionType {
  ALL_SOUNDS = 0,
  HUMAN_VOICE = 1,
  CRYING = 2,
}

/**
 * Video streaming quality enum - for video quality properties
 */
export enum VideoQuality {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  ULTRA = 3,
}

/**
 * Watermark mode enum - corresponds to `watermark` property
 * Note: Different device types may use different value mappings
 */
export enum WatermarkMode {
  OFF = 0,
  TIMESTAMP = 1,
  TIMESTAMP_AND_LOGO = 2,
}

/**
 * Pan/tilt direction enum for camera movement
 */
export enum PanTiltDirection {
  ROTATE360 = 0,
  LEFT = 1,
  RIGHT = 2,
  UP = 3,
  DOWN = 4,
}
