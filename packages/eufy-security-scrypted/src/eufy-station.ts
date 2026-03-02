/**
 * Barebone Eufy Station Device for Scrypted
 *
 * Implements Scrypted DeviceProvider, Settings, SecuritySystem, Reboot, and Refresh interfaces.
 * Manages child device registration, station alarm/guard mode, and station configuration.
 */

import sdk, {
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

import { Logger, ILogObj } from "tslog";
import { EufyDevice } from "./eufy-device";
import {
  alarmModeMap,
  DeviceUtils,
  securitySystemMap,
} from "./utils/device-utils";

const { deviceManager } = sdk;

// Helper to create a transport function for routing tslog to Scrypted console
function createConsoleTransport(console: Console) {
  return (logObj: any) => {
    const meta = logObj._meta;
    if (!meta) return;
    const prefix = meta.name ? `[${meta.name}] ` : "";

    const args = Object.keys(logObj)
      .filter((key) => key !== "_meta" && key !== "toJSON")
      .map((key) => logObj[key]);

    const msg = args
      .map((a: any) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
      .join(" ");

    const level = meta.logLevelName?.toLowerCase();
    if (level === "warn") console.warn(`${prefix}${msg}`);
    else if (level === "error" || level === "fatal")
      console.error(`${prefix}${msg}`);
    else console.log(`${prefix}${msg}`);
  };
}

/**
 * EufyStation - Barebone station implementation
 */
export class EufyStation
  extends ScryptedDeviceBase
  implements DeviceProvider, Settings, SecuritySystem, Reboot, Refresh
{
  private wsClient: EufyWebSocketClient;
  private childDevices = new Map<string, EufyDevice>();
  private logger: Logger<ILogObj>;

  // Device info and state
  private latestProperties?: StationProperties;
  private propertiesLoaded: Promise<void>;

  /**
   * Get the serial number for this station.
   */
  get serialNumber(): string {
    return this.info?.serialNumber || "unknown";
  }

  /**
   * Get the API command interface for this station.
   */
  get api() {
    return this.wsClient.commands.station(this.serialNumber);
  }

  /**
   * Construct a new EufyStation.
   *
   * @param nativeId       - Scrypted nativeId for this station.
   * @param wsClient       - EufyWebSocketClient instance.
   * @param parentLogger   - Parent logger (from provider).
   * @param allDeviceSerials - Full list of known device serials from server state.
   *                          The station filters these to its own children so we
   *                          never need the non-existent commands.devices() call.
   */
  constructor(
    nativeId: string,
    wsClient: EufyWebSocketClient,
    parentLogger: Logger<ILogObj>,
    allDeviceSerials: string[] = []
  ) {
    super(nativeId);
    this.wsClient = wsClient;

    const loggerName = nativeId.charAt(0).toUpperCase() + nativeId.slice(1);
    this.logger = parentLogger.getSubLogger({
      name: loggerName,
      attachedTransports: [],
    });
    this.logger.attachTransport(createConsoleTransport(this.console));

    this.logger.info(`Created EufyStation for ${nativeId}`);

    this.addEventListener(
      STATION_EVENTS.PROPERTY_CHANGED,
      ((event: StationPropertyChangedEventPayload) => {
        this.handlePropertyChangedEvent(event);
      }).bind(this)
    );

    this.addEventListener(STATION_EVENTS.GUARD_MODE_CHANGED, (_event) => {});

    this.addEventListener(STATION_EVENTS.CURRENT_MODE_CHANGED, (_event) => {
      this.handlePropertyChangedEvent.bind(this);
    });

    // Begin loading initial properties
    this.propertiesLoaded = this.loadInitialProperties();

    // Pre-declare all child devices so Scrypted can match nativeId → numericId
    // from its persisted database and keep IDs stable across restarts.
    if (allDeviceSerials.length > 0) {
      this.loadChildDevices(allDeviceSerials).catch((err) => {
        this.logger.warn(`Failed to pre-declare child devices: ${err}`);
      });
    }
  }

  private async loadInitialProperties() {
    try {
      this.latestProperties = (await this.api.getProperties()).properties;
      this.updateStateFromProperties(this.latestProperties);
    } catch (e) {
      this.logger.warn(`Failed to load initial properties: ${e}`);
    }
  }

  /**
   * Filter allDeviceSerials to those belonging to this station, build their
   * manifests, and call onDevicesChanged once so Scrypted has an authoritative
   * child list before it ever calls getDevice().
   *
   * We receive the full device list from the provider (which already has it
   * from serverState.state.devices) so no extra API call is required.
   */
  private async loadChildDevices(allDeviceSerials: string[]): Promise<void> {
    try {
      const childSerials: string[] = [];

      for (const serial of allDeviceSerials) {
        try {
          const props = (
            await this.wsClient.commands.device(serial).getProperties()
          ).properties;
          if (props.stationSerialNumber === this.serialNumber) {
            childSerials.push(serial);
          }
        } catch (e) {
          this.logger.warn(
            `Could not fetch properties for device ${serial}: ${e}`
          );
        }
      }

      if (childSerials.length === 0) {
        this.logger.debug(
          `No child devices found for station ${this.nativeId}`
        );
        return;
      }

      const manifests = await Promise.all(
        childSerials.map((serial) =>
          DeviceUtils.createDeviceManifest(this.wsClient, serial)
        )
      );

      await deviceManager.onDevicesChanged({
        providerNativeId: this.nativeId,
        devices: manifests,
      });

      this.logger.info(
        `✅ Pre-declared ${manifests.length} child device(s) for station ${this.nativeId}`
      );
    } catch (err) {
      this.logger.warn(`loadChildDevices failed for ${this.nativeId}: ${err}`);
    }
  }

  // =================== PROPERTY MANAGEMENT ===================

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
        this.logger.info(`Property changed: ${name} = ${value}`);
    }
  }

  // =================== DEVICE PROVIDER INTERFACE ===================

  async getDevice(nativeId: ScryptedNativeId): Promise<any> {
    if (nativeId && nativeId.startsWith("device_")) {
      this.logger.debug(`Getting device ${nativeId}`);

      let device = this.childDevices.get(nativeId);
      if (!device) {
        device = new EufyDevice(nativeId, this.wsClient, this.logger);
        this.childDevices.set(nativeId, device);
        this.logger.info(`Created new device ${nativeId}`);
      }
      return device;
    }
    return undefined;
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
    const deviceId = nativeId || "";
    this.logger.debug(`Releasing device ${deviceId}`);
    this.childDevices.delete(deviceId);
  }

  // =================== SETTINGS INTERFACE ===================

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
      ...DeviceUtils.genericDeviceInformation(info!, metadata),
      DeviceUtils.settingFromMetadata(
        metadata["currentMode"],
        this.latestProperties?.currentMode,
        "Indicates the current operating mode of the security system.",
        securitySystemGroup
      ),
      DeviceUtils.settingFromMetadata(
        metadata["guardMode"],
        this.latestProperties?.guardMode,
        "Guard mode determines how the security system responds to events.",
        securitySystemGroup
      ),
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    this.logger.debug(`Setting ${key} = ${value}`);

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
            this.logger.warn(`Failed to set guardMode: ${error}`);
          });
        break;
      default:
        this.logger.warn(`Unknown setting: ${key}`);
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

  async armSecuritySystem(mode: SecuritySystemMode): Promise<void> {
    if (this.securitySystemState) {
      this.securitySystemState.mode = mode;
    }
    this.api.setProperty("guardMode", securitySystemMap[mode]);
  }

  async disarmSecuritySystem(): Promise<void> {
    return this.armSecuritySystem(SecuritySystemMode.Disarmed);
  }

  // =================== REFRESH ===================

  async getRefreshFrequency(): Promise<number> {
    return 1800;
  }

  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<void> {
    if (!refreshInterface) {
      try {
        this.latestProperties = (await this.api.getProperties()).properties;
        this.updateStateFromProperties(this.latestProperties);
      } catch (error) {
        this.logger.warn(
          `Failed to get station properties: ${error}, user initiated: ${userInitiated}`
        );
      }
    }
  }

  // =================== REBOOT INTERFACE ===================

  async reboot(): Promise<void> {
    this.logger.info("Rebooting");
    await this.api.reboot();
  }

  // =================== UTILITY METHODS ===================

  dispose(): void {
    this.childDevices.forEach((device) => {
      device.dispose();
    });
    this.childDevices.clear();
    this.logger.debug(`Disposed`);
  }
}
