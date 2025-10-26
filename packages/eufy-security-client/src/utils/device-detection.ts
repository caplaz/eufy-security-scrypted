/**
 * Device Detection and Type Registry for Eufy Security Devices
 *
 * This module provides comprehensive device type detection, classification, and capability
 * mapping for Eufy security devices. It serves as the central registry for all supported
 * device types and their corresponding capabilities.
 *
 * Key Features:
 * - Device type classification (cameras, doorbells, sensors, locks, etc.)
 * - Capability detection (battery, pan/tilt, floodlight, etc.)
 * - Human-readable model name resolution
 * - Support validation for device compatibility
 *
 * Architecture:
 * - Static device type sets for efficient lookup operations
 * - Helper functions for device capability detection
 * - Model name registry for user-friendly device identification
 * - Compatibility layer between Eufy device types and client interfaces
 *
 * Performance Optimizations:
 * - Uses Set data structures for O(1) device type lookups
 * - Minimizes memory footprint with shared type constants
 * - Efficient capability detection through bitwise operations where applicable
 *
 * @public
 * @since 1.0.0
 */

import { DeviceType } from "../device/constants";

/**
 * Camera device types supported by the client - Matching original eufy-security-client Device.isCamera()
 * These devices provide video streaming capabilities
 */
export const CAMERA_DEVICE_TYPES = new Set<number>([
  DeviceType.CAMERA, // Basic camera
  DeviceType.CAMERA2, // eufyCam 2
  DeviceType.CAMERA_E, // eufyCam E
  DeviceType.CAMERA2C, // eufyCam 2C
  DeviceType.CAMERA2C_PRO, // eufyCam 2C Pro
  DeviceType.CAMERA2_PRO, // eufyCam 2 Pro
  DeviceType.CAMERA3, // eufyCam 3
  DeviceType.CAMERA3C, // eufyCam 3C
  DeviceType.CAMERA3_PRO, // eufyCam 3 Pro
  DeviceType.PROFESSIONAL_247, // T8600 Professional
  DeviceType.SOLO_CAMERA, // SoloCam series
  DeviceType.SOLO_CAMERA_PRO, // SoloCam Pro
  DeviceType.SOLO_CAMERA_SPOTLIGHT_1080, // SoloCam Spotlight 1080
  DeviceType.SOLO_CAMERA_SPOTLIGHT_2K, // SoloCam Spotlight 2K
  DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR, // SoloCam Spotlight Solar
  DeviceType.SOLO_CAMERA_SOLAR, // SoloCam Solar
  DeviceType.SOLO_CAMERA_C210, // SoloCam C210
  DeviceType.SOLO_CAMERA_E30, // SoloCam E30
  DeviceType.INDOOR_CAMERA, // Indoor cameras
  DeviceType.INDOOR_PT_CAMERA, // Indoor pan/tilt cameras
  DeviceType.INDOOR_PT_CAMERA_S350, // Indoor pan/tilt S350
  DeviceType.INDOOR_PT_CAMERA_C220, // Indoor pan/tilt C220
  DeviceType.INDOOR_PT_CAMERA_C210, // Indoor pan/tilt C210
  DeviceType.INDOOR_PT_CAMERA_E30, // Indoor pan/tilt E30
  DeviceType.INDOOR_CAMERA_1080, // Indoor 1080p
  DeviceType.INDOOR_PT_CAMERA_1080, // Indoor PT 1080p
  DeviceType.INDOOR_OUTDOOR_CAMERA_1080P, // Indoor/outdoor 1080p
  DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT, // Indoor/outdoor 1080p no light
  DeviceType.INDOOR_OUTDOOR_CAMERA_2K, // Indoor/outdoor 2K
  DeviceType.INDOOR_COST_DOWN_CAMERA, // Indoor cost down camera
  DeviceType.OUTDOOR_PT_CAMERA, // S340 outdoor pan/tilt
  DeviceType.CAMERA_FG, // T8150 4G Starlight cameras
  DeviceType.CAMERA_GARAGE_T8453_COMMON, // Garage camera common
  DeviceType.CAMERA_GARAGE_T8452, // Garage camera T8452
  DeviceType.CAMERA_GARAGE_T8453, // Garage camera T8453
  DeviceType.CAMERA_GUN, // Gun camera
  DeviceType.CAMERA_SNAIL, // Snail camera
  DeviceType.FLOODLIGHT_CAMERA_8426, // Floodlight E30
]);

