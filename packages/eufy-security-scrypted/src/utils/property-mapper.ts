/**
 * Property Mapper
 *
 * Utilities for mapping between Eufy device properties and Scrypted settings.
 * Handles type conversions, state mappings, and metadata parsing.
 *
 * @module utils
 */

import { Setting, SettingValue, SecuritySystemMode } from "@scrypted/sdk";
import {
  AlarmMode,
  GuardMode,
  PropertyMetadataAny,
  DeviceProperties,
  CommonEufyProperties,
} from "@caplaz/eufy-security-client";

/**
 * Maps Eufy alarm/guard modes to Scrypted security system modes
 */
export const ALARM_MODE_MAP: Record<AlarmMode, SecuritySystemMode> = {
  [GuardMode.AWAY]: SecuritySystemMode.AwayArmed,
  [GuardMode.HOME]: SecuritySystemMode.HomeArmed,
  [GuardMode.DISARMED]: SecuritySystemMode.Disarmed,
  [GuardMode.CUSTOM1]: SecuritySystemMode.NightArmed,
  [GuardMode.CUSTOM2]: SecuritySystemMode.NightArmed,
  [GuardMode.CUSTOM3]: SecuritySystemMode.NightArmed,
};

/**
 * Maps Scrypted security system modes to Eufy guard modes
 */
export const SECURITY_SYSTEM_MAP: Record<SecuritySystemMode, GuardMode> = {
  [SecuritySystemMode.AwayArmed]: GuardMode.AWAY,
  [SecuritySystemMode.HomeArmed]: GuardMode.HOME,
  [SecuritySystemMode.NightArmed]: GuardMode.HOME,
  [SecuritySystemMode.Disarmed]: GuardMode.DISARMED,
};

/**
 * PropertyMapper provides utilities for mapping device properties to Scrypted settings
 */
export class PropertyMapper {
  /**
   * Convert Eufy property metadata to a Scrypted Setting
   *
   * @param metadata - Property metadata from Eufy API
   * @param value - Current property value
   * @param description - Optional description override
   * @param group - Optional group name for UI organization
   * @returns Scrypted Setting object
   */
  static toSetting(
    metadata: PropertyMetadataAny,
    value?: SettingValue,
    description?: string,
    group?: string
  ): Setting {
    let setting: Setting = {
      key: metadata.name,
      title: metadata.label,
      type: metadata.type,
      value: value !== undefined ? value : metadata.default,
      placeholder: metadata.default ? String(metadata.default) : undefined,
      readonly: !metadata.writeable,
      description,
      group,
    };

    // Handle number types with state mappings (enum-like)
    if (metadata.type === "number" && metadata.states) {
      if (metadata.writeable) {
        // Convert to choice list for writable properties
        const choices = Object.entries(metadata.states)
          .sort(([a], [b]) => {
            const aNum = Number(a);
            const bNum = Number(b);
            if (!isNaN(aNum) && !isNaN(bNum)) {
              return aNum - bNum;
            }
            return a.localeCompare(b);
          })
          .map(([, value]) => String(value));

        setting = {
          ...setting,
          type: "string",
          choices,
          value: metadata.states[value as number],
        };
      } else {
        // Convert to string for readonly properties
        setting = {
          ...setting,
          type: "string",
          value: metadata.states[value as number],
        };
      }
    }
    // Handle number types with min/max range
    else if (
      metadata.type === "number" &&
      metadata.min !== undefined &&
      metadata.max !== undefined
    ) {
      setting = {
        ...setting,
        range: [metadata.min, metadata.max],
        placeholder: undefined,
        description: `Value must be between ${metadata.min}${
          metadata.unit || ""
        } and ${metadata.max}${metadata.unit || ""}`,
      };
    }

    return setting;
  }

  /**
   * Adjust value based on metadata for API submission
   *
   * Converts UI values back to API-compatible format.
   * For example, converts string choice to numeric index.
   *
   * @param value - Value from UI
   * @param metadata - Property metadata
   * @returns Adjusted value for API
   */
  static adjustValueForAPI(
    value: SettingValue,
    metadata: PropertyMetadataAny
  ): any {
    if (metadata.type === "number" && metadata.states) {
      // For number types with states, find the index of the value in the states map
      const stateValues = Object.values(metadata.states);
      return stateValues.indexOf(value as string);
    }
    return value;
  }

  /**
   * Determine appropriate UI group for a property
   *
   * @param propertyName - Name of the property
   * @returns Group name for UI organization
   */
  static getPropertyGroup(propertyName: string): string {
    const name = propertyName.toLowerCase();

    if (name.includes("motion") && !name.includes("light")) {
      return "Motion";
    }

    if (name.includes("light")) {
      return "Light";
    }

    if (
      name.includes("battery") ||
      name.includes("charge") ||
      name.includes("power")
    ) {
      return "Power";
    }

    if (name.includes("clip") || name.includes("record")) {
      return "Recording";
    }

    if (
      name.includes("video") ||
      name.includes("stream") ||
      name.includes("vision")
    ) {
      return "Video";
    }

    if (
      name.includes("microphone") ||
      name.includes("speaker") ||
      name.includes("notification")
    ) {
      return "Communication";
    }

    return "Configuration";
  }

  /**
   * Get all writable device properties as Settings
   *
   * @param properties - Current device properties
   * @param metadata - Property metadata map
   * @returns Array of Setting objects for writable properties
   */
  static getWritableSettings(
    properties: DeviceProperties,
    metadata: Record<string, PropertyMetadataAny>
  ): Setting[] {
    return Object.values(metadata)
      .filter((meta) => meta.writeable)
      .filter((meta) => !/test/i.test(meta.name))
      .filter((meta) => meta.name !== "light") // Hide light property (controlled via OnOff interface)
      .map((meta) =>
        PropertyMapper.toSetting(
          meta,
          properties[meta.name as keyof DeviceProperties],
          undefined,
          PropertyMapper.getPropertyGroup(meta.name)
        )
      );
  }

  /**
   * Get generic device information as Settings
   *
   * @param device - Device information object
   * @param metadata - Property metadata map
   * @returns Array of Setting objects for device info
   */
  static getDeviceInfoSettings(
    device: { model: string; serialNumber: string; firmware: string },
    metadata: Record<keyof CommonEufyProperties, PropertyMetadataAny>
  ): Setting[] {
    return [
      PropertyMapper.toSetting(
        metadata["model"],
        device.model,
        "The full product name and model of the device."
      ),
      PropertyMapper.toSetting(
        metadata["serialNumber"],
        device.serialNumber,
        "The unique serial number assigned to the device."
      ),
      PropertyMapper.toSetting(
        metadata["softwareVersion"],
        device.firmware,
        "The current software version running on the device."
      ),
    ];
  }

  /**
   * Check if a property should be hidden from settings UI
   *
   * @param propertyName - Name of the property
   * @returns true if property should be hidden
   */
  static shouldHideProperty(propertyName: string): boolean {
    const hiddenProperties = [
      "light", // Controlled via OnOff interface
      "test", // Test properties
    ];

    return hiddenProperties.some((hidden) =>
      propertyName.toLowerCase().includes(hidden.toLowerCase())
    );
  }
}
