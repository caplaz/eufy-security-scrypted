/**
 * Device Settings Service Tests
 */

import {
  DeviceSettingsService,
  IDeviceCommandAPI,
} from "../../../src/services/device/device-settings-service";
import { Logger, ILogObj } from "tslog";
import { DeviceProperties } from "@caplaz/eufy-security-client";

// Mock PropertyMapper
jest.mock("../../../src/utils/property-mapper", () => ({
  PropertyMapper: {
    adjustValueForAPI: jest.fn((value) => value),
    getWritableSettings: jest.fn(() => [
      {
        key: "testProperty",
        title: "Test Property",
        value: "test",
        type: "string",
        readonly: false,
      },
    ]),
  },
}));

describe("DeviceSettingsService", () => {
  let service: DeviceSettingsService;
  let mockDeviceApi: jest.Mocked<IDeviceCommandAPI>;
  let mockLogger: jest.Mocked<Logger<ILogObj>>;

  const mockProperties: DeviceProperties = {
    name: "Test Camera",
    model: "T8600",
    serialNumber: "TEST-123",
    enabled: true,
  } as DeviceProperties;

  const mockDeviceInfo = {
    type: 1,
    model: "T8600",
    serialNumber: "TEST-123",
    metadata: {
      enabled: {
        type: "boolean",
      },
    },
  };

  const mockMetadata = {
    enabled: {
      type: "boolean",
    },
  };

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      silly: jest.fn(),
      trace: jest.fn(),
    } as any;

    mockDeviceApi = {
      setProperty: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new DeviceSettingsService(mockDeviceApi, mockLogger);
  });

  afterEach(() => {
    service.dispose();
  });

  describe("getSettings", () => {
    it("should return device name setting", () => {
      const settings = service.getSettings(
        mockDeviceInfo,
        mockProperties,
        "My Camera"
      );

      const nameSetting = settings.find((s) => s.key === "scryptedName");
      expect(nameSetting).toEqual({
        key: "scryptedName",
        title: "Device Name",
        description: "Name shown in Scrypted (can be customized)",
        value: "My Camera",
        type: "string",
        readonly: false,
      });
    });

    it("should include generic device information", () => {
      const settings = service.getSettings(
        mockDeviceInfo,
        mockProperties,
        "My Camera"
      );

      const typeSetting = settings.find((s) => s.key === "deviceType");
      expect(typeSetting).toBeDefined();
      expect(typeSetting?.value).toBe(1);

      const modelSetting = settings.find((s) => s.key === "model");
      expect(modelSetting).toBeDefined();
      expect(modelSetting?.value).toBe("T8600");

      const serialSetting = settings.find((s) => s.key === "serialNumber");
      expect(serialSetting).toBeDefined();
      expect(serialSetting?.value).toBe("TEST-123");
    });

    it("should include writable properties", () => {
      const settings = service.getSettings(
        mockDeviceInfo,
        mockProperties,
        "My Camera"
      );

      const testProperty = settings.find((s) => s.key === "testProperty");
      expect(testProperty).toBeDefined();
      expect(testProperty?.title).toBe("Test Property");
    });
  });

  describe("putSetting", () => {
    it("should update device property", async () => {
      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(mockDeviceApi.setProperty).toHaveBeenCalledWith("enabled", false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Updating property enabled to false"
      );
    });

    it("should call onSuccess callback for device property", async () => {
      const onSuccess = jest.fn();

      await service.putSetting(
        "enabled",
        false,
        mockProperties,
        mockMetadata,
        onSuccess
      );

      expect(onSuccess).toHaveBeenCalledWith("enabled", false);
    });

    it("should update custom setting", async () => {
      await service.putSetting(
        "scryptedName",
        "New Name",
        mockProperties,
        mockMetadata
      );

      expect(service.getCustomSetting("scryptedName")).toBe("New Name");
      expect(mockDeviceApi.setProperty).not.toHaveBeenCalled();
    });

    it("should call onSuccess callback for custom setting", async () => {
      const onSuccess = jest.fn();

      await service.putSetting(
        "scryptedName",
        "New Name",
        mockProperties,
        mockMetadata,
        onSuccess
      );

      expect(onSuccess).toHaveBeenCalledWith("scryptedName", "New Name");
    });

    it("should throw error for unknown setting", async () => {
      await expect(
        service.putSetting("unknown", "value", mockProperties, mockMetadata)
      ).rejects.toThrow("Unknown setting: unknown");

      expect(mockLogger.warn).toHaveBeenCalledWith("Unknown setting: unknown");
    });

    it("should notify listeners after successful update", async () => {
      const callback = jest.fn();
      service.onSettingsChange(callback);

      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(callback).toHaveBeenCalled();
    });

    it("should notify listeners even on error", async () => {
      const callback = jest.fn();
      service.onSettingsChange(callback);

      mockDeviceApi.setProperty.mockRejectedValueOnce(new Error("API Error"));

      await expect(
        service.putSetting("enabled", false, mockProperties, mockMetadata)
      ).rejects.toThrow("API Error");

      expect(callback).toHaveBeenCalled();
    });

    it("should handle API errors gracefully", async () => {
      const error = new Error("Network error");
      mockDeviceApi.setProperty.mockRejectedValueOnce(error);

      await expect(
        service.putSetting("enabled", false, mockProperties, mockMetadata)
      ).rejects.toThrow("Network error");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to set property enabled: Error: Network error"
      );
    });
  });

  describe("getCustomSetting", () => {
    it("should return undefined for unset custom setting", () => {
      expect(service.getCustomSetting("scryptedName")).toBeUndefined();
    });

    it("should return custom setting value after setting", async () => {
      await service.putSetting(
        "scryptedName",
        "My Name",
        mockProperties,
        mockMetadata
      );

      expect(service.getCustomSetting("scryptedName")).toBe("My Name");
    });
  });

  describe("onSettingsChange", () => {
    it("should notify listeners on settings change", async () => {
      const callback = jest.fn();
      service.onSettingsChange(callback);

      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should support multiple listeners", async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onSettingsChange(callback1);
      service.onSettingsChange(callback2);

      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it("should unsubscribe callback", async () => {
      const callback = jest.fn();
      const unsubscribe = service.onSettingsChange(callback);

      unsubscribe();

      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle callback errors gracefully", async () => {
      const badCallback = jest.fn().mockImplementation(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      service.onSettingsChange(badCallback);
      service.onSettingsChange(goodCallback);

      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in settings change callback")
      );
    });
  });

  describe("dispose", () => {
    it("should clear all callbacks", async () => {
      const callback = jest.fn();
      service.onSettingsChange(callback);

      service.dispose();

      await service.putSetting("enabled", false, mockProperties, mockMetadata);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should clear custom settings", async () => {
      await service.putSetting(
        "scryptedName",
        "Test",
        mockProperties,
        mockMetadata
      );

      service.dispose();

      expect(service.getCustomSetting("scryptedName")).toBeUndefined();
    });

    it("should handle multiple dispose calls", () => {
      expect(() => {
        service.dispose();
        service.dispose();
      }).not.toThrow();
    });
  });
});