/**
 * Doorbell device types supported by the client - Matching original eufy-security-client Device.isDoorbell()
 * These devices provide video streaming AND doorbell functionality
 */
export const DOORBELL_DEVICE_TYPES = new Set<number>([
  DeviceType.DOORBELL, // Basic wired doorbell
  DeviceType.BATTERY_DOORBELL, // Battery doorbell
  DeviceType.BATTERY_DOORBELL_2, // Battery doorbell 2
  DeviceType.BATTERY_DOORBELL_PLUS, // Battery doorbell plus
  DeviceType.DOORBELL_SOLO, // Solo doorbell (dual)
  DeviceType.BATTERY_DOORBELL_PLUS_E340, // E340 doorbell
  DeviceType.BATTERY_DOORBELL_C30, // C30 doorbell
  DeviceType.BATTERY_DOORBELL_C31, // C31 doorbell
]);

/**
 * Floodlight camera device types supported by the client - Matching original eufy-security-client Device.isFloodLight()
 * These combine camera functionality with light functionality
 */
export const FLOODLIGHT_DEVICE_TYPES = new Set<number>([
  DeviceType.FLOODLIGHT, // Basic floodlight
  DeviceType.FLOODLIGHT_CAMERA_8422, // T8422
  DeviceType.FLOODLIGHT_CAMERA_8423, // T8423
  DeviceType.FLOODLIGHT_CAMERA_8424, // T8424
  DeviceType.FLOODLIGHT_CAMERA_8425, // T8425
  DeviceType.FLOODLIGHT_CAMERA_8426, // T8426 (E30)
  DeviceType.WALL_LIGHT_CAM, // Wall light cam
  DeviceType.WALL_LIGHT_CAM_81A0, // Wall light cam 81A0
  // these are SoloCam floodlights
  DeviceType.SOLO_CAMERA_SPOTLIGHT_1080,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_2K,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR,
]);

/**
 * Motion sensor device types supported by the client - Matching original eufy-security-client Device.isSensor()
 */
export const SENSOR_DEVICE_TYPES = new Set<number>([
  DeviceType.SENSOR, // Basic entry sensor
  DeviceType.MOTION_SENSOR, // Motion sensor
]);

/**
 * Smart lock device types supported by the client - Matching original eufy-security-client Device.isLock()
 */
export const LOCK_DEVICE_TYPES = new Set<number>([
  DeviceType.LOCK_BLE, // Bluetooth lock
  DeviceType.LOCK_BLE_NO_FINGER, // Bluetooth lock without fingerprint
  DeviceType.LOCK_WIFI, // WiFi lock
  DeviceType.LOCK_WIFI_NO_FINGER, // WiFi lock without fingerprint
  DeviceType.LOCK_8503, // Smart Lock R10
  DeviceType.LOCK_8504, // Smart Lock R20
  DeviceType.LOCK_8530, // Video Smart Lock
  DeviceType.LOCK_8592, // Smart Lock R20 Keypad
  DeviceType.LOCK_85A3, // Smart Lock R10 Keypad
  DeviceType.LOCK_8506, // Lock 8506
  DeviceType.LOCK_8502, // Lock 8502
]);

/**
 * Base station device types - Matching original eufy-security-client Device.isStation()
 * These are hub devices that manage other devices
 */
export const BASE_STATION_DEVICE_TYPES = new Set<number>([
  DeviceType.STATION, // Basic station
  DeviceType.MINIBASE_CHIME, // MiniBase Chime
]);

/**
 * Battery-powered device types - Matching original eufy-security-client Device.hasBattery()
 * Used to determine if Battery interface should be added
 */
