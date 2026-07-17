import {
  DeviceType,
  getDeviceCapabilities,
  getProductName,
  isBaseStation,
  isEntrySensor,
  isMotionSensor,
} from "../../src";

describe("eufy-security-ws 3.1.0 device support", () => {
  test.each([
    [DeviceType.CAMERA_S4],
    [DeviceType.SOLOCAM_E42],
    [DeviceType.CAMERA_4G_S330],
  ])("classifies %s as a battery PTZ camera", (type) => {
    const capabilities = getDeviceCapabilities(type);

    expect(capabilities.camera).toBe(true);
    expect(capabilities.battery).toBe(true);
    expect(capabilities.panTilt).toBe(true);
  });

  test("classifies FamiLock S3 as a battery dual doorbell and lock", () => {
    const capabilities = getDeviceCapabilities(DeviceType.LOCK_85V0);

    expect(capabilities).toMatchObject({
      camera: true,
      doorbell: true,
      lock: true,
      battery: true,
    });
  });

  test("classifies E20 sensor variants", () => {
    expect(isMotionSensor(DeviceType.PIR_SENSOR_E20)).toBe(true);
    expect(isEntrySensor(DeviceType.ENTRY_SENSOR_E20)).toBe(true);
    expect(getDeviceCapabilities(DeviceType.SIREN_SENSOR_E20).sensor).toBe(
      true,
    );
  });

  test("matches 4.1.0 battery, station, lock, and PTZ classifications", () => {
    expect(DeviceType.WATER_FREEZE_SENSOR_8920).toBe(20);
    expect(
      getDeviceCapabilities(DeviceType.WATER_FREEZE_SENSOR_8920).sensor,
    ).toBe(true);
    expect(getDeviceCapabilities(DeviceType.CAMERA_C35).battery).toBe(true);
    expect(getDeviceCapabilities(DeviceType.ENTRY_SENSOR_E20).battery).toBe(
      true,
    );
    expect(getDeviceCapabilities(DeviceType.LOCK_85P0)).toMatchObject({
      lock: true,
      battery: true,
    });
    expect(getDeviceCapabilities(DeviceType.CAMERA_POE_S4)).toMatchObject({
      camera: true,
      battery: false,
      panTilt: true,
    });
    expect(isBaseStation(DeviceType.HB3)).toBe(true);
    expect(isBaseStation(DeviceType.NVR_S4_MAX)).toBe(true);
  });

  test("resolves new model and station names", () => {
    expect(isBaseStation(DeviceType.HOMEBASE_MINI)).toBe(true);
    expect(getProductName("T8025")).toBe("HomeBase Mini");
    expect(getProductName("T85L0")).toBe("Smart Lock C33");
    expect(getProductName("T85D0")).toBe("Smart Lock C30");
    expect(getProductName("T85V0")).toBe("FamiLock S3 (Smart Lock E20)");
    expect(getProductName("T90M0")).toBe("Motion Sensor E20");
    expect(getProductName("T90R0")).toBe("Siren E20");
    expect(getProductName("T85P0")).toBe("FamiLock E34");
    expect(getProductName("T8N00")).toBe("NVR S4 Max");
    expect(getProductName("T8E00")).toBe("PoE Bullet-PTZ Cam S4");
    expect(getProductName("T8920")).toBe("Water and Freeze Sensor");
  });
});
