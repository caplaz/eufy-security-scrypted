/**
 * Barebone Eufy Station Device for Scrypted
 *
 * Implements Scrypted DeviceProvider, Settings, SecuritySystem, Reboot, and Refresh interfaces.
 * Manages child device registration, station alarm/guard mode, and station configuration.
 */

import {
  DeviceProvider,
  Reboot,
  Refresh,
  ScryptedDeviceBase,
  ScryptedInterface,
  ScryptedNativeId,
  SecuritySystem,
  SecuritySystemMode,
  Setting,
  Settings,
  SettingValue,
} from "@scrypted/sdk";

import {
  AlarmMode,
  EufyWebSocketClient,
  EVENT_SOURCES,
  EventCallbackForType,
  STATION_EVENTS,
  StationEventSource,
  StationEventType,
  StationProperties,
  StationPropertyChangedEventPayload,
} from "@caplaz/eufy-security-client";

import { createDebugLogger, DebugLogger } from "./utils/debug-logger";
import { EufyDevice } from "./eufy-device";
import {
  alarmModeMap,
  DeviceUtils,
  securitySystemMap,
} from "./utils/device-utils";

/**
 * EufyStation - Barebone station implementation
 */
export class EufyStation
  extends ScryptedDeviceBase
  implements DeviceProvider, Settings, SecuritySystem, Reboot, Refresh
{
  private wsClient: EufyWebSocketClient;
  private childDevices = new Map<string, EufyDevice>();
  private logger: DebugLogger;

  // Device info and state
  private latestProperties?: StationProperties;
  private propertiesLoaded: Promise<void>;

  /**
   * Get the serial number for this station.
   * @returns {string} Serial number from device info, or 'unknown' if not set.
   */
  get serialNumber(): string {
    return this.info?.serialNumber || "unknown";
  }

  /**
   * Get the API command interface for this station.
   * @returns {any} API command object for this station's serial number.
   */
  get api() {
    return this.wsClient.commands.station(this.serialNumber);
  }

  /**
   * Construct a new EufyStation.
   * @param nativeId - Scrypted nativeId for this station.
   * @param wsClient - EufyWebSocketClient instance for API access.
   */
  constructor(nativeId: string, wsClient: EufyWebSocketClient) {
    super(nativeId);
    this.wsClient = wsClient;
    this.logger = createDebugLogger(this.name);
    this.logger.i(`Created EufyStation for ${nativeId}`);

    this.addEventListener(
      STATION_EVENTS.PROPERTY_CHANGED,
      ((event: StationPropertyChangedEventPayload) => {
        this.handlePropertyChangedEvent(event);
      }).bind(this)
    );

    this.addEventListener(STATION_EVENTS.GUARD_MODE_CHANGED, (event) => {
      // this.handlePropertyChangedEvent(event);
    });

    this.addEventListener(STATION_EVENTS.CURRENT_MODE_CHANGED, (event) => {
      this.handlePropertyChangedEvent.bind(this);
    });

    // Begin loading initial properties
    this.propertiesLoaded = this.loadInitialProperties();
  }

  private async loadInitialProperties() {
    try {
      this.latestProperties = (await this.api.getProperties()).properties;
      this.updateStateFromProperties(this.latestProperties);
    } catch (e) {
      this.logger.w(`Failed to load initial properties: ${e}`);
    }
  }

  private updateStateFromProperties(properties?: StationProperties) {
    if (!properties) return;
  }

  // =================== EVENTs ===================

  private addEventListener<T extends StationEventType>(
    eventType: T,
    eventCallback: EventCallbackForType<T, StationEventSource>
  ): () => boolean {
    return this.wsClient.addEventListener(eventType, eventCallback, {
      source: EVENT_SOURCES.STATION,
      serialNumber: this.serialNumber,
    });
  }

  private handlePropertyChangedEvent({
    name,
    value,
  }: StationPropertyChangedEventPayload) {
    this.latestProperties = this.latestProperties && {
      ...this.latestProperties,
      [name]: value,
    };

    switch (name) {
      case "alarm":
      case "currentMode":
        this.onDeviceEvent(
          ScryptedInterface.SecuritySystem,
          this.securitySystemState
        );
        break;
      case "guardMode":
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        break;
      default:
        this.logger.i(`Property changed: ${name} = ${value}`);
    }
  }

  // =================== DEVICE PROVIDER INTERFACE ===================

  /**
   * Get or create a child device by nativeId.
   * @param nativeId - Scrypted nativeId for the child device.
   * @returns {Promise<EufyDevice>} The child device instance.
   */
  async getDevice(nativeId: ScryptedNativeId): Promise<any> {
    if (nativeId && nativeId.startsWith("device_")) {
      this.logger.d(`Getting device ${nativeId}`);

      // Return existing device or create new EufyDevice
      let device = this.childDevices.get(nativeId);
      if (!device) {
        device = new EufyDevice(nativeId, this.wsClient);
        this.childDevices.set(nativeId, device);
        this.logger.i(`Created new device ${nativeId}`);
      }
      return device;
    }
    return undefined;
  }

  /**
   * Release a child device by nativeId.
   * @param id - Device id (unused).
   * @param nativeId - Scrypted nativeId for the child device.
   * @returns {Promise<void>}
   */
  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
    const deviceId = nativeId || "";
    this.logger.d(`Releasing device ${deviceId}`);
    this.childDevices.delete(deviceId);
  }

  // =================== SETTINGS INTERFACE ===================

  /**
   * Get the settings for this station.
   * @returns {Promise<Setting[]>} Array of Scrypted Setting objects.
   */
  /**
   * Retrieves the settings for the Eufy station, including the station name,
   * generic device information, and security system-specific settings such as
   * current mode and guard mode. The settings are returned as an array of
   * `Setting` objects, which can be used for configuration in Scrypted.
   *
   * @returns A promise that resolves to an array of `Setting` objects representing
   * the configurable properties and metadata of the Eufy station.
   */
  async getSettings(): Promise<Setting[]> {
    await this.propertiesLoaded;

    const { info } = this;
    const { metadata } = info || {};

    const securitySystemGroup = "Security System";

    return [
      {
        key: "scryptedName",
        title: "Station Name",
        description: "Name shown in Scrypted (can be customized)",
        value: this.name,
        type: "string",
        readonly: false,
      },

      // generic info about this device
      ...DeviceUtils.genericDeviceInformation(info!, metadata),

      // Security system settings
      DeviceUtils.settingFromMetadata(
        metadata["currentMode"],
        this.latestProperties?.currentMode,
        "Indicates the current operating mode of the security system (e.g., Home, Away, Disarmed). This field is read-only and reflects the system's present state.",
        securitySystemGroup
      ),
      DeviceUtils.settingFromMetadata(
        metadata["guardMode"],
        this.latestProperties?.guardMode,
        "Guard mode determines how the security system responds to events. For example: 'Home' arms only outdoor sensors, 'Away' arms all sensors, and 'Disarmed' disables alarms. Other modes include 'Geofencing' (automatically arms/disarms based on your phone's location) and 'Schedule' (arms/disarms according to a set timetable). Select the mode that matches your current needs.",
        securitySystemGroup
      ),
    ];
  }

  /**
   * Update a setting for this station.
   * @param key - Setting key to update.
   * @param value - New value for the setting.
   * @returns {Promise<void>}
   */
  async putSetting(key: string, value: SettingValue): Promise<void> {
    this.logger.d(`Setting ${key} = ${value}`);

    switch (key) {
      case "scryptedName":
        this.name = String(value);
        break;
      case "guardMode":
        this.api
          .setProperty(
            "guardMode",
            DeviceUtils.valueAdjustedWithMetadata(
              value,
              this.info?.metadata["guardMode"]
            )
          )
          .catch((error) => {
            this.logger.w(`Failed to set guardMode: ${error}`);
          });
        break;
      default:
        this.logger.w(`Unknown setting: ${key}`);
    }
  }

  // =================== SECURITY SYSTEM INTERFACE ===================

  securitySystemState? = {
    mode: alarmModeMap[
      this.latestProperties?.currentMode ?? AlarmMode.DISARMED
    ],
    triggered: this.latestProperties?.alarm,
    supportedModes: [
      SecuritySystemMode.HomeArmed,
      SecuritySystemMode.AwayArmed,
      SecuritySystemMode.Disarmed,
    ],
  };

  /**
   * Arm the security system to a specific mode.
   * @param mode - SecuritySystemMode to arm to.
   * @returns {Promise<void>}
   */
  async armSecuritySystem(mode: SecuritySystemMode): Promise<void> {
    if (mode === SecuritySystemMode.Disarmed) {
      this.logger.d(`Disarming`);
    } else {
      this.logger.d(`Arming to mode ${mode}`);
    }

    if (this.securitySystemState) {
      this.securitySystemState.mode = mode;
    }

    this.api.setProperty("guardMode", securitySystemMap[mode]);
  }

  /**
   * Disarm the security system.
   * @returns {Promise<void>}
   */
  async disarmSecuritySystem(): Promise<void> {
    return this.armSecuritySystem(SecuritySystemMode.Disarmed);
  }

  // =================== REFRESH ===================

  /**
   * Get the refresh frequency for this station.
   * @returns {Promise<number>} Refresh interval in ms.
   */
  async getRefreshFrequency(): Promise<number> {
    return 1800; // 30 minutes
  }

  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<void> {
    // since I don't have a way to get a single property, we just refresh everything
    if (!refreshInterface) {
      try {
        this.latestProperties = (await this.api.getProperties()).properties;
        this.updateStateFromProperties(this.latestProperties);
      } catch (error) {
        this.logger.w(
          `Failed to get station properties: ${error}, user initiated: ${userInitiated}`
        );
      }
    }
  }

  // =================== REBOOT INTERFACE ===================

  /**
   * Reboot the station.
   * @returns {Promise<void>}
   */
  async reboot(): Promise<void> {
    this.logger.i("Rebooting");
    await this.api.reboot();
  }

  // =================== UTILITY METHODS ===================

  /**
   * Dispose of all child devices and clean up resources.
   */
  dispose(): void {
    this.childDevices.forEach((device) => {
      device.dispose();
    });
    this.childDevices.clear();
    this.logger.d(`Disposed`);
  }
}
