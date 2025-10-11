/**
 * Device State Service
 *
 * Manages device state updates from properties.
 * Handles conversion of Eufy properties to Scrypted device state.
 *
 * @module services/device
 */

import { ChargeState, ScryptedInterface } from "@scrypted/sdk";
import { ChargingStatus, DeviceProperties } from "@caplaz/eufy-security-client";
import { Logger, ILogObj } from "tslog";

/**
 * Device state that maps to Scrypted interfaces
 */
export interface DeviceState {
  motionDetected?: boolean;
  binaryState?: boolean;
  brightness?: number;
  on?: boolean;
  batteryLevel?: number;
  chargeState?: ChargeState;
  sensors?: Record<string, any>;
}

/**
 * State change event
 */
export interface StateChangeEvent {
  interface: ScryptedInterface;
  value: any;
}

/**
 * State change callback
 */
export type StateChangeCallback = (event: StateChangeEvent) => void;

/**
 * DeviceStateService handles device state management
 *
 * This service:
 * - Converts Eufy properties to Scrypted state
 * - Tracks device state (motion, battery, sensors, etc.)
 * - Notifies listeners of state changes
 * - Provides state accessors
 */
export class DeviceStateService {
  private state: DeviceState = {};
  private stateChangeCallbacks = new Set<StateChangeCallback>();

  constructor(private logger: Logger<ILogObj>) {}

  /**
   * Get current device state
   *
   * @returns Current state object
   */
  getState(): DeviceState {
    return { ...this.state };
  }

  /**
   * Update state from device properties
   *
   * Converts Eufy device properties to Scrypted-compatible state
   * and notifies listeners of changes.
   *
   * @param properties - Device properties from Eufy
   */
  updateFromProperties(properties?: DeviceProperties): void {
    if (!properties) return;

    const changes: StateChangeEvent[] = [];

    // Motion detection
    if (properties.motionDetected !== undefined) {
      const newValue = properties.motionDetected;
      if (this.state.motionDetected !== newValue) {
        this.state.motionDetected = newValue;
        changes.push({
          interface: ScryptedInterface.MotionSensor,
          value: newValue,
        });
      }
    }

    // Light settings
    if (properties.lightSettingsBrightnessManual !== undefined) {
      const newValue = properties.lightSettingsBrightnessManual;
      if (this.state.brightness !== newValue) {
        this.state.brightness = newValue;
        changes.push({
          interface: ScryptedInterface.Brightness,
          value: newValue,
        });
      }
    } else if (this.state.brightness === undefined) {
      this.state.brightness = 100; // Default
    }

    if (properties.light !== undefined) {
      const newValue = properties.light;
      if (this.state.on !== newValue) {
        this.state.on = newValue;
        changes.push({
          interface: ScryptedInterface.OnOff,
          value: newValue,
        });
      }
    }

    // Battery state
    if (properties.battery !== undefined) {
      const newValue = properties.battery;
      if (this.state.batteryLevel !== newValue) {
        this.state.batteryLevel = newValue;
        changes.push({
          interface: ScryptedInterface.Battery,
          value: newValue,
        });
      }
    } else if (this.state.batteryLevel === undefined) {
      this.state.batteryLevel = 100; // Default
    }

    // Charging status
    if (properties.chargingStatus !== undefined) {
      const newValue = this.convertChargingStatus(properties.chargingStatus);
      if (this.state.chargeState !== newValue) {
        this.state.chargeState = newValue;
        changes.push({
          interface: ScryptedInterface.Charger,
          value: newValue,
        });
      }
    }

    // WiFi sensors
    if (properties.wifiRssi !== undefined) {
      const newSensors = {
        ...this.state.sensors,
        wifiRssi: {
          name: "wifiRssi",
          value: properties.wifiRssi,
          unit: "dBm",
        },
      };
      this.state.sensors = newSensors;
      changes.push({
        interface: ScryptedInterface.Sensors,
        value: newSensors,
      });
    }

    // Notify all changes
    changes.forEach((change) => this.notifyStateChange(change));
  }

  /**
   * Update a single property and notify listeners
   *
   * @param propertyName - Name of the property that changed
   * @param value - New value
   */
  updateProperty(propertyName: keyof DeviceProperties, value: any): void {
    this.logger.debug(`Property changed: ${propertyName} = ${value}`);

    let change: StateChangeEvent | undefined;

    switch (propertyName) {
      case "light":
        this.state.on = value as boolean;
        change = {
          interface: ScryptedInterface.OnOff,
          value: this.state.on,
        };
        break;

      case "battery":
        this.state.batteryLevel = value as number;
        change = {
          interface: ScryptedInterface.Battery,
          value: this.state.batteryLevel,
        };
        break;

      case "chargingStatus":
        this.state.chargeState = this.convertChargingStatus(
          value as ChargingStatus
        );
        change = {
          interface: ScryptedInterface.Charger,
          value: this.state.chargeState,
        };
        break;

      case "wifiRssi":
        this.state.sensors = {
          ...this.state.sensors,
          wifiRssi: {
            name: propertyName,
            value: value as number,
            unit: "dBm",
          },
        };
        change = {
          interface: ScryptedInterface.Sensors,
          value: this.state.sensors,
        };
        break;

      case "motionDetected":
        this.state.motionDetected = value as boolean;
        change = {
          interface: ScryptedInterface.MotionSensor,
          value: this.state.motionDetected,
        };
        break;

      case "lightSettingsBrightnessManual":
        this.state.brightness = value as number;
        change = {
          interface: ScryptedInterface.Brightness,
          value: this.state.brightness,
        };
        break;

      default:
        this.logger.debug(
          `Property ${propertyName} does not affect device state`
        );
    }

    if (change) {
      this.notifyStateChange(change);
    }
  }

  /**
   * Subscribe to state changes
   *
   * @param callback - Callback to invoke on state changes
   * @returns Unsubscribe function
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * Update device state directly (not from properties)
   * Used for events that don't correspond to device properties
   */
  updateState(stateKey: keyof DeviceState, value: any): void {
    let change: StateChangeEvent | undefined;

    switch (stateKey) {
      case "binaryState":
        this.state.binaryState = value as boolean;
        change = {
          interface: ScryptedInterface.BinarySensor,
          value: this.state.binaryState,
        };
        break;

      default:
        this.logger.debug(`State key ${stateKey} not handled`);
    }

    if (change) {
      this.notifyStateChange(change);
    }
  }

  /**
   * Convert Eufy charging status to Scrypted ChargeState
   */
  private convertChargingStatus(
    status: ChargingStatus
  ): ChargeState | undefined {
    switch (status) {
      case ChargingStatus.NOT_CHARGING:
        return ChargeState.NotCharging;
      case ChargingStatus.CHARGING:
        return ChargeState.Charging;
      default:
        return undefined;
    }
  }

  /**
   * Notify listeners of state change
   */
  private notifyStateChange(event: StateChangeEvent): void {
    this.stateChangeCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        this.logger.error(`Error in state change callback: ${error}`);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stateChangeCallbacks.clear();
    this.state = {};
  }
}