export const BATTERY_DEVICE_TYPES = new Set<number>([
  // Battery cameras (based on original hasBattery() method)
  DeviceType.CAMERA, // Basic camera
  DeviceType.CAMERA_E, // eufyCam E
  DeviceType.CAMERA2C, // eufyCam 2C
  DeviceType.CAMERA2, // eufyCam 2
  DeviceType.CAMERA2_PRO, // eufyCam 2 Pro
  DeviceType.CAMERA2C_PRO, // eufyCam 2C Pro
  DeviceType.CAMERA3, // eufyCam 3
  DeviceType.CAMERA3C, // eufyCam 3C
  DeviceType.CAMERA3_PRO, // eufyCam 3 Pro
  DeviceType.SOLO_CAMERA, // SoloCam series
  DeviceType.SOLO_CAMERA_PRO, // SoloCam Pro
  DeviceType.SOLO_CAMERA_SPOTLIGHT_1080,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_2K,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR,
  DeviceType.SOLO_CAMERA_SOLAR,
  DeviceType.SOLO_CAMERA_C210,
  DeviceType.SOLO_CAMERA_E30,
  DeviceType.OUTDOOR_PT_CAMERA, // S340 outdoor pan/tilt
  DeviceType.CAMERA_FG, // T8150 4G Starlight
  DeviceType.WALL_LIGHT_CAM_81A0, // Wall light cam 81A0
  DeviceType.SMART_DROP, // T8790

  // All battery doorbells
  DeviceType.BATTERY_DOORBELL,
  DeviceType.BATTERY_DOORBELL_2,
  DeviceType.BATTERY_DOORBELL_PLUS,
  DeviceType.DOORBELL_SOLO,
  DeviceType.BATTERY_DOORBELL_PLUS_E340,
  DeviceType.BATTERY_DOORBELL_C30,
  DeviceType.BATTERY_DOORBELL_C31,

  // Battery locks (from original hasBattery())
  DeviceType.LOCK_WIFI,
  DeviceType.LOCK_BLE_NO_FINGER,
  DeviceType.LOCK_8503,
  DeviceType.LOCK_8504,
  DeviceType.LOCK_8530,
  DeviceType.LOCK_8592,
  DeviceType.LOCK_85A3,
  DeviceType.LOCK_8506,
  DeviceType.LOCK_8502,

  // Smart safes (from original hasBattery())
  DeviceType.SMART_SAFE_7400,
  DeviceType.SMART_SAFE_7401,
  DeviceType.SMART_SAFE_7402,
  DeviceType.SMART_SAFE_7403,
]);

/**
 * Pan/tilt capable device types - Matching original eufy-security-client Device.isPanAndTiltCamera()
 * These support pan and tilt camera controls
 */
export const PAN_TILT_DEVICE_TYPES = new Set<number>([
  DeviceType.INDOOR_PT_CAMERA,
  DeviceType.FLOODLIGHT_CAMERA_8423,
  DeviceType.FLOODLIGHT_CAMERA_8425,
  DeviceType.FLOODLIGHT_CAMERA_8426,
  DeviceType.INDOOR_COST_DOWN_CAMERA,
  DeviceType.OUTDOOR_PT_CAMERA,
  DeviceType.INDOOR_PT_CAMERA_S350,
  DeviceType.INDOOR_PT_CAMERA_E30,
  DeviceType.INDOOR_PT_CAMERA_C220,
  DeviceType.INDOOR_PT_CAMERA_C210,
]);

/**
 * All device types that the client can support
 * Combination of cameras, doorbells, floodlights, sensors, and locks
 */
export const SUPPORTED_DEVICE_TYPES = new Set<number>([
  ...Array.from(CAMERA_DEVICE_TYPES),
  ...Array.from(DOORBELL_DEVICE_TYPES),
  ...Array.from(FLOODLIGHT_DEVICE_TYPES),
  ...Array.from(SENSOR_DEVICE_TYPES),
  ...Array.from(LOCK_DEVICE_TYPES),
]);

// Additional device type sets for more precise classification
export const SOLO_CAMERA_TYPES = new Set<number>([
  DeviceType.SOLO_CAMERA,
  DeviceType.SOLO_CAMERA_PRO,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_1080,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_2K,
  DeviceType.SOLO_CAMERA_SPOTLIGHT_SOLAR,
  DeviceType.SOLO_CAMERA_SOLAR,
  DeviceType.SOLO_CAMERA_C210,
  DeviceType.SOLO_CAMERA_E30,
  DeviceType.OUTDOOR_PT_CAMERA, // S340 is considered SoloCam
]);

