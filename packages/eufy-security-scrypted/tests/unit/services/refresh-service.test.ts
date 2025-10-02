/**
 * Refresh Service Tests
 */

import {
  RefreshService,
  IDeviceRefreshAPI,
} from "../../../src/services/device/refresh-service";
import { ConsoleLogger } from "../../../src/utils/console-logger";
import { DeviceProperties } from "@caplaz/eufy-security-client";

describe("RefreshService", () => {
  let service: RefreshService;
  let mockLogger: jest.Mocked<ConsoleLogger>;
  let mockDeviceAPI: jest.Mocked<IDeviceRefreshAPI>;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    mockDeviceAPI = {
      getProperties: jest.fn().mockResolvedValue({
        properties: {} as DeviceProperties,
      }),
    };

    service = new RefreshService(mockDeviceAPI, mockLogger);
  });

  afterEach(() => {
    service.dispose();
  });

  describe("refresh", () => {
    it("should call getProperties on device API", async () => {
      await service.refresh();

      expect(mockDeviceAPI.getProperties).toHaveBeenCalled();
    });

    it("should call onRefreshComplete callback on successful refresh", async () => {
      const onSuccess = jest.fn();
      const onError = jest.fn();

      service.onRefreshComplete(onSuccess);
      service.onRefreshError(onError);

      const mockProperties: DeviceProperties = {
        battery: 75,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await service.refresh();

      expect(onSuccess).toHaveBeenCalledWith(mockProperties);
      expect(onError).not.toHaveBeenCalled();
    });

    it("should call onRefreshError callback on failed refresh", async () => {
      const onSuccess = jest.fn();
      const onError = jest.fn();

      service.onRefreshComplete(onSuccess);
      service.onRefreshError(onError);

      const error = new Error("Refresh failed");
      mockDeviceAPI.getProperties.mockRejectedValue(error);

      await service.refresh();

      expect(onError).toHaveBeenCalledWith(error);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to refresh device properties")
      );
    });

    it("should handle refresh without callbacks", async () => {
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: {} as DeviceProperties,
      });

      await expect(service.refresh()).resolves.not.toThrow();
    });

    it("should log refresh operations", async () => {
      await service.refresh();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("refresh")
      );
    });

    it("should handle user-initiated refresh", async () => {
      await service.refresh(undefined, true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("User-initiated")
      );
    });

    it("should handle scheduled refresh", async () => {
      await service.refresh(undefined, false);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Scheduled")
      );
    });

    it("should log when specific interface refresh is requested", async () => {
      await service.refresh("Battery");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Refresh requested for interface Battery")
      );
    });

    it("should return properties on successful refresh", async () => {
      const mockProperties: DeviceProperties = {
        battery: 85,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      const result = await service.refresh();

      expect(result).toEqual(mockProperties);
    });

    it("should return undefined on failed refresh", async () => {
      mockDeviceAPI.getProperties.mockRejectedValue(new Error("API error"));

      const result = await service.refresh();

      expect(result).toBeUndefined();
    });
  });

  describe("getRefreshFrequency", () => {
    it("should return refresh frequency in seconds", () => {
      const frequency = service.getRefreshFrequency();

      expect(frequency).toBe(600);
      expect(typeof frequency).toBe("number");
    });

    it("should return consistent value", () => {
      const freq1 = service.getRefreshFrequency();
      const freq2 = service.getRefreshFrequency();

      expect(freq1).toBe(freq2);
    });
  });

  describe("onRefreshComplete", () => {
    it("should register complete callback", async () => {
      const callback = jest.fn();
      service.onRefreshComplete(callback);

      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await service.refresh();

      expect(callback).toHaveBeenCalledWith(mockProperties);
    });

    it("should allow multiple complete callbacks", async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onRefreshComplete(callback1);
      service.onRefreshComplete(callback2);

      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await service.refresh();

      expect(callback1).toHaveBeenCalledWith(mockProperties);
      expect(callback2).toHaveBeenCalledWith(mockProperties);
    });

    it("should unsubscribe callback", async () => {
      const callback = jest.fn();
      const unsubscribe = service.onRefreshComplete(callback);

      unsubscribe();

      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await service.refresh();

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle callback errors gracefully", async () => {
      const badCallback = jest.fn().mockImplementation(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      service.onRefreshComplete(badCallback);
      service.onRefreshComplete(goodCallback);

      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await service.refresh();

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in refresh complete callback")
      );
    });
  });

  describe("onRefreshError", () => {
    it("should register error callback", async () => {
      const callback = jest.fn();
      service.onRefreshError(callback);

      const error = new Error("API error");
      mockDeviceAPI.getProperties.mockRejectedValue(error);

      await service.refresh();

      expect(callback).toHaveBeenCalledWith(error);
    });

    it("should allow multiple error callbacks", async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onRefreshError(callback1);
      service.onRefreshError(callback2);

      const error = new Error("API error");
      mockDeviceAPI.getProperties.mockRejectedValue(error);

      await service.refresh();

      expect(callback1).toHaveBeenCalledWith(error);
      expect(callback2).toHaveBeenCalledWith(error);
    });

    it("should unsubscribe callback", async () => {
      const callback = jest.fn();
      const unsubscribe = service.onRefreshError(callback);

      unsubscribe();

      const error = new Error("API error");
      mockDeviceAPI.getProperties.mockRejectedValue(error);

      await service.refresh();

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle callback errors gracefully", async () => {
      const badCallback = jest.fn().mockImplementation(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      service.onRefreshError(badCallback);
      service.onRefreshError(goodCallback);

      const error = new Error("API error");
      mockDeviceAPI.getProperties.mockRejectedValue(error);

      await service.refresh();

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in refresh error callback")
      );
    });
  });

  describe("dispose", () => {
    it("should clear all callbacks", async () => {
      const successCallback = jest.fn();
      const errorCallback = jest.fn();

      service.onRefreshComplete(successCallback);
      service.onRefreshError(errorCallback);

      service.dispose();

      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await service.refresh();

      expect(successCallback).not.toHaveBeenCalled();
      expect(errorCallback).not.toHaveBeenCalled();
    });

    it("should handle multiple dispose calls", () => {
      expect(() => {
        service.dispose();
        service.dispose();
      }).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle rapid successive refresh calls", async () => {
      const callback = jest.fn();
      service.onRefreshComplete(callback);

      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValue({
        properties: mockProperties,
      });

      await Promise.all([
        service.refresh(),
        service.refresh(),
        service.refresh(),
      ]);

      expect(callback).toHaveBeenCalledTimes(3);
      expect(mockDeviceAPI.getProperties).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed success and error scenarios", async () => {
      const successCallback = jest.fn();
      const errorCallback = jest.fn();

      service.onRefreshComplete(successCallback);
      service.onRefreshError(errorCallback);

      // First refresh succeeds
      const mockProperties: DeviceProperties = {
        battery: 80,
      } as DeviceProperties;
      mockDeviceAPI.getProperties.mockResolvedValueOnce({
        properties: mockProperties,
      });

      await service.refresh();

      expect(successCallback).toHaveBeenCalledWith(mockProperties);
      expect(errorCallback).not.toHaveBeenCalled();

      successCallback.mockClear();
      errorCallback.mockClear();

      // Second refresh fails
      const error = new Error("Network error");
      mockDeviceAPI.getProperties.mockRejectedValueOnce(error);

      await service.refresh();

      expect(successCallback).not.toHaveBeenCalled();
      expect(errorCallback).toHaveBeenCalledWith(error);
    });
  });
});
