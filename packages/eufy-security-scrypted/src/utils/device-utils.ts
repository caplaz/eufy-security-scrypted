/**
 * device-utils.ts
 *
 * Utility functions and helpers for Eufy device management, Scrypted device manifest creation, device type detection, and property mapping.
 * This file provides core logic for translating Eufy device data into Scrypted-compatible device manifests, settings, and metadata.
 * It also includes helpers for device validation, support checks, and minimal device object creation.
 */

import {
  Device,
  DeviceInformation,
  ScryptedDeviceType,
  ScryptedInterface,
  SecuritySystemMode,
  Setting,
  SettingValue,
} from "@scrypted/sdk";
import {
  AlarmMode,
  CommonEufyProperties,
  DeviceProperties,
  EufyWebSocketClient,
  GuardMode,
  PropertyMetadataAny,
} from "@caplaz/eufy-security-client";
import {
  MODEL_NAMES,
  getDeviceCapabilities,
  isDoorbell,
} from "@caplaz/eufy-security-client";
import { getScryptedDeviceType } from "./scrypted-device-detection";

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
 * DeviceUtils
 *
 * Static utility class for Eufy device and station manifest creation, settings mapping, device validation,
 * and support detection. Used throughout the plugin to standardize device handling and Scrypted integration.
 */
export class DeviceUtils {
  /**
   * Generates an array of device settings based on the provided device information and property metadata.
   *
   * This method extracts and formats the following settings:
   * - Model: The hardware model identifier of the device.
   * - Serial Number: The unique serial number assigned to the device.
   * - Software Version: The current firmware or software version running on the device.
   *
   * @param device - The device information object containing model, serial number, and firmware details.
   * @param metadata - A mapping of common Eufy property keys to their corresponding metadata definitions.
   * @returns An array of `Setting` objects representing the device's model, serial number, and software version.
   */
  static genericDeviceInformation(
    device: DeviceInformation,
    metadata: Record<keyof CommonEufyProperties, PropertyMetadataAny>
  ): Setting[] {
    return [
      DeviceUtils.settingFromMetadata(
        metadata["model"],
        device.model,
        "The full product name and model of the device."
      ),
      DeviceUtils.settingFromMetadata(
        metadata["serialNumber"],
        device.serialNumber,
        "The unique serial number assigned to the device."
      ),
      DeviceUtils.settingFromMetadata(
        metadata["softwareVersion"],
        device.firmware,
        "The current software version running on the device."
      ),
    ];
  }

  static allWriteableDeviceProperties(
    properties: DeviceProperties,
    metadata: Record<string, PropertyMetadataAny>
  ): Setting[] {
    return Object.values(metadata)
      .filter((meta) => meta.writeable)
      .filter((meta) => !/test/i.test(meta.name))
      .filter((meta) => meta.name !== "light")
      .map((meta) =>
        DeviceUtils.settingFromMetadata(
          meta,
          properties[meta.name as keyof DeviceProperties],
          undefined,
          // Default group for all settings
          DeviceUtils.groupForPropertyName(meta.name)
        )
      );
  }

  static groupForPropertyName(name: string): string {
    const n = name.toLowerCase();
    if (n.includes("motion") && !n.includes("light")) return "Motion";

    if (n.includes("light")) return "Light";

    if (n.includes("battery") || n.includes("charge") || n.includes("power"))
      return "Power";

    if (n.includes("clip") || n.includes("record")) return "Recording";

    if (n.includes("video") || n.includes("stream") || n.includes("vision"))
      return "Video";

    if (
      n.includes("microphone") ||
      n.includes("speaker") ||
      n.includes("notification")
    )
      return "Communication";
    return "Configuration";
  }

