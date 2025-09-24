/**
 * Simplified Eufy Security Station Implementation for Scrypted
 */

import {
  Device,
  DeviceProvider,
  Refresh,
  SecuritySystem,
  SecuritySystemMode,
  SecuritySystemState,
  ScryptedDeviceType,
  ScryptedInterface,
  Setting,
  Settings,
} from "@scrypted/sdk";

import { EufyWebSocketClient } from "../../eufy-security-client/dist";
import { StreamServer } from "../../eufy-stream-server/dist";
import { DeviceUtils } from "./utils/device-utils";
import { createDebugLogger } from "./utils/debug-logger";

/**
 * Simplified Eufy Security Station Device
 */
export class EufyStation
  implements SecuritySystem, DeviceProvider, Settings, Refresh
{
  private logger = createDebugLogger("EufyStation");
  private properties: any = {};
  private childDevices: Map<string, Device> = new Map();

  constructor(
    private nativeId: string,
    private console: Console,
    private wsClient: EufyWebSocketClient,
    private streamServer?: StreamServer
  ) {
    this.logger.d("Creating EufyStation instance", { nativeId });
  }

  async initialize(): Promise<void> {
    try {
      this.logger.d("Initializing station", { nativeId: this.nativeId });
      const stationSerial = this.nativeId.replace("station_", "");
      const response = await this.wsClient.commands
        .station(stationSerial)
        .getProperties();
      this.properties = response.properties;
      this.logger.i("Station initialized successfully", {
        stationSerial,
        name: this.properties.name,
      });
    } catch (error) {
      this.logger.e("Failed to initialize station", {
        error,
        nativeId: this.nativeId,
      });
      throw error;
    }
  }

  async getSecuritySystemState(): Promise<SecuritySystemState> {
    return {
      mode: SecuritySystemMode.Disarmed,
      triggered: false,
    };
  }

  async armSecuritySystem(mode: SecuritySystemMode): Promise<void> {
    const stationSerial = this.nativeId.replace("station_", "");
    this.logger.i("Setting security system mode", { stationSerial, mode });
    // Implementation would go here
  }

  async disarmSecuritySystem(): Promise<void> {
    await this.armSecuritySystem(SecuritySystemMode.Disarmed);
  }

  async getDevice(nativeId: string): Promise<any> {
    return undefined;
  }

  async releaseDevice(id: string, nativeId: string): Promise<void> {
    this.childDevices.delete(nativeId);
    this.logger.d("Released device", { id, nativeId });
  }

  async getChildDevices(): Promise<Device[]> {
    return [];
  }

  async getSettings(): Promise<Setting[]> {
    return [];
  }

  async putSetting(key: string, value: any): Promise<void> {
    this.properties[key] = value;
  }

  async getRefreshFrequency(): Promise<number> {
    return 300;
  }

  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<void> {
    this.logger.d("Refreshing station", { nativeId: this.nativeId });
  }
}
