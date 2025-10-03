/**
 * Extended tests for device-detection utilities
 * Covers edge cases and all device types
 */

import {
  getDeviceTypeName,
  isCamera,
  isDoorbell,
  isFloodlight,
  isSensor,
  isLock,
  isBaseStation,
  isPanAndTiltCamera,
  isMotionSensor,
} from "../../src/utils/device-detection";
import { DeviceType } from "../../src/device/constants";

describe("Device Detection - Extended Coverage", () => {
  describe("getDeviceTypeName()", () => {
    it("should return correct names for all camera types", () => {
      const cameraTypes = [
        DeviceType.CAMERA,
        DeviceType.CAMERA2,
        DeviceType.CAMERA_E,
        DeviceType.CAMERA2C,
        DeviceType.CAMERA2C_PRO,
        DeviceType.CAMERA2_PRO,
        DeviceType.CAMERA3,
        DeviceType.CAMERA3C,
        DeviceType.CAMERA3_PRO,
        DeviceType.SOLO_CAMERA,
        DeviceType.SOLO_CAMERA_PRO,
        DeviceType.INDOOR_CAMERA,
        DeviceType.INDOOR_PT_CAMERA,
        DeviceType.OUTDOOR_PT_CAMERA,
      ];

      cameraTypes.forEach((type) => {
        const name = getDeviceTypeName(type);
        expect(name).toContain("Camera");
        expect(name).not.toBe("Unknown");
      });
    });

    it("should return correct names for all doorbell types", () => {
      const doorbellTypes = [
        DeviceType.DOORBELL,
        DeviceType.BATTERY_DOORBELL,
        DeviceType.BATTERY_DOORBELL_2,
        DeviceType.BATTERY_DOORBELL_PLUS,
        DeviceType.DOORBELL_SOLO,
      ];

      doorbellTypes.forEach((type) => {
        const name = getDeviceTypeName(type);
        expect(name).toContain("Doorbell");
      });
    });

    it("should return correct names for floodlight types", () => {
      const floodlightTypes = [
        DeviceType.FLOODLIGHT,
        DeviceType.FLOODLIGHT_CAMERA_8422,
        DeviceType.FLOODLIGHT_CAMERA_8423,
        DeviceType.FLOODLIGHT_CAMERA_8424,
        DeviceType.WALL_LIGHT_CAM,
      ];

      floodlightTypes.forEach((type) => {
        const name = getDeviceTypeName(type);
        expect(name.toLowerCase()).toMatch(/floodlight|spotlight|wall/);
      });
    });

    it("should return correct names for lock types", () => {
      const lockTypes = [
        DeviceType.LOCK_BLE,
        DeviceType.LOCK_WIFI,
        DeviceType.LOCK_8503,
        DeviceType.LOCK_8504,
        DeviceType.LOCK_8530,
      ];

      lockTypes.forEach((type) => {
        const name = getDeviceTypeName(type);
        expect(name).toContain("Lock");
      });
    });

    it("should return correct names for sensor types", () => {
      expect(getDeviceTypeName(DeviceType.SENSOR)).toContain("Sensor");
      expect(getDeviceTypeName(DeviceType.MOTION_SENSOR)).toContain("Motion");
    });

    it("should return correct names for station types", () => {
      expect(getDeviceTypeName(DeviceType.STATION)).toContain("Station");
      expect(getDeviceTypeName(DeviceType.MINIBASE_CHIME)).toContain("Station");
    });

    it("should return 'Unknown' for unsupported device types", () => {
      const unknownTypes = [99999, -1, 0, 10000];
      unknownTypes.forEach((type) => {
        expect(getDeviceTypeName(type)).toBe("Unknown");
      });
    });

    it("should handle edge case device numbers", () => {
      expect(getDeviceTypeName(Number.MAX_SAFE_INTEGER)).toBe("Unknown");
      expect(getDeviceTypeName(Number.MIN_SAFE_INTEGER)).toBe("Unknown");
    });
  });

  describe("isCamera()", () => {
    it("should return true for all camera types", () => {
      expect(isCamera(DeviceType.CAMERA)).toBe(true);
      expect(isCamera(DeviceType.CAMERA2)).toBe(true);
      expect(isCamera(DeviceType.CAMERA_E)).toBe(true);
      expect(isCamera(DeviceType.INDOOR_CAMERA)).toBe(true);
      expect(isCamera(DeviceType.INDOOR_PT_CAMERA)).toBe(true);
      expect(isCamera(DeviceType.SOLO_CAMERA)).toBe(true);
    });

    it("should return false for non-camera types", () => {
      expect(isCamera(DeviceType.DOORBELL)).toBe(false);
      expect(isCamera(DeviceType.LOCK_BLE)).toBe(false);
      expect(isCamera(DeviceType.SENSOR)).toBe(false);
      expect(isCamera(DeviceType.STATION)).toBe(false);
    });
  });

  describe("isDoorbell()", () => {
    it("should return true for all doorbell types", () => {
      expect(isDoorbell(DeviceType.DOORBELL)).toBe(true);
      expect(isDoorbell(DeviceType.BATTERY_DOORBELL)).toBe(true);
      expect(isDoorbell(DeviceType.BATTERY_DOORBELL_2)).toBe(true);
      expect(isDoorbell(DeviceType.DOORBELL_SOLO)).toBe(true);
    });

    it("should return false for non-doorbell types", () => {
      expect(isDoorbell(DeviceType.CAMERA)).toBe(false);
      expect(isDoorbell(DeviceType.LOCK_BLE)).toBe(false);
    });
  });

  describe("isFloodlight()", () => {
    it("should return true for floodlight types", () => {
      expect(isFloodlight(DeviceType.FLOODLIGHT)).toBe(true);
      expect(isFloodlight(DeviceType.FLOODLIGHT_CAMERA_8422)).toBe(true);
      expect(isFloodlight(DeviceType.WALL_LIGHT_CAM)).toBe(true);
    });

    it("should return false for non-floodlight types", () => {
      expect(isFloodlight(DeviceType.CAMERA)).toBe(false);
      expect(isFloodlight(DeviceType.DOORBELL)).toBe(false);
    });
  });

  describe("isSensor()", () => {
    it("should return true for sensor types", () => {
      expect(isSensor(DeviceType.SENSOR)).toBe(true);
      expect(isSensor(DeviceType.MOTION_SENSOR)).toBe(true);
    });

    it("should return false for non-sensor types", () => {
      expect(isSensor(DeviceType.CAMERA)).toBe(false);
      expect(isSensor(DeviceType.DOORBELL)).toBe(false);
    });
  });

  describe("isLock()", () => {
    it("should return true for all lock types", () => {
      expect(isLock(DeviceType.LOCK_BLE)).toBe(true);
      expect(isLock(DeviceType.LOCK_WIFI)).toBe(true);
      expect(isLock(DeviceType.LOCK_8503)).toBe(true);
      expect(isLock(DeviceType.LOCK_8530)).toBe(true);
    });

    it("should return false for non-lock types", () => {
      expect(isLock(DeviceType.CAMERA)).toBe(false);
      expect(isLock(DeviceType.DOORBELL)).toBe(false);
    });
  });

  describe("isBaseStation()", () => {
    it("should return true for station types", () => {
      expect(isBaseStation(DeviceType.STATION)).toBe(true);
      expect(isBaseStation(DeviceType.MINIBASE_CHIME)).toBe(true);
    });

    it("should return false for non-station types", () => {
      expect(isBaseStation(DeviceType.CAMERA)).toBe(false);
      expect(isBaseStation(DeviceType.DOORBELL)).toBe(false);
    });
  });

  describe("isMotionSensor()", () => {
    it("should return true for motion sensor", () => {
      expect(isMotionSensor(DeviceType.MOTION_SENSOR)).toBe(true);
    });

    it("should return false for non-motion sensors", () => {
      expect(isMotionSensor(DeviceType.SENSOR)).toBe(false); // Entry sensor
      expect(isMotionSensor(DeviceType.CAMERA)).toBe(false);
    });
  });

  describe("isPanAndTiltCamera()", () => {
    it("should return true for pan/tilt cameras", () => {
      expect(isPanAndTiltCamera(DeviceType.INDOOR_PT_CAMERA)).toBe(true);
      expect(isPanAndTiltCamera(DeviceType.INDOOR_PT_CAMERA_1080)).toBe(true);
      expect(isPanAndTiltCamera(DeviceType.OUTDOOR_PT_CAMERA)).toBe(true);
    });

    it("should return false for fixed cameras", () => {
      expect(isPanAndTiltCamera(DeviceType.CAMERA)).toBe(false);
      expect(isPanAndTiltCamera(DeviceType.DOORBELL)).toBe(false);
      expect(isPanAndTiltCamera(DeviceType.INDOOR_CAMERA)).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined and null gracefully", () => {
      expect(getDeviceTypeName(undefined as any)).toBe("Unknown");
      expect(getDeviceTypeName(null as any)).toBe("Unknown");

      expect(isCamera(undefined as any)).toBe(false);
      expect(isCamera(null as any)).toBe(false);
    });

    it("should handle string device types", () => {
      expect(getDeviceTypeName("123" as any)).toBe("Unknown");
      expect(isCamera("camera" as any)).toBe(false);
    });

    it("should handle floating point numbers", () => {
      expect(getDeviceTypeName(1.5)).toBe("Unknown");
      expect(getDeviceTypeName(DeviceType.CAMERA + 0.1)).toBe("Unknown");
    });

    it("should handle negative numbers", () => {
      expect(getDeviceTypeName(-1)).toBe("Unknown");
      expect(isCamera(-100)).toBe(false);
    });
  });
});
