/**
 * Device State Service Tests
 */

// Mock the SDK before imports
jest.mock("@scrypted/sdk", () => ({
  ScryptedInterface: {
    MotionSensor: "MotionSensor",
    Brightness: "Brightness",
    OnOff: "OnOff",
    Battery: "Battery",
    Charger: "Charger",
    Sensors: "Sensors",
  },
  ChargeState: {
    Charging: "Charging",
    NotCharging: "NotCharging",
  },
}));

import { DeviceStateService } from "../../../src/services/device/device-state-service";
import { ConsoleLogger } from "../../../src/utils/console-logger";
import { DeviceProperties, ChargingStatus } from "@caplaz/eufy-security-client";
import { ScryptedInterface, ChargeState } from "@scrypted/sdk";

describe("DeviceStateService", () => {
  let service: DeviceStateService;
  let mockLogger: jest.Mocked<ConsoleLogger>;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    service = new DeviceStateService(mockLogger);
  });

  afterEach(() => {
    service.dispose();
  });

  describe("getState", () => {
    it("should return empty state initially", () => {
      const state = service.getState();
      expect(state).toEqual({});
    });

    it("should return current state", () => {
      const properties: DeviceProperties = {
        motionDetected: true,
        battery: 75,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      const state = service.getState();
      expect(state.motionDetected).toBe(true);
      expect(state.batteryLevel).toBe(75);
    });
  });

  describe("updateFromProperties", () => {
    it("should handle undefined properties", () => {
      expect(() => service.updateFromProperties(undefined)).not.toThrow();
    });

    it("should update motion detected state", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        motionDetected: true,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().motionDetected).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.MotionSensor,
        value: true,
      });
    });

    it("should update light brightness", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        lightSettingsBrightnessManual: 50,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().brightness).toBe(50);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.Brightness,
        value: 50,
      });
    });

    it("should set default brightness if not provided", () => {
      const properties: DeviceProperties = {} as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().brightness).toBe(100);
    });

    it("should update light on/off state", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        light: true,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().on).toBe(true);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.OnOff,
        value: true,
      });
    });

    it("should update battery level", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        battery: 85,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().batteryLevel).toBe(85);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.Battery,
        value: 85,
      });
    });

    it("should set default battery level if not provided", () => {
      const properties: DeviceProperties = {} as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().batteryLevel).toBe(100);
    });

    it("should update charging status", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        chargingStatus: ChargingStatus.CHARGING,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().chargeState).toBe(ChargeState.Charging);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.Charger,
        value: ChargeState.Charging,
      });
    });

    it("should convert NOT_CHARGING status", () => {
      const properties: DeviceProperties = {
        chargingStatus: ChargingStatus.NOT_CHARGING,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().chargeState).toBe(ChargeState.NotCharging);
    });

    it("should update WiFi RSSI sensor", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        wifiRssi: -45,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(service.getState().sensors).toEqual({
        wifiRssi: {
          name: "wifiRssi",
          value: -45,
          unit: "dBm",
        },
      });
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.Sensors,
        value: expect.objectContaining({
          wifiRssi: expect.any(Object),
        }),
      });
    });

    it("should only notify on actual changes", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        motionDetected: true,
      } as DeviceProperties;

      service.updateFromProperties(properties);
      service.updateFromProperties(properties);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple property updates", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      const properties: DeviceProperties = {
        motionDetected: true,
        battery: 75,
        light: true,
        lightSettingsBrightnessManual: 80,
      } as DeviceProperties;

      service.updateFromProperties(properties);

      expect(callback).toHaveBeenCalledTimes(4);
    });
  });

  describe("updateProperty", () => {
    it("should update light property", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.updateProperty("light", false);

      expect(service.getState().on).toBe(false);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.OnOff,
        value: false,
      });
    });

    it("should update battery property", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.updateProperty("battery", 50);

      expect(service.getState().batteryLevel).toBe(50);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.Battery,
        value: 50,
      });
    });

    it("should update charging status property", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.updateProperty("chargingStatus", ChargingStatus.CHARGING);

      expect(service.getState().chargeState).toBe(ChargeState.Charging);
      expect(callback).toHaveBeenCalledWith({
        interface: ScryptedInterface.Charger,
        value: ChargeState.Charging,
      });
    });

    it("should update wifiRssi property", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.updateProperty("wifiRssi", -60);

      expect(service.getState().sensors).toEqual({
        wifiRssi: {
          name: "wifiRssi",
          value: -60,
          unit: "dBm",
        },
      });
    });

    it("should handle unknown property", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.updateProperty("unknown" as any, "value");

      expect(callback).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Property unknown does not affect device state"
      );
    });
  });

  describe("onStateChange", () => {
    it("should notify multiple listeners", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onStateChange(callback1);
      service.onStateChange(callback2);

      service.updateProperty("light", true);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it("should unsubscribe callback", () => {
      const callback = jest.fn();
      const unsubscribe = service.onStateChange(callback);

      unsubscribe();

      service.updateProperty("light", true);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle callback errors gracefully", () => {
      const badCallback = jest.fn().mockImplementation(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      service.onStateChange(badCallback);
      service.onStateChange(goodCallback);

      service.updateProperty("light", true);

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in state change callback")
      );
    });
  });

  describe("dispose", () => {
    it("should clear all callbacks", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.dispose();

      service.updateProperty("light", true);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should clear state", () => {
      service.updateProperty("light", true);

      service.dispose();

      expect(service.getState()).toEqual({});
    });

    it("should handle multiple dispose calls", () => {
      expect(() => {
        service.dispose();
        service.dispose();
      }).not.toThrow();
    });
  });
});
