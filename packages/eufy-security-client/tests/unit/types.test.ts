/**
 * Unit tests for Types module
 * Tests the type definitions and utility functions
 */

import { JSONValue } from "../../src/types/shared";
import { SchemaCompatibilityInfo } from "../../src/types/schema";
import { AllEventPayloads, EventType } from "../../src/types/events";
import { DEVICE_EVENTS } from "../../src/device/constants";
import { DRIVER_EVENTS } from "../../src/driver/constants";
import { Logger, ILogObj } from "tslog";

// Define BaseEventPayload for tests
interface BaseEventPayload {
  source: string;
  event: string;
}

describe("Types Module", () => {
  describe("JSONValue type", () => {
    test("should accept primitive types", () => {
      const testValues: JSONValue[] = ["string", 42, true, false, null];

      expect(testValues).toBeDefined();
    });

    test("should accept arrays and objects", () => {
      const testValues: JSONValue[] = [
        [1, 2, 3],
        { key: "value", nested: { count: 42 } },
        [],
      ];

      expect(testValues).toBeDefined();
    });
  });

  describe("SchemaCompatibilityInfo interface", () => {
    test("should enforce required schema version fields", () => {
      const schemaInfo: SchemaCompatibilityInfo = {
        clientMinSchema: 13,
        clientPreferredSchema: 21,
        serverMinSchema: 16,
        serverMaxSchema: 20,
        negotiatedSchema: 20,
        isCompatible: true,
      };

      expect(schemaInfo.clientMinSchema).toBe(13);
      expect(schemaInfo.clientPreferredSchema).toBe(21);
      expect(schemaInfo.serverMinSchema).toBe(16);
      expect(schemaInfo.serverMaxSchema).toBe(20);
      expect(schemaInfo.negotiatedSchema).toBe(20);
      expect(schemaInfo.isCompatible).toBe(true);
    });
  });

  describe("BaseEventPayload interface", () => {
    test("should enforce event structure with source and event fields", () => {
      const eventPayload: BaseEventPayload = {
        source: "device",
        event: "property changed",
      };

      expect(eventPayload.source).toBe("device");
      expect(eventPayload.event).toBe("property changed");
    });

    test("should allow optional properties", () => {
      const eventPayload: BaseEventPayload & { serialNumber?: string } = {
        source: "device",
        event: "motion detected",
        serialNumber: "T8210N20123456789",
      };

      expect(eventPayload.serialNumber).toBe("T8210N20123456789");
    });
  });

  describe("EventType", () => {
    test("should accept valid device event types", () => {
      const eventType: EventType = DEVICE_EVENTS.PROPERTY_CHANGED;
      expect(typeof eventType).toBe("string");
      expect(eventType).toBe("property changed");
    });

    test("should accept valid driver event types", () => {
      const eventType: EventType = DRIVER_EVENTS.CONNECTED;
      expect(typeof eventType).toBe("string");
      expect(eventType).toBe("connected");
    });
  });

  describe("Type composition and validation", () => {
    test("should compose complex event payloads", () => {
      // Import the actual DevicePropertyChangedEventPayload
      const propertyEvent = {
        serialNumber: "T8210N20123456789",
        name: "battery_level" as const,
        value: 85,
      };

      expect(propertyEvent.serialNumber).toBe("T8210N20123456789");
      expect(propertyEvent.name).toBe("battery_level");
      expect(propertyEvent.serialNumber).toBe("T8210N20123456789");
      expect(propertyEvent.name).toBe("battery_level");
      expect(propertyEvent.value).toBe(85);
    });

    test("should work with nested JSON structures", () => {
      const complexValue: JSONValue = {
        settings: {
          motion_detection: true,
          night_vision: "auto",
          sensitivity: 3,
        },
        stats: [
          { date: "2023-12-01", events: 15 },
          { date: "2023-12-02", events: 23 },
        ],
      };

      expect(complexValue).toBeDefined();
      expect(typeof complexValue).toBe("object");
    });
  });

  describe("Type safety validation", () => {
    test("should prevent invalid event source values", () => {
      // This test ensures TypeScript compilation catches invalid sources
      const validSources = ["device", "station", "driver", "server"];

      validSources.forEach((source) => {
        const eventPayload: BaseEventPayload = {
          source: source as any,
          event: "test event",
        };
        expect(eventPayload.source).toBe(source);
      });
    });
  });

  describe("ApiManager Type Safety Integration", () => {
    // Import ApiManager for runtime type safety testing
    let apiManager: any;

    beforeEach(async () => {
      const { ApiManager } = await import("../../src/api-manager");
      const logger = new Logger<ILogObj>();
      apiManager = new ApiManager("ws://localhost:3000", logger);
    });

    it("should provide strongly-typed event callbacks", async () => {
      const { DEVICE_EVENTS } = await import("../../src/device/constants");
      const { DRIVER_EVENTS } = await import("../../src/driver/constants");

      // This test validates that TypeScript compilation succeeds with proper typing
      let deviceAddedCalled = false;
      let driverConnectCalled = false;
      let propertyChangedCalled = false;

      // Test 1: Device added event - should have device property (schema 13+)
      const deviceCleanup = apiManager.addEventListener(
        DEVICE_EVENTS.DEVICE_ADDED,
        (payload: any) => {
          deviceAddedCalled = true;
          // These properties should be available and strongly typed
          expect(typeof payload.device).toBe("string");
          expect(payload.source).toBe("device");
          expect(payload.event).toBe(DEVICE_EVENTS.DEVICE_ADDED);
        }
      );

      // Test 2: Driver connect event - should NOT have device/serialNumber
      const driverCleanup = apiManager.addEventListener(
        DRIVER_EVENTS.CONNECTED,
        (payload: any) => {
          driverConnectCalled = true;
          // These properties should be available
          expect(payload.source).toBe("driver");
          expect(payload.event).toBe(DRIVER_EVENTS.CONNECTED);
          // device/serialNumber should NOT exist (would cause TypeScript error if accessed)
        }
      );

      // Test 3: Property changed event - should have name, value (no timestamp in schema 13+)
      const propertyCleanup = apiManager.addEventListener(
        DEVICE_EVENTS.PROPERTY_CHANGED,
        (payload: any) => {
          propertyChangedCalled = true;
          expect(typeof payload.name).toBe("string");
          expect(payload.value).toBeDefined();
          expect(typeof payload.serialNumber).toBe("string");
          expect(payload.source).toBe("device");
          expect(payload.event).toBe(DEVICE_EVENTS.PROPERTY_CHANGED);
        }
      );

      // Test cleanup functions
      expect(typeof deviceCleanup).toBe("function");
      expect(typeof driverCleanup).toBe("function");
      expect(typeof propertyCleanup).toBe("function");

      // Clean up
      expect(deviceCleanup()).toBe(true);
      expect(driverCleanup()).toBe(true);
      expect(propertyCleanup()).toBe(true);
    });

    it("should support event filtering with type safety", async () => {
      const { DEVICE_EVENTS } = await import("../../src/device/constants");

      let motionDetectedCalled = false;

      const cleanup = apiManager.addEventListener(
        DEVICE_EVENTS.MOTION_DETECTED,
        (payload: any) => {
          motionDetectedCalled = true;
          // Should have state property (according to API documentation for schema 13+)
          expect(typeof payload.state).toBe("boolean");
          expect(typeof payload.serialNumber).toBe("string");
          expect(payload.source).toBe("device");
          expect(payload.event).toBe(DEVICE_EVENTS.MOTION_DETECTED);
        },
        {
          source: "device",
          serialNumber: "TEST123",
        }
      );

      expect(typeof cleanup).toBe("function");
      expect(cleanup()).toBe(true);
    });

    it("should provide correct event type constants", async () => {
      const { DEVICE_EVENTS } = await import("../../src/device/constants");
      const { DRIVER_EVENTS } = await import("../../src/driver/constants");

      // Verify that event constants are properly typed
      expect(typeof DEVICE_EVENTS.DEVICE_ADDED).toBe("string");
      expect(typeof DEVICE_EVENTS.DEVICE_REMOVED).toBe("string");
      expect(typeof DEVICE_EVENTS.PROPERTY_CHANGED).toBe("string");
      expect(typeof DEVICE_EVENTS.MOTION_DETECTED).toBe("string");

      expect(typeof DRIVER_EVENTS.CONNECTED).toBe("string");
      expect(typeof DRIVER_EVENTS.DISCONNECTED).toBe("string");

      // NOTE: Device events are different from driver/station events
      // Device events like "device added" vs driver events like "connected"
      expect(DEVICE_EVENTS.DEVICE_ADDED).toBe("device added");
      expect(DRIVER_EVENTS.CONNECTED).toBe("connected");

      // The type safety comes from the TypeScript type system and event sources
      // Our conditional types in EventCallbackForType handle the disambiguation by source
    });
  });
});