  static valueAdjustedWithMetadata(
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
   * Converts Eufy property metadata into a Scrypted Setting object for UI/configuration.
   * Handles type conversion and value/choice mapping for Scrypted settings.
   */
  static settingFromMetadata(
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

    // If the property is a number with states, convert to a string choice list for Scrypted
    if (metadata.type === "number" && metadata.states) {
      if (metadata.writeable) {
        // Convert the states map to an array of values, sorted by key
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
        setting = {
          ...setting,
          type: "string",
          value: metadata.states[value as number],
        };
      }
    } else if (
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
   * Creates a Scrypted device manifest for a Eufy station (base station/hub).
   * Fetches properties and metadata from the Eufy WebSocket API and maps them to Scrypted fields.
   * Includes security system state and device info for Scrypted registration.
   */
  static async createStationManifest(
    wsClient: EufyWebSocketClient,
    serialNumber: string
  ): Promise<Device> {
    const api = wsClient.commands.station(serialNumber);
    const properties = (await api.getProperties()).properties;
    const metadata = (await api.getPropertiesMetadata()).properties;

    // Human-readable model name resolution
    const humanModel = properties.model
      ? MODEL_NAMES[properties.model] || properties.model
      : metadata.type?.type === "number" && metadata.type.states
        ? metadata.type.states[properties.type]
        : "Unknown Model";

    // Return Scrypted device manifest for the station
    return {
      nativeId: `station_${serialNumber}`,
      type: ScryptedDeviceType.DeviceProvider,
      interfaces: [
        "DeviceProvider",
        "Settings",
        "SecuritySystem",
        "Refresh",
        "Reboot",
      ],
      name: properties.name || `Eufy ${properties.model}`,
      info: {
        model: humanModel,
        manufacturer: "Eufy",
        version: properties.hardwareVersion,
        firmware: properties.softwareVersion,
        serialNumber,
        // ip: properties.lanIpAddress,
        mac: properties.macAddress,
        metadata,
      },
    };
  }

  /**
   * Creates a Scrypted device manifest for a Eufy camera or device.
   * Determines device type, supported interfaces, and info fields for Scrypted registration.
   */
  static async createDeviceManifest(
    wsClient: EufyWebSocketClient,
    serialNumber: string
  ): Promise<Device> {
    const api = wsClient.commands.device(serialNumber);
    const properties = (await api.getProperties()).properties;
    const metadata = (await api.getPropertiesMetadata()).properties;
    // Validate required properties
    const capabilities = getDeviceCapabilities(properties.type);
    const deviceType = getScryptedDeviceType(properties.type);

    // Base interfaces that all camera devices should have
    const interfaces = [
      ScryptedInterface.Camera,
      ScryptedInterface.VideoCamera,
      // ScryptedInterface.VideoClips,
      ScryptedInterface.MotionSensor,
      ScryptedInterface.Settings,
      ScryptedInterface.Refresh,
    ];

    // Add Battery interface only for battery-powered devices
    if (capabilities.battery) {
      if (properties.battery !== undefined)
        interfaces.push(ScryptedInterface.Battery);
      if (properties.chargingStatus !== undefined)
        interfaces.push(ScryptedInterface.Charger);
    }

    if (capabilities.floodlight) {
      if (properties.light !== undefined)
        interfaces.push(ScryptedInterface.OnOff);
      if (properties.lightSettingsBrightnessManual !== undefined)
        interfaces.push(ScryptedInterface.Brightness);
    }

    // Add Pan/Tilt/Zoom interface for PTZ capable devices
    if (capabilities.panTilt) {
      interfaces.push(ScryptedInterface.PanTiltZoom);
    }

    // Add BinarySensor interface for doorbell devices
    if (isDoorbell(properties.type)) {
      interfaces.push(ScryptedInterface.BinarySensor);
    }

    if (properties.wifiRssi !== undefined) {
      interfaces.push(ScryptedInterface.Sensors);
    }

    // Human-readable model name resolution
    const humanModel = properties.model
      ? MODEL_NAMES[properties.model] || properties.model
      : metadata.type?.type === "number" && metadata.type.states
        ? metadata.type.states[properties.type]
        : "Unknown Model";

    // Return Scrypted device manifest for the camera/device
    return {
      nativeId: `device_${serialNumber}`,
      name: properties.name || `Eufy ${properties.model}`,
      type: deviceType,
      interfaces,
      info: {
        manufacturer: "Eufy",
        model: humanModel,
        serialNumber: properties.serialNumber,
        firmware: properties.softwareVersion,
        metadata,
      },
      // link to the base station for this device
      providerNativeId: properties.stationSerialNumber
        ? `station_${properties.stationSerialNumber}`
        : undefined,
    };
  }

  /**
   * Converts H.264 video data to JPEG image using FFmpeg.
   * This is a synchronous operation that pipes H.264 data to FFmpeg and captures the JPEG output.
   *
   * @param h264Data - Buffer containing H.264 encoded video data (typically a keyframe)
   * @param quality - JPEG quality setting (1-31, lower is better quality, default: 2)
   * @returns Promise resolving to Buffer containing JPEG image data
   * @throws Error if FFmpeg fails or returns invalid output
   */
  static async convertH264ToJPEG(
    h264Data: Buffer,
    quality: number = 2
  ): Promise<Buffer> {
    const child_process = await import("child_process");

    return new Promise<Buffer>((resolve, reject) => {
      // Use FFmpeg to decode H.264 and encode as JPEG
      const ffmpeg = child_process.spawn("ffmpeg", [
        "-f",
        "h264", // Input format
        "-i",
        "pipe:0", // Read from stdin
        "-frames:v",
        "1", // Extract only the first frame
        "-f",
        "image2", // Output format
        "-c:v",
        "mjpeg", // JPEG codec
        "-q:v",
        quality.toString(), // Quality setting (1-31, lower is better)
        "pipe:1", // Write to stdout
      ]);

      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      ffmpeg.stdout.on("data", (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on("data", (chunk) => {
        errorChunks.push(chunk);
      });

      ffmpeg.on("close", (code) => {
        if (code === 0 && chunks.length > 0) {
          const jpegBuffer = Buffer.concat(chunks);
          resolve(jpegBuffer);
        } else {
          const errorOutput = Buffer.concat(errorChunks).toString();
          const errorMessage = `FFmpeg conversion failed with code ${code}: ${
            errorOutput || "Unknown error"
          }`;

          // Provide more specific error messages based on common FFmpeg errors
          if (
            errorOutput.includes("Invalid data found when processing input")
          ) {
            reject(new Error(`Invalid H.264 data provided: ${errorOutput}`));
          } else if (errorOutput.includes("No such file or directory")) {
            reject(
              new Error(
                "FFmpeg executable not found. Please ensure FFmpeg is installed."
              )
            );
          } else if (errorOutput.includes("Permission denied")) {
            reject(new Error("Permission denied accessing FFmpeg executable."));
          } else {
            reject(new Error(errorMessage));
          }
        }
      });

      ffmpeg.on("error", (error) => {
        const errnoError = error as NodeJS.ErrnoException;
        if (errnoError.code === "ENOENT") {
          reject(
            new Error(
              "FFmpeg executable not found. Please ensure FFmpeg is installed and available in PATH."
            )
          );
        } else {
          reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
        }
      });

      // Write H.264 data to FFmpeg stdin
      ffmpeg.stdin.write(h264Data);
      ffmpeg.stdin.end();
    });
  }
}
