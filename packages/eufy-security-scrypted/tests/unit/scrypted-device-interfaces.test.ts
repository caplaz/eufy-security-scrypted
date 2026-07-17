jest.mock("@scrypted/sdk", () => ({
  ScryptedInterface: {
    Camera: "Camera",
    VideoCamera: "VideoCamera",
    MotionSensor: "MotionSensor",
    Settings: "Settings",
    Refresh: "Refresh",
    Intercom: "Intercom",
    Battery: "Battery",
    Charger: "Charger",
    OnOff: "OnOff",
    Brightness: "Brightness",
    PanTiltZoom: "PanTiltZoom",
    BinarySensor: "BinarySensor",
    Sensors: "Sensors",
  },
}));

import {
  DeviceType,
  getDeviceCapabilities,
} from "@caplaz/eufy-security-client";
import { ScryptedInterface } from "@scrypted/sdk";
import { buildScryptedDeviceInterfaces } from "../../src/utils/scrypted-device-interfaces";

const interfacesFor = (
  type: DeviceType,
  properties: Record<string, unknown> = {},
) =>
  buildScryptedDeviceInterfaces(getDeviceCapabilities(type), {
    type,
    ...properties,
  } as any);

describe("buildScryptedDeviceInterfaces", () => {
  test("exposes a battery PTZ camera", () => {
    expect(interfacesFor(DeviceType.CAMERA_S4, { battery: 80 })).toEqual(
      expect.arrayContaining([
        ScryptedInterface.Camera,
        ScryptedInterface.VideoCamera,
        ScryptedInterface.MotionSensor,
        ScryptedInterface.Battery,
        ScryptedInterface.PanTiltZoom,
      ]),
    );
  });

  test("gives FamiLock S3 the doorbell video surface", () => {
    expect(interfacesFor(DeviceType.LOCK_85V0)).toEqual(
      expect.arrayContaining([
        ScryptedInterface.Camera,
        ScryptedInterface.VideoCamera,
        ScryptedInterface.BinarySensor,
      ]),
    );
  });

  test("does not give C33 a camera interface", () => {
    expect(interfacesFor(DeviceType.LOCK_85L0)).toEqual([
      ScryptedInterface.Settings,
      ScryptedInterface.Refresh,
    ]);
  });

  test("gives Motion Sensor E20 a motion interface and Siren E20 no camera interface", () => {
    expect(interfacesFor(DeviceType.PIR_SENSOR_E20)).toEqual(
      expect.arrayContaining([ScryptedInterface.MotionSensor]),
    );
    expect(interfacesFor(DeviceType.SIREN_SENSOR_E20)).not.toContain(
      ScryptedInterface.Camera,
    );
  });
});
