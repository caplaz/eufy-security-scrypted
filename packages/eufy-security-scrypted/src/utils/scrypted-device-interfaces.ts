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
>;

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

  if (capabilities.battery && properties.chargingStatus !== undefined) {
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
