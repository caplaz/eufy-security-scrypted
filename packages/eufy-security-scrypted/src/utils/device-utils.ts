/**
 * Device utilities for Eufy device management and Scrypted integration
 *
 * Provides core logic for translating Eufy device data into Scrypted-compatible
 * device manifests, settings, and metadata. Simplified version focusing on
 * essential device types and streaming capabilities.
 */

import {
  Device,
  DeviceInformation,
  ScryptedDeviceType,
  ScryptedInterface,
  SecuritySystemMode,
  Setting,
} from "@scrypted/sdk";
import {
  AlarmMode,
  CommonEufyProperties,
  DeviceProperties,
  EufyWebSocketClient,
  GuardMode,
  PropertyMetadataAny,
} from "@scrypted/eufy-security-client";

// Maps Eufy alarm/guard modes to Scrypted security system modes
export const alarmModeMap: Record<AlarmMode, SecuritySystemMode> = {
  [GuardMode.AWAY]: SecuritySystemMode.AwayArmed,
  [GuardMode.HOME]: SecuritySystemMode.HomeArmed,
  [GuardMode.DISARMED]: SecuritySystemMode.Disarmed,
  [GuardMode.CUSTOM1]: SecuritySystemMode.NightArmed,
  [GuardMode.CUSTOM2]: SecuritySystemMode.NightArmed,
  [GuardMode.CUSTOM3]: SecuritySystemMode.NightArmed,
};

// Maps Scrypted security system modes to Eufy guard modes
export const securitySystemMap: Record<SecuritySystemMode, GuardMode> = {
  [SecuritySystemMode.AwayArmed]: GuardMode.AWAY,
  [SecuritySystemMode.HomeArmed]: GuardMode.HOME,
  [SecuritySystemMode.NightArmed]: GuardMode.HOME,
  [SecuritySystemMode.Disarmed]: GuardMode.DISARMED,
};

/**
 * DeviceUtils - Utility class for Eufy device and station manifest creation
 */
export class DeviceUtils {
  /**
   * Create a device manifest for Scrypted device registration
   * @param wsClient - WebSocket client for API access
   * @param deviceSerial - Device serial number
   * @returns Promise resolving to device manifest
   */
  static async createDeviceManifest(
    wsClient: EufyWebSocketClient,
    deviceSerial: string
  ): Promise<Device> {
    try {
      // Get device properties from API
      const deviceResponse = await wsClient.commands
        .device(deviceSerial)
        .getProperties();

      const properties = deviceResponse.properties;

      // Determine device type and interfaces
      const scryptedType = DeviceUtils.getScryptedDeviceType(properties.type);
      const interfaces = DeviceUtils.getDeviceInterfaces(
        properties.type,
        properties
      );

      return {
        nativeId: `device_${deviceSerial}`,
        name: properties.name || `Eufy Device ${deviceSerial}`,
        type: scryptedType,
        interfaces,
        info: {
          manufacturer: "Eufy",
          model: properties.model || "Unknown",
          serialNumber: deviceSerial,
          firmware: properties.softwareVersion || "Unknown",
        },
        // providerNativeId will be set by the caller
      };
    } catch (error) {
      console.error(
        `Failed to create device manifest for ${deviceSerial}:`,
        error
      );
      // Return a basic manifest as fallback
      return {
        nativeId: `device_${deviceSerial}`,
        name: `Eufy Device ${deviceSerial}`,
        type: ScryptedDeviceType.Camera,
        interfaces: [ScryptedInterface.VideoCamera, ScryptedInterface.Settings],
        // providerNativeId will be set by the caller
      };
    }
  }

  /**
   * Create a station manifest for Scrypted device registration
   * @param wsClient - WebSocket client for API access
   * @param stationSerial - Station serial number
   * @returns Promise resolving to station manifest
   */
  static async createStationManifest(
    wsClient: EufyWebSocketClient,
    stationSerial: string
  ): Promise<Device> {
    try {
      // Get station properties from API
      const stationResponse = await wsClient.commands
        .station(stationSerial)
        .getProperties();
      const properties = stationResponse.properties;

      return {
        nativeId: `station_${stationSerial}`,
        name: properties.name || `Eufy Station ${stationSerial}`,
        type: ScryptedDeviceType.SecuritySystem,
        interfaces: [
          ScryptedInterface.DeviceProvider,
          ScryptedInterface.Settings,
          ScryptedInterface.SecuritySystem,
          ScryptedInterface.Refresh,
        ],
        info: {
          manufacturer: "Eufy",
          model: properties.model || "HomeBase",
          serialNumber: stationSerial,
          firmware: properties.softwareVersion || "Unknown",
        },
        // providerNativeId will be set by the caller
      };
    } catch (error) {
      console.error(
        `Failed to create station manifest for ${stationSerial}:`,
        error
      );
      // Return a basic manifest as fallback
      return {
        nativeId: `station_${stationSerial}`,
        name: `Eufy Station ${stationSerial}`,
        type: ScryptedDeviceType.SecuritySystem,
        interfaces: [
          ScryptedInterface.DeviceProvider,
          ScryptedInterface.Settings,
        ],
        // providerNativeId will be set by the caller
      };
    }
  }

