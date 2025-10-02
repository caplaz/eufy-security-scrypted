/**
 * Device Types
 *
 * Type definitions for device management and state handling.
 */

import { DeviceProperties } from "@caplaz/eufy-security-client";
import { ScryptedInterface } from "@scrypted/sdk";

/**
 * Device property change event
 */
export interface DevicePropertyUpdate {
  /** Property name that changed */
  name: keyof DeviceProperties;
  /** New property value */
  value: any;
}

/**
 * Device interface change event
 */
export interface DeviceInterfaceUpdate {
  /** Scrypted interface that changed */
  interface: ScryptedInterface;
  /** New value for the interface */
  value: any;
}

/**
 * Device state snapshot
 */
export interface DeviceState {
  /** Device serial number */
  serialNumber: string;
  /** Current device properties */
  properties: DeviceProperties;
  /** Timestamp of last update */
  lastUpdated: number;
  /** Whether device is online */
  online: boolean;
}

/**
 * Device event listener options
 */
export interface DeviceEventListenerOptions {
  /** Device serial number to filter events */
  serialNumber?: string;
  /** Event source to filter (device, station, driver) */
  source?: string;
}

/**
 * Device capability flags
 */
export interface DeviceCapabilities {
  battery: boolean;
  floodlight: boolean;
  panTilt: boolean;
  motion: boolean;
  audio: boolean;
  video: boolean;
  hasSnapshot: boolean;
  maxResolution?: {
    width: number;
    height: number;
  };
}
