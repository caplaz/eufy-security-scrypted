/**
 * Device Property Service Tests
 */

import { DevicePropertyService } from "../../../src/services/device/device-property-service";
import {
  EufyWebSocketClient,
  DeviceProperties,
} from "@caplaz/eufy-security-client";
import { Logger, ILogObj } from "tslog";

describe("DevicePropertyService", () => {
  let service: DevicePropertyService;
  let mockWsClient: jest.Mocked<EufyWebSocketClient>;
  let mockLogger: jest.Mocked<Logger<ILogObj>>;
  let mockEventListeners: Map<string, Function>;

  const serialNumber = "TEST-DEVICE-123";
  const mockProperties: DeviceProperties = {
    name: "Test Camera",
    model: "T8600",
    serialNumber: "TEST-DEVICE-123",
    stationSerialNumber: "TEST-STATION-123",
    type: 1,
    enabled: true,
  } as DeviceProperties;

  beforeEach(() => {
    mockEventListeners = new Map();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      silly: jest.fn(),
      trace: jest.fn(),
    } as any;

    const mockApi = {
      getProperties: jest
        .fn()
        .mockResolvedValue({ properties: mockProperties }),
      setProperty: jest.fn().mockResolvedValue({}),
    };

    mockWsClient = {
      commands: {
        device: jest.fn().mockReturnValue(mockApi),
      },
      addEventListener: jest.fn((event, callback, options) => {
        mockEventListeners.set(`${event}-${options?.serialNumber}`, callback);
        return () =>
          mockEventListeners.delete(`${event}-${options?.serialNumber}`);
      }),
    } as any;

    service = new DevicePropertyService(mockWsClient, serialNumber, mockLogger);
  });

  afterEach(() => {
    service.dispose();
  });

  describe("initialization", () => {
    it("should load initial properties on creation", async () => {
      const properties = await service.waitForProperties();

      expect(properties).toEqual(mockProperties);
      expect(mockWsClient.commands.device).toHaveBeenCalledWith(serialNumber);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Loading initial properties for device ${serialNumber}`
      );
    });

    it("should set up property change listener", () => {
      expect(mockWsClient.addEventListener).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({ serialNumber })
      );
    });
  });

  describe("getProperties", () => {
    it("should return undefined before properties are loaded", () => {
      const newService = new DevicePropertyService(
        mockWsClient,
        serialNumber,
        mockLogger
      );

      expect(newService.getProperties()).toBeUndefined();

      newService.dispose();
    });

    it("should return properties after loading", async () => {
      await service.waitForProperties();

      expect(service.getProperties()).toEqual(mockProperties);
    });
  });

  describe("refreshProperties", () => {
    it("should refresh properties from server", async () => {
      const updatedProperties = { ...mockProperties, name: "Updated Camera" };
      const mockApi = mockWsClient.commands.device(serialNumber);
      (mockApi.getProperties as jest.Mock).mockResolvedValueOnce({
        properties: updatedProperties,
      });

      const result = await service.refreshProperties();

      expect(result).toEqual(updatedProperties);
      expect(service.getProperties()).toEqual(updatedProperties);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Refreshing device properties"
      );
    });
  });

  describe("updateProperty", () => {
    beforeEach(async () => {
      await service.waitForProperties();
    });

    it("should update a property via API", async () => {
      const mockApi = mockWsClient.commands.device(serialNumber);

      await service.updateProperty("enabled", false);

      expect(mockApi.setProperty).toHaveBeenCalledWith("enabled", false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Updating property enabled to false"
      );
    });

    it("should update local cache after API call", async () => {
      await service.updateProperty("enabled", false);

      const properties = service.getProperties();
      expect(properties?.enabled).toBe(false);
    });
  });

  describe("property change events", () => {
    beforeEach(async () => {
      await service.waitForProperties();
    });

    it("should handle property change events", async () => {
      const callback = jest.fn();
      service.onPropertyChange(callback);

      // Simulate property change event
      const eventCallback = mockEventListeners.get(
        "property changed-TEST-DEVICE-123"
      );
      eventCallback?.({
        name: "enabled",
        value: false,
      });

      expect(callback).toHaveBeenCalledWith({
        name: "enabled",
        value: false,
      });
    });

    it("should update local cache on property change event", async () => {
      const eventCallback = mockEventListeners.get(
        "property changed-TEST-DEVICE-123"
      );
      eventCallback?.({
        name: "enabled",
        value: false,
      });

      const properties = service.getProperties();
      expect(properties?.enabled).toBe(false);
    });

    it("should support multiple callbacks", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onPropertyChange(callback1);
      service.onPropertyChange(callback2);

      const eventCallback = mockEventListeners.get(
        "property changed-TEST-DEVICE-123"
      );
      eventCallback?.({
        name: "enabled",
        value: false,
      });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it("should handle callback errors gracefully", () => {
      const badCallback = jest.fn().mockImplementation(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();

      service.onPropertyChange(badCallback);
      service.onPropertyChange(goodCallback);

      const eventCallback = mockEventListeners.get(
        "property changed-TEST-DEVICE-123"
      );
      eventCallback?.({
        name: "enabled",
        value: false,
      });

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in property change callback")
      );
    });

    it("should unsubscribe callback", () => {
      const callback = jest.fn();
      const unsubscribe = service.onPropertyChange(callback);

      unsubscribe();

      const eventCallback = mockEventListeners.get(
        "propertyChanged-TEST-DEVICE-123"
      );
      eventCallback?.({
        name: "enabled",
        value: false,
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getProperty", () => {
    beforeEach(async () => {
      await service.waitForProperties();
    });

    it("should get a specific property", () => {
      const name = service.getProperty("name");
      expect(name).toBe("Test Camera");
    });

    it("should return undefined for non-existent property", () => {
      const value = service.getProperty("nonExistent" as any);
      expect(value).toBeUndefined();
    });

    it("should return undefined if properties not loaded", () => {
      const newService = new DevicePropertyService(
        mockWsClient,
        serialNumber,
        mockLogger
      );

      expect(newService.getProperty("name")).toBeUndefined();

      newService.dispose();
    });
  });

  describe("hasProperty", () => {
    beforeEach(async () => {
      await service.waitForProperties();
    });

    it("should return true for existing property", () => {
      expect(service.hasProperty("name")).toBe(true);
    });

    it("should return false for non-existent property", () => {
      expect(service.hasProperty("nonExistent" as any)).toBe(false);
    });

    it("should return false if properties not loaded", () => {
      const newService = new DevicePropertyService(
        mockWsClient,
        serialNumber,
        mockLogger
      );

      expect(newService.hasProperty("name")).toBe(false);

      newService.dispose();
    });
  });

  describe("dispose", () => {
    it("should remove event listener", () => {
      const removeListenerSpy = jest.fn();
      mockWsClient.addEventListener = jest
        .fn()
        .mockReturnValue(removeListenerSpy);

      const newService = new DevicePropertyService(
        mockWsClient,
        serialNumber,
        mockLogger
      );

      newService.dispose();

      expect(removeListenerSpy).toHaveBeenCalled();
    });

    it("should clear all callbacks", () => {
      const callback = jest.fn();
      service.onPropertyChange(callback);

      service.dispose();

      // Callbacks should be cleared, so this should not call the callback
      const eventCallback = mockEventListeners.get(
        "propertyChanged-TEST-DEVICE-123"
      );
      eventCallback?.({
        name: "enabled",
        value: false,
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle multiple dispose calls", () => {
      expect(() => {
        service.dispose();
        service.dispose();
      }).not.toThrow();
    });
  });
});