export const INDOOR_CAMERA_TYPES = new Set<number>([
  DeviceType.INDOOR_CAMERA,
  DeviceType.INDOOR_PT_CAMERA,
  DeviceType.INDOOR_OUTDOOR_CAMERA_1080P_NO_LIGHT,
  DeviceType.INDOOR_OUTDOOR_CAMERA_2K,
  DeviceType.INDOOR_OUTDOOR_CAMERA_1080P,
  DeviceType.INDOOR_COST_DOWN_CAMERA,
  DeviceType.INDOOR_PT_CAMERA_S350,
  DeviceType.INDOOR_PT_CAMERA_E30,
  DeviceType.INDOOR_PT_CAMERA_C220,
  DeviceType.INDOOR_PT_CAMERA_C210,
]);

export const WIRED_DOORBELL_TYPES = new Set<number>([
  DeviceType.DOORBELL, // Basic wired doorbell
]);

export const BATTERY_DOORBELL_TYPES = new Set<number>([
  DeviceType.BATTERY_DOORBELL,
  DeviceType.BATTERY_DOORBELL_2,
  DeviceType.BATTERY_DOORBELL_PLUS,
  DeviceType.BATTERY_DOORBELL_PLUS_E340,
  DeviceType.BATTERY_DOORBELL_C30,
  DeviceType.BATTERY_DOORBELL_C31,
]);

export const DUAL_DOORBELL_TYPES = new Set<number>([
  DeviceType.DOORBELL_SOLO, // Solo doorbell (dual)
  DeviceType.BATTERY_DOORBELL_PLUS, // Battery doorbell plus (dual)
]);

export const LOCK_BLE_TYPES = new Set<number>([
  DeviceType.LOCK_BLE,
  DeviceType.LOCK_BLE_NO_FINGER,
]);

export const LOCK_WIFI_TYPES = new Set<number>([
  DeviceType.LOCK_WIFI,
  DeviceType.LOCK_WIFI_NO_FINGER,
  DeviceType.LOCK_8503,
  DeviceType.LOCK_8530,
  DeviceType.LOCK_8504,
  DeviceType.LOCK_8502,
  DeviceType.LOCK_8506,
]);

export const LOCK_KEYPAD_TYPES = new Set<number>([
  DeviceType.LOCK_85A3, // Smart Lock R10 Keypad
  DeviceType.LOCK_8592, // Smart Lock R20 Keypad
]);

export const CAMERA_1_TYPES = new Set<number>([DeviceType.CAMERA]);

export const CAMERA_E_TYPES = new Set<number>([DeviceType.CAMERA_E]);

export const CAMERA_2_TYPES = new Set<number>([
  DeviceType.CAMERA2C,
  DeviceType.CAMERA2,
  DeviceType.CAMERA2_PRO,
  DeviceType.CAMERA2C_PRO,
]);

export const CAMERA_3_TYPES = new Set<number>([
  DeviceType.CAMERA3,
  DeviceType.CAMERA3C,
  DeviceType.PROFESSIONAL_247,
  DeviceType.CAMERA3_PRO,
]);

export const GARAGE_CAMERA_TYPES = new Set<number>([
  DeviceType.CAMERA_GARAGE_T8453_COMMON,
  DeviceType.CAMERA_GARAGE_T8452,
  DeviceType.CAMERA_GARAGE_T8453,
]);

export const SMART_SAFE_TYPES = new Set<number>([
  DeviceType.SMART_SAFE_7400,
  DeviceType.SMART_SAFE_7401,
  DeviceType.SMART_SAFE_7402,
  DeviceType.SMART_SAFE_7403,
]);

export const SMART_TRACK_TYPES = new Set<number>([
  120, // SMART_TRACK_LINK - not in DeviceType enum yet
  121, // SMART_TRACK_CARD - not in DeviceType enum yet
]);

export const SMART_DROP_TYPES = new Set<number>([DeviceType.SMART_DROP]);

export const KEYPAD_TYPES = new Set<number>([DeviceType.KEYPAD]);

