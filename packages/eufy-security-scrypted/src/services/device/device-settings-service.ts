/**
 * Device Settings Service
 *
 * Manages device settings operations.
 * Handles both device property settings and custom Scrypted settings.
 *
 * @module services/device
 */

import { Setting, SettingValue, ScryptedInterface } from "@scrypted/sdk";
import { DeviceProperties } from "@caplaz/eufy-security-client";
import { Logger, ILogObj } from "tslog";
import { PropertyMapper } from "../../utils/property-mapper";

/**
 * Device info with metadata
 */
export interface DeviceInfo {
  metadata: Record<string, any>;
  [key: string]: any;
}

/**
 * Settings change callback
 */
export type SettingsChangeCallback = () => void;

/**
 * Device command API interface
 */
export interface IDeviceCommandAPI {
  setProperty(propertyName: keyof DeviceProperties, value: any): Promise<void>;
}

/**
 * DeviceSettingsService handles device settings operations
 *
 * This service manages:
 * - Device property settings
 * - Custom Scrypted settings (e.g., device name)
 * - Settings UI generation
 * - Property updates via API
 */
export class DeviceSettingsService {
  private customSettings: Map<string, SettingValue> = new Map();
  private settingsChangeCallbacks = new Set<SettingsChangeCallback>();

  constructor(
    private deviceApi: IDeviceCommandAPI,
    private logger: Logger<ILogObj>
  ) {}

  /**
   * Get all device settings
   *
   * Combines device properties, metadata, and custom settings
   * into a list of Setting objects for the Scrypted UI.
   *
   * @param deviceInfo - Device information with metadata
   * @param properties - Current device properties
   * @param deviceName - Current device name
   * @returns Array of settings for the UI
   */
  getSettings(
    deviceInfo: DeviceInfo,
    properties: DeviceProperties,
    deviceName: string
  ): Setting[] {
    const { metadata } = deviceInfo;

    return [
      // Custom Scrypted settings
      {
        key: "scryptedName",
        title: "Device Name",
        description: "Name shown in Scrypted (can be customized)",
        value: deviceName,
        type: "string",
        readonly: false,
      },

      // Generic device information
      ...this.getGenericDeviceInfo(deviceInfo, metadata),

      // All writable device properties
      ...this.getWritableProperties(properties, metadata),
    ];
  }

  /**
   * Update a device setting
   *
   * Handles both device properties and custom settings.
   * Notifies callbacks after successful update.
   *
   * @param key - Setting key
   * @param value - New value
   * @param properties - Current device properties
   * @param metadata - Property metadata for value adjustment
   * @param onSuccess - Callback for successful update
   * @returns Promise that resolves when update is complete
   */
  async putSetting(
    key: string,
    value: SettingValue,
    properties: DeviceProperties,
    metadata: Record<string, any>,
    onSuccess?: (key: string, value: SettingValue) => void
  ): Promise<void> {
    try {
      // Handle device properties
      if (key in properties) {
        await this.updateDeviceProperty(
          key as keyof DeviceProperties,
          value,
          metadata[key]
        );
        if (onSuccess) {
          onSuccess(key, value);
        }
        this.notifySettingsChanged();
        return;
      }

      // Handle custom settings
      if (this.isCustomSetting(key)) {
        this.customSettings.set(key, value);
        if (onSuccess) {
          onSuccess(key, value);
        }
        this.notifySettingsChanged();
        return;
      }

      // Unknown setting
      this.logger.warn(`Unknown setting: ${key}`);
      throw new Error(`Unknown setting: ${key}`);
    } catch (error) {
      // Still notify UI even on error to reset button state
      this.notifySettingsChanged();
      throw error;
    }
  }

  /**
   * Get a custom setting value
   *
   * @param key - Setting key
   * @returns Setting value or undefined
   */
  getCustomSetting(key: string): SettingValue | undefined {
    return this.customSettings.get(key);
  }

  /**
   * Subscribe to settings changes
   *
   * @param callback - Callback to invoke when settings change
   * @returns Unsubscribe function
   */
  onSettingsChange(callback: SettingsChangeCallback): () => void {
    this.settingsChangeCallbacks.add(callback);
    return () => this.settingsChangeCallbacks.delete(callback);
  }

  /**
   * Update a device property via API
   */
  private async updateDeviceProperty(
    propertyName: keyof DeviceProperties,
    value: SettingValue,
    metadata: any
  ): Promise<void> {
    // Adjust the value based on metadata (e.g., convert state to index)
    const adjustedValue = metadata
      ? PropertyMapper.adjustValueForAPI(value, metadata)
      : value;

    this.logger.info(`Updating property ${propertyName} to ${adjustedValue}`);

    try {
      await this.deviceApi.setProperty(propertyName, adjustedValue);
      this.logger.info(`Property ${propertyName} updated successfully`);
    } catch (error) {
      this.logger.warn(`Failed to set property ${propertyName}: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a key is a custom setting
   */
  private isCustomSetting(key: string): boolean {
    return key === "scryptedName";
  }

  /**
   * Get generic device information settings
   */
  private getGenericDeviceInfo(
    deviceInfo: DeviceInfo,
    metadata: Record<string, any>
  ): Setting[] {
    const settings: Setting[] = [];

    // Add device type
    if (deviceInfo.type !== undefined) {
      settings.push({
        key: "deviceType",
        title: "Device Type",
        description: "Type of Eufy device",
        value: deviceInfo.type,
        type: "string",
        readonly: true,
      });
    }

    // Add model
    if (deviceInfo.model !== undefined) {
      settings.push({
        key: "model",
        title: "Model",
        description: "Device model number",
        value: deviceInfo.model,
        type: "string",
        readonly: true,
      });
    }

    // Add serial number
    if (deviceInfo.serialNumber !== undefined) {
      settings.push({
        key: "serialNumber",
        title: "Serial Number",
        description: "Device serial number",
        value: deviceInfo.serialNumber,
        type: "string",
        readonly: true,
      });
    }

    return settings;
  }

  /**
   * Get writable device properties as settings
   */
  private getWritableProperties(
    properties: DeviceProperties,
    metadata: Record<string, any>
  ): Setting[] {
    return PropertyMapper.getWritableSettings(properties, metadata);
  }

  /**
   * Notify all callbacks that settings have changed
   */
  private notifySettingsChanged(): void {
    this.settingsChangeCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        this.logger.error(`Error in settings change callback: ${error}`);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.settingsChangeCallbacks.clear();
    this.customSettings.clear();
  }
}
