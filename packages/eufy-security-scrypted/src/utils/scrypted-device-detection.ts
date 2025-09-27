/**
 * Scrypted-specific device detection utilities
 *
 * This module contains device detection functions that are specific to the Scrypted
 * integration and cannot be moved to the client package.
 */

import { ScryptedDeviceType } from "@scrypted/sdk";
import {
  isCamera,
  isDoorbell,
  isSensor,
  isLock,
} from "@caplaz/eufy-security-client";

/**
 * Maps a Eufy device type to the appropriate Scrypted device type.
 *
 * This function determines which Scrypted device type should be used
 * for a given Eufy device, enabling proper interface assignment and
 * device categorization within the Scrypted ecosystem.
 *
 * @param deviceType - The Eufy device type identifier
 * @returns The corresponding Scrypted device type
 */
export function getScryptedDeviceType(deviceType: number): ScryptedDeviceType {
  if (isDoorbell(deviceType)) return ScryptedDeviceType.Doorbell;
  else if (isCamera(deviceType)) return ScryptedDeviceType.Camera;
  else if (isSensor(deviceType)) return ScryptedDeviceType.Sensor;
  else if (isLock(deviceType)) return ScryptedDeviceType.Lock;
  else return ScryptedDeviceType.Unknown;
}