/**
 * Camera device types that require FFmpeg error resilience for H.264 data partitioning.
 * Currently includes SoloCam S340, but may be extended to other cameras with similar issues.
 */
export const ERROR_RESILIENT_CAMERA_TYPES = new Set<number>([
  DeviceType.OUTDOOR_PT_CAMERA, // SoloCam S340
]);

/**
 * Device Detection Functions
 *
 * These functions provide efficient device type classification and capability detection
 * for Eufy security devices. They match the original eufy-security-client Device static
 * methods while optimizing for client-specific use cases.
 */

/**
 * Determines if a device type represents a camera-capable device.
 *
 * This includes traditional cameras, video doorbells, and floodlight cameras
 * that can provide video streaming functionality.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device can provide video streaming capabilities
 */
export function isCamera(deviceType: number): boolean {
  return (
    CAMERA_DEVICE_TYPES.has(deviceType) ||
    DOORBELL_DEVICE_TYPES.has(deviceType) ||
    FLOODLIGHT_DEVICE_TYPES.has(deviceType)
  );
}

/**
 * Determines if a device type represents a video doorbell.
 *
 * Video doorbells combine camera functionality with doorbell-specific features
 * like chime integration and visitor detection.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a video doorbell
 */
export function isDoorbell(deviceType: number): boolean {
  return DOORBELL_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a wired video doorbell.
 *
 * Wired doorbells have continuous power and don't require battery management.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a wired doorbell
 */
export function isWiredDoorbell(deviceType: number): boolean {
  return WIRED_DOORBELL_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a battery-powered video doorbell.
 *
 * Battery doorbells require power management and charging monitoring.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is battery-powered
 */
export function isBatteryDoorbell(deviceType: number): boolean {
  return BATTERY_DOORBELL_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a dual-camera doorbell.
 *
 * Dual doorbells have both front-facing and package detection cameras.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device has dual camera functionality
 */
export function isDoorbellDual(deviceType: number): boolean {
  return DUAL_DOORBELL_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a floodlight camera.
 *
 * Floodlight cameras combine video recording with powerful LED lighting
 * for enhanced security and visibility.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device has integrated floodlight functionality
 */
export function isFloodlight(deviceType: number): boolean {
  return FLOODLIGHT_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a sensor device.
 *
 * Sensors include motion detectors and entry sensors for security monitoring.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a sensor
 */
export function isSensor(deviceType: number): boolean {
  return SENSOR_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents an entry sensor.
 *
 * Entry sensors detect door/window opening and closing events.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is an entry sensor
 */
export function isEntrySensor(deviceType: number): boolean {
  return deviceType === DeviceType.SENSOR;
}

/**
 * Determines if a device type represents a motion sensor.
 *
 * Motion sensors detect movement within their detection range.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a motion sensor
 */
export function isMotionSensor(deviceType: number): boolean {
  return deviceType === DeviceType.MOTION_SENSOR;
}

/**
 * Determines if a device type represents a smart lock.
 *
 * Smart locks provide keyless entry with remote control capabilities.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a smart lock
 */
export function isLock(deviceType: number): boolean {
  return LOCK_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a Bluetooth-enabled smart lock.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a Bluetooth smart lock
 */
export function isLockBle(deviceType: number): boolean {
  return LOCK_BLE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a WiFi-enabled smart lock.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a WiFi smart lock
 */
export function isLockWifi(deviceType: number): boolean {
  return LOCK_WIFI_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a smart lock with keypad functionality.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device has keypad input capabilities
 */
export function isLockKeypad(deviceType: number): boolean {
  return LOCK_KEYPAD_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a base station or hub device.
 *
 * Base stations coordinate other devices but don't have direct client interfaces.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a base station
 */
export function isBaseStation(deviceType: number): boolean {
  return BASE_STATION_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents an indoor camera.
 *
 * Indoor cameras are optimized for interior use and may have different
 * features compared to outdoor cameras.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is designed for indoor use
 */
export function isIndoorCamera(deviceType: number): boolean {
  return INDOOR_CAMERA_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a SoloCam series camera.
 *
 * SoloCam devices are standalone cameras that don't require a base station.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is part of the SoloCam series
 */
export function isSoloCameras(deviceType: number): boolean {
  return SOLO_CAMERA_TYPES.has(deviceType);
}

/**
 * Determines if a device type supports pan and tilt functionality.
 *
 * Pan/tilt cameras can be remotely controlled to change viewing direction.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device supports pan and tilt controls
 */
export function isPanAndTiltCamera(deviceType: number): boolean {
  return PAN_TILT_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a garage-specific camera.
 *
 * Garage cameras are designed for monitoring garage doors and vehicles.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a garage camera
 */
export function isGarageCamera(deviceType: number): boolean {
  return GARAGE_CAMERA_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a smart safe.
 *
 * Smart safes provide secure storage with digital access controls.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a smart safe
 */
export function isSmartSafe(deviceType: number): boolean {
  return SMART_SAFE_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a smart tracking device.
 *
 * Smart trackers help locate lost items or monitor movement.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a smart tracker
 */
export function isSmartTrack(deviceType: number): boolean {
  return SMART_TRACK_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a smart drop box.
 *
 * Smart drop boxes provide secure package delivery reception.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a smart drop box
 */
export function isSmartDrop(deviceType: number): boolean {
  return SMART_DROP_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a security keypad.
 *
 * Keypads provide numeric input for security system control.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a keypad
 */
export function isKeyPad(deviceType: number): boolean {
  return KEYPAD_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a first-generation camera product.
 *
 * Includes original eufyCam and eufyCam E models.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a generation 1 camera
 */
export function isCamera1Product(deviceType: number): boolean {
  return CAMERA_1_TYPES.has(deviceType) || CAMERA_E_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a second-generation camera product.
 *
 * Includes eufyCam 2, 2C, and Pro variants.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a generation 2 camera
 */
export function isCamera2Product(deviceType: number): boolean {
  return CAMERA_2_TYPES.has(deviceType);
}

/**
 * Determines if a device type represents a third-generation camera product.
 *
 * Includes eufyCam 3, 3C, and Professional variants.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is a generation 3 camera
 */
export function isCamera3Product(deviceType: number): boolean {
  return CAMERA_3_TYPES.has(deviceType);
}

/**
 * Determines if a device type includes battery power capability.
 *
 * Battery-powered devices require power management and charging monitoring.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device has battery power
 */
export function hasBattery(deviceType: number): boolean {
  return BATTERY_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type supports pan and tilt camera controls.
 *
 * Alias for isPanAndTiltCamera() for consistency with capability naming.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device supports pan and tilt functionality
 */
export function canPanTilt(deviceType: number): boolean {
  return PAN_TILT_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type is supported by this client.
 *
 * This is the primary compatibility check for device registration.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device is supported by the client
 */
export function isDeviceSupported(deviceType: number): boolean {
  return SUPPORTED_DEVICE_TYPES.has(deviceType);
}

/**
 * Determines if a device type requires FFmpeg error resilience for H.264 data partitioning.
 *
 * These cameras may have streaming issues with H.264 data partitioning that require
 * special FFmpeg flags (-enable_er 1) to handle corrupted or incomplete frames.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns True if the device requires error resilience settings
 */
export function requiresErrorResilience(deviceType: number): boolean {
  return ERROR_RESILIENT_CAMERA_TYPES.has(deviceType);
}

/**
 * Analyzes a device type and returns a comprehensive capability profile.
 *
 * This function provides a complete overview of what features and interfaces
 * a device supports, enabling efficient interface assignment and feature
 * detection throughout the client.
 *
 * Performance Optimization: Uses efficient Set.has() lookups for O(1) complexity
 * across all capability checks.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns Object containing boolean flags for each device capability
 */
export function getDeviceCapabilities(deviceType: number): {
  camera: boolean;
  doorbell: boolean;
  floodlight: boolean;
  sensor: boolean;
  lock: boolean;
  battery: boolean;
  panTilt: boolean;
  supported: boolean;
} {
  return {
    camera:
      isCamera(deviceType) ||
      isDoorbell(deviceType) ||
      isFloodlight(deviceType),
    doorbell: isDoorbell(deviceType),
    floodlight: isFloodlight(deviceType),
    sensor: isSensor(deviceType),
    lock: isLock(deviceType),
    battery: hasBattery(deviceType),
    panTilt: canPanTilt(deviceType),
    supported: isDeviceSupported(deviceType),
  };
}

// Human-readable product names for Eufy device models
export const MODEL_NAMES: Record<string, string> = {
  // Base Stations
  T8001: "HomeBase",
  T8002: "HomeBase E",
  T8010: "HomeBase S280 (Homebase 2)",
  T8030: "HomeBase S380 (HomeBase 3)",
  T8021: "Smart Lock Wi-Fi Bridge",
  T8023: "MiniBase Chime",

  // EufyCam Series
  T8111: "eufyCam",
  T8112: "eufyCam E",
  T8114: "eufyCam 2",
  T8113: "eufyCam S210 (eufyCam 2C)",
  T8140: "eufyCam S221 (eufyCam 2 Pro)",
  T8141: "eufyCam S220 (eufyCam 2C Pro)",
  T8160: "eufyCam S330 (eufyCam 3)",
  T8161: "eufyCam S300 (eufyCam 3C)",
  T8162: "eufyCam S3 Pro",
  T8600: "eufyCam E330 (Professional)",

  // SoloCam Series
  T8130: "SoloCam E20",
  T8131: "SoloCam C120 (SoloCam E40)",
  T8122: "SoloCam L20",
  T8123: "SoloCam L40",
  T8B0: "SoloCam C210",
  T8124: "SoloCam S230 (SoloCam S40)",
  T8134: "SoloCam S220",
  T8170: "SoloCam S340",
  T8171: "SoloCam E30",

  // Floodlight Cameras
  T8420: "Floodlight Camera",
  T8420X: "Floodlight Camera",
  T8422: "Floodlight Cam",
  T8423: "Floodlight Cam S330 (Floodlight Cam 2 Pro)",
  T8424: "Floodlight Cam E221 (Floodlight Cam 2)",
  T8425: "Floodlight Cam E340",

  // Wall Light Cameras
  T84A1: "Wired Wall Light Cam S100",
  T84A0: "Solar Wall Light Cam S120",

  // Video Doorbells - Wired
  T8200: "Video Doorbell 2K (Wired)",
  T8200X: "Wired Doorbell 2k",
  T8201: "Wired Doorbell 1080p",
  T8203: "Video Doorbell (Wired) S330 (Video Doorbell Dual)",

  // Video Doorbells - Battery
  T8210: "Video Doorbell S220 (Battery Doorbell 2K)",
  T8213: "Video Doorbell S330 (Battery Doorbell 2K Dual)",
  T8214: "Video Doorbell E340 (Battery Powered)",
  T8222: "Video Doorbell C210 (Battery Doorbell 1080p)",
  T8224: "Video Doorbell C30 (Battery Powered)",
  T8223: "Video Doorbell C31 (Battery Powered)",

  // Indoor Cameras
  T8410: "Indoor Cam E220 (Indoor Cam Pan&Tilt 2K)",

  // Sensors
  T8900: "Entry Sensor",
  T8910: "Motion Sensor",
};

/**
 * Retrieves a human-readable product name for a given device model identifier.
 *
 * This function maps Eufy's internal model codes (like T8114, T8210) to
 * user-friendly product names that are displayed in the client interface.
 *
 * @param model - The Eufy device model identifier (e.g., "T8114", "T8210")
 * @returns Human-readable product name, or the original model if not found
 */
export function getProductName(model: string): string {
  return MODEL_NAMES[model] || model;
}

/**
 * Gets a human-readable device type name based on device type number.
 *
 * This function provides a simple mapping from device type numbers to
 * user-friendly type names for display purposes.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns Human-readable device type name
 */
export function getDeviceTypeName(deviceType: number): string {
  if (isDoorbell(deviceType)) {
    return "Doorbell";
  } else if (isCamera(deviceType) || isFloodlight(deviceType)) {
    return "Camera";
  } else if (isSensor(deviceType)) {
    return "Sensor";
  } else if (isLock(deviceType)) {
    return "Lock";
  } else if (isBaseStation(deviceType)) {
    return "Base Station";
  } else {
    return "Unknown";
  }
}
