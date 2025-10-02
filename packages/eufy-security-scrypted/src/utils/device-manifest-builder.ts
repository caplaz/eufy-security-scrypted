/**
 * Device Manifest Builder
 *
 * Builds Scrypted device manifests from Eufy device data.
 * Handles device type detection, interface assignment, and metadata mapping.
 *
 * @module utils
 */

import { Device, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import {
  EufyWebSocketClient,
  MODEL_NAMES,
  getDeviceCapabilities,
} from "@caplaz/eufy-security-client";
import { getScryptedDeviceType } from "./scrypted-device-detection";

/**
 * DeviceManifestBuilder creates Scrypted device manifests from Eufy device data
 */
export class DeviceManifestBuilder {
  /**
   * Create a device manifest for a Eufy station (base station/hub)
   *
   * @param wsClient - WebSocket client for API communication
   * @param serialNumber - Station serial number
   * @returns Complete Scrypted device manifest
   */
  static async buildStationManifest(
    wsClient: EufyWebSocketClient,
    serialNumber: string
  ): Promise<Device> {
    const api = wsClient.commands.station(serialNumber);
    const properties = (await api.getProperties()).properties;
    const metadata = (await api.getPropertiesMetadata()).properties;

    // Resolve human-readable model name
    const modelName = this.resolveModelName(
      properties.model,
      properties.type,
      metadata.type
    );

    return {
      nativeId: `station_${serialNumber}`,
      type: ScryptedDeviceType.DeviceProvider,
      interfaces: [
        ScryptedInterface.DeviceProvider,
        ScryptedInterface.Settings,
        ScryptedInterface.SecuritySystem,
        ScryptedInterface.Refresh,
        ScryptedInterface.Reboot,
      ],
      name: properties.name || `Eufy ${properties.model}`,
      info: {
        model: modelName,
        manufacturer: "Eufy",
        version: properties.hardwareVersion,
        firmware: properties.softwareVersion,
        serialNumber,
        mac: properties.macAddress,
        metadata,
      },
    };
  }

  /**
   * Create a device manifest for a Eufy camera or device
   *
   * @param wsClient - WebSocket client for API communication
   * @param serialNumber - Device serial number
   * @returns Complete Scrypted device manifest
   */
  static async buildDeviceManifest(
    wsClient: EufyWebSocketClient,
    serialNumber: string
  ): Promise<Device> {
    const api = wsClient.commands.device(serialNumber);
    const properties = (await api.getProperties()).properties;
    const metadata = (await api.getPropertiesMetadata()).properties;

    // Detect capabilities and device type
    const capabilities = getDeviceCapabilities(properties.type);
    const deviceType = getScryptedDeviceType(properties.type);

    // Build interface list based on capabilities
    const interfaces = this.buildInterfaceList(capabilities, properties);

    // Resolve human-readable model name
    const modelName = this.resolveModelName(
      properties.model,
      properties.type,
      metadata.type
    );

    // Clean device name (remove confusing suffixes)
    const cleanedName = this.cleanDeviceName(
      properties.name || `Eufy ${properties.model}`
    );

    return {
      nativeId: `device_${serialNumber}`,
      name: cleanedName,
      type: deviceType,
      interfaces,
      info: {
        manufacturer: "Eufy",
        model: modelName,
        serialNumber: properties.serialNumber,
        firmware: properties.softwareVersion,
        metadata,
      },
      // Link to the parent station
      providerNativeId: properties.stationSerialNumber
        ? `station_${properties.stationSerialNumber}`
        : undefined,
    };
  }

  /**
   * Build list of Scrypted interfaces based on device capabilities
   */
  private static buildInterfaceList(
    capabilities: ReturnType<typeof getDeviceCapabilities>,
    properties: any
  ): string[] {
    const interfaces: string[] = [
      ScryptedInterface.Camera,
      ScryptedInterface.VideoCamera,
      ScryptedInterface.MotionSensor,
      ScryptedInterface.Settings,
      ScryptedInterface.Refresh,
    ];

    // Battery and charging
    if (capabilities.battery) {
      if (properties.battery !== undefined) {
        interfaces.push(ScryptedInterface.Battery);
      }
      if (properties.chargingStatus !== undefined) {
        interfaces.push(ScryptedInterface.Charger);
      }
    }

    // Floodlight control
    if (capabilities.floodlight) {
      if (properties.light !== undefined) {
        interfaces.push(ScryptedInterface.OnOff);
      }
      if (properties.lightSettingsBrightnessManual !== undefined) {
        interfaces.push(ScryptedInterface.Brightness);
      }
    }

    // Pan/Tilt/Zoom
    if (capabilities.panTilt) {
      interfaces.push(ScryptedInterface.PanTiltZoom);
    }

    // Sensors (WiFi signal, etc.)
    if (properties.wifiRssi !== undefined) {
      interfaces.push(ScryptedInterface.Sensors);
    }

    return interfaces;
  }

  /**
   * Resolve human-readable model name from Eufy model code
   */
  private static resolveModelName(
    model: string | undefined,
    deviceType: number,
    typeMetadata: any
  ): string {
    if (model && MODEL_NAMES[model]) {
      return MODEL_NAMES[model];
    }

    if (model) {
      return model;
    }

    if (
      typeMetadata?.type === "number" &&
      typeMetadata.states &&
      typeMetadata.states[deviceType]
    ) {
      return typeMetadata.states[deviceType];
    }

    return "Unknown Model";
  }

  /**
   * Clean device name by removing confusing suffixes
   *
   * Removes suffixes like "Indicator Light" that appear in Eufy device names
   * but are misleading for user-facing display.
   */
  private static cleanDeviceName(name: string): string {
    const patternsToRemove = [/ Indicator Light$/i, / Indicator$/i];

    let cleanedName = name;
    for (const pattern of patternsToRemove) {
      cleanedName = cleanedName.replace(pattern, "");
    }

    return cleanedName.trim();
  }

  /**
   * Validate that a device manifest has required fields
   *
   * @param manifest - Device manifest to validate
   * @returns true if valid, throws error otherwise
   */
  static validateManifest(manifest: Device): boolean {
    if (!manifest.nativeId) {
      throw new Error("Device manifest missing nativeId");
    }

    if (!manifest.type) {
      throw new Error(`Device manifest ${manifest.nativeId} missing type`);
    }

    if (!manifest.interfaces || manifest.interfaces.length === 0) {
      throw new Error(`Device manifest ${manifest.nativeId} has no interfaces`);
    }

    if (!manifest.info) {
      throw new Error(`Device manifest ${manifest.nativeId} missing info`);
    }

    return true;
  }
}