  /**
   * Get Scrypted device type based on Eufy device type
   * @param eufyDeviceType - Eufy device type number
   * @returns Scrypted device type
   */
  private static getScryptedDeviceType(
    eufyDeviceType: number
  ): ScryptedDeviceType {
    // Simplified device type mapping - focusing on main categories
    if (DeviceUtils.isCameraDevice(eufyDeviceType)) {
      return ScryptedDeviceType.Camera;
    } else if (DeviceUtils.isDoorbellDevice(eufyDeviceType)) {
      return ScryptedDeviceType.Doorbell;
    } else if (DeviceUtils.isSensorDevice(eufyDeviceType)) {
      return ScryptedDeviceType.Sensor;
    } else {
      return ScryptedDeviceType.Unknown;
    }
  }

  /**
   * Get device interfaces based on device type and properties
   * @param eufyDeviceType - Eufy device type number
   * @param properties - Device properties
   * @returns Array of Scrypted interfaces
   */
  private static getDeviceInterfaces(
    eufyDeviceType: number,
    properties: DeviceProperties
  ): ScryptedInterface[] {
    const interfaces: ScryptedInterface[] = [];

    // All devices have settings
    interfaces.push(ScryptedInterface.Settings);

    // Camera/Doorbell devices
    if (
      DeviceUtils.isCameraDevice(eufyDeviceType) ||
      DeviceUtils.isDoorbellDevice(eufyDeviceType)
    ) {
      interfaces.push(ScryptedInterface.VideoCamera);
      interfaces.push(ScryptedInterface.MotionSensor);
      interfaces.push(ScryptedInterface.Refresh);

      // Battery devices
      if (properties.battery !== undefined) {
        interfaces.push(ScryptedInterface.Battery);
      }

      // Pan/Tilt capable devices
      if (DeviceUtils.isPanTiltDevice(eufyDeviceType)) {
        interfaces.push(ScryptedInterface.PanTiltZoom);
      }

      // Light controls
      if (
        properties.light !== undefined ||
        DeviceUtils.isFloodlightDevice(eufyDeviceType)
      ) {
        interfaces.push(ScryptedInterface.OnOff);
        if (properties.lightSettingsBrightnessManual !== undefined) {
          interfaces.push(ScryptedInterface.Brightness);
        }
      }
    }

    // Sensor devices
    if (DeviceUtils.isSensorDevice(eufyDeviceType)) {
      interfaces.push(ScryptedInterface.Sensors);
    }

    return interfaces;
  }

  /**
   * Check if device is a camera type
   */
  private static isCameraDevice(deviceType: number): boolean {
    // Simplified check for camera devices - covers most common camera types
    const cameraTypes = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    ];
    return cameraTypes.includes(deviceType);
  }

  /**
   * Check if device is a doorbell type
   */
  private static isDoorbellDevice(deviceType: number): boolean {
    // Common doorbell device types
    const doorbellTypes = [16, 17, 18, 19, 20];
    return doorbellTypes.includes(deviceType);
  }

  /**
   * Check if device is a sensor type
   */
  private static isSensorDevice(deviceType: number): boolean {
    // Common sensor device types
    const sensorTypes = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
    return sensorTypes.includes(deviceType);
  }

  /**
   * Check if device supports pan/tilt functionality
   */
  private static isPanTiltDevice(deviceType: number): boolean {
    // Indoor PT cameras and outdoor PT cameras
    const panTiltTypes = [31, 32, 33, 34, 35];
    return panTiltTypes.includes(deviceType);
  }

  /**
   * Check if device is a floodlight camera
   */
  private static isFloodlightDevice(deviceType: number): boolean {
    // Floodlight camera types
    const floodlightTypes = [90, 91, 92, 93, 94];
    return floodlightTypes.includes(deviceType);
  }

  /**
   * Create a setting from metadata
   * @param metadata - Property metadata
   * @param value - Current value
   * @param description - Setting description
   * @returns Setting object
   */
  static settingFromMetadata(
    metadata: PropertyMetadataAny,
    value: any,
    description?: string
  ): Setting {
    return {
      key: metadata.name,
      title: metadata.name,
      description: description || metadata.label,
      value: value,
      type: metadata.type === "number" ? "number" : "string",
      readonly: !metadata.writeable,
    };
  }

  /**
   * Get generic device information settings
   * @param device - Device information
   * @param metadata - Property metadata
   * @returns Array of settings
   */
  static genericDeviceInformation(
    device: DeviceInformation,
    _metadata: Record<keyof CommonEufyProperties, PropertyMetadataAny>
  ): Setting[] {
    return [
      {
        key: "model",
        title: "Model",
        description: "Device model",
        value: device.model,
        readonly: true,
      },
      {
        key: "serialNumber",
        title: "Serial Number",
        description: "Device serial number",
        value: device.serialNumber,
        readonly: true,
      },
      {
        key: "softwareVersion",
        title: "Software Version",
        description: "Device firmware version",
        value: device.firmware,
        readonly: true,
      },
    ];
  }
}
