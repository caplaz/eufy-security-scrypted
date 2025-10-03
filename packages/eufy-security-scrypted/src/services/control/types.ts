/**
 * Control Service Types
 *
 * Shared type definitions for control services.
 *
 * @module services/control
 */

import { PanTiltDirection } from "@caplaz/eufy-security-client";

/**
 * PTZ Capabilities
 *
 * Defines which PTZ operations are supported by the device
 */
export interface PtzCapabilities {
  /**
   * Whether the device supports pan operations
   */
  pan: boolean;

  /**
   * Whether the device supports tilt operations
   */
  tilt: boolean;

  /**
   * Whether the device supports zoom operations
   */
  zoom: boolean;
}

/**
 * Device API for control operations
 *
 * Defines the contract for device API methods used by control services
 */
export interface DeviceApi {
  /**
   * Execute pan and tilt command
   */
  panAndTilt(options: { direction: PanTiltDirection }): Promise<void>;

  /**
   * Set device property
   */
  setProperty(key: string, value: unknown): Promise<void>;
}
