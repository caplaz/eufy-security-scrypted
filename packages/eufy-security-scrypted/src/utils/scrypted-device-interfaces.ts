import { ScryptedInterface } from "@scrypted/sdk";
import {
  DeviceProperties,
  getDeviceCapabilities,
  isEntrySensor,
  isMotionSensor,
} from "@caplaz/eufy-security-client";

type DeviceInterfaceProperties = Pick<
  DeviceProperties,
  | "type"
  | "battery"
  | "chargingStatus"
  | "light"
  | "lightSettingsBrightnessManual"
  | "wifiRssi"
  | "serialNumber"
  | "stationSerialNumber"
>;

/**
 * True when the device streams through a separate HomeBase rather than being
 * its own station (SoloCam, standalone doorbell).
 */
function isBehindHomeBase(properties: DeviceInterfaceProperties): boolean {
  return (
    !!properties.stationSerialNumber &&
    !!properties.serialNumber &&
    properties.stationSerialNumber !== properties.serialNumber
  );
}

export function buildScryptedDeviceInterfaces(
  capabilities: ReturnType<typeof getDeviceCapabilities>,
  properties: DeviceInterfaceProperties,
  hasTalkback = false,
): ScryptedInterface[] {
  const interfaces: ScryptedInterface[] = [
    ScryptedInterface.Settings,
    ScryptedInterface.Refresh,
  ];

  if (capabilities.camera) {
    interfaces.push(
      ScryptedInterface.Camera,
      ScryptedInterface.VideoCamera,
      ScryptedInterface.MotionSensor,
    );
  }

  if (capabilities.doorbell || isEntrySensor(properties.type)) {
    interfaces.push(ScryptedInterface.BinarySensor);
  }

  if (isMotionSensor(properties.type)) {
    interfaces.push(ScryptedInterface.MotionSensor);
  }

  if (capabilities.battery && properties.battery !== undefined) {
    interfaces.push(ScryptedInterface.Battery);
  }

  // Rebroadcast runs a continuous prebuffer for any battery camera that
  // reports Charging. For a solar camera on a HomeBase that means the stream
  // starts and dies every time the sun comes and goes, and while it runs it
  // holds the HomeBase's single stream slot, starving sibling cameras.
  // Without Charger, Rebroadcast keeps such cameras on demand only.
  if (
    capabilities.battery &&
    properties.chargingStatus !== undefined &&
    !(capabilities.camera && isBehindHomeBase(properties))
  ) {
    interfaces.push(ScryptedInterface.Charger);
  }

  if (capabilities.floodlight && properties.light !== undefined) {
    interfaces.push(ScryptedInterface.OnOff);
  }

  if (
    capabilities.floodlight &&
    properties.lightSettingsBrightnessManual !== undefined
  ) {
    interfaces.push(ScryptedInterface.Brightness);
  }

  if (capabilities.panTilt) {
    interfaces.push(ScryptedInterface.PanTiltZoom);
  }

  if (capabilities.camera && hasTalkback) {
    interfaces.push(ScryptedInterface.Intercom);
  }

  if (properties.wifiRssi !== undefined) {
    interfaces.push(ScryptedInterface.Sensors);
  }

  return [...new Set(interfaces)];
}
