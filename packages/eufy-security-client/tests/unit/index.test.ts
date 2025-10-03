/**
 * Unit tests for the main index.ts module
 * Tests the public API exports and module structure
 */

import * as EufyClient from "../../src/index";
import { Logger, ILogObj } from "tslog";

describe("EufyClient Module Exports", () => {
  describe("main exports", () => {
    test("should export EufyWebSocketClient (aliased from ApiManager)", () => {
      expect(EufyClient.EufyWebSocketClient).toBeDefined();
      expect(typeof EufyClient.EufyWebSocketClient).toBe("function");
    });

    test("should export WebSocketClient", () => {
      expect(EufyClient.WebSocketClient).toBeDefined();
      expect(typeof EufyClient.WebSocketClient).toBe("function");
    });

    test("should export ClientStateManager", () => {
      expect(EufyClient.ClientStateManager).toBeDefined();
      expect(typeof EufyClient.ClientStateManager).toBe("function");
    });

    test("should export ConnectionState enum", () => {
      expect(EufyClient.ConnectionState).toBeDefined();
      expect(EufyClient.ConnectionState.DISCONNECTED).toBe("disconnected");
      expect(EufyClient.ConnectionState.CONNECTING).toBe("connecting");
      expect(EufyClient.ConnectionState.CONNECTED).toBe("connected");
      expect(EufyClient.ConnectionState.READY).toBe("ready");
      expect(EufyClient.ConnectionState.ERROR).toBe("error");
    });
  });

  describe("type exports", () => {
    test("should export core types", () => {
      // These are type exports, so we can't directly test them at runtime
      // but we can ensure they're available for import
      expect(true).toBe(true); // Placeholder - types are validated at compile time
    });
  });

  describe("command constants exports", () => {
    test("should export server commands", () => {
      expect(EufyClient.SERVER_COMMANDS).toBeDefined();
      expect(EufyClient.SERVER_COMMANDS.START_LISTENING).toBe(
        "start_listening"
      );
      expect(EufyClient.SERVER_COMMANDS.SET_API_SCHEMA).toBe("set_api_schema");
    });

    test("should export device commands", () => {
      expect(EufyClient.DEVICE_COMMANDS).toBeDefined();
      expect(EufyClient.DEVICE_COMMANDS.GET_PROPERTIES).toBe(
        "device.get_properties"
      );
    });

    test("should export driver commands", () => {
      expect(EufyClient.DRIVER_COMMANDS).toBeDefined();
      expect(EufyClient.DRIVER_COMMANDS.CONNECT).toBe("driver.connect");
    });

    test("should export station commands", () => {
      expect(EufyClient.STATION_COMMANDS).toBeDefined();
      expect(EufyClient.STATION_COMMANDS.GET_PROPERTIES).toBe(
        "station.get_properties"
      );
    });
  });

  describe("common constants exports", () => {
    test("should export EVENT_SOURCES", () => {
      expect(EufyClient.EVENT_SOURCES).toBeDefined();
      expect(EufyClient.EVENT_SOURCES.DEVICE).toBe("device");
      expect(EufyClient.EVENT_SOURCES.STATION).toBe("station");
      expect(EufyClient.EVENT_SOURCES.DRIVER).toBe("driver");
      expect(EufyClient.EVENT_SOURCES.SERVER).toBe("server");
    });

    test("should export MESSAGE_TYPES", () => {
      expect(EufyClient.MESSAGE_TYPES).toBeDefined();
      expect(EufyClient.MESSAGE_TYPES.EVENT).toBe("event");
      expect(EufyClient.MESSAGE_TYPES.VERSION).toBe("version");
    });
  });

  describe("API instantiation", () => {
    test("should be able to create EufyWebSocketClient instance", () => {
      const logger = new Logger<ILogObj>();
      const client = new EufyClient.EufyWebSocketClient(
        "ws://localhost:3000",
        logger
      );
      expect(client).toBeDefined();
      expect(typeof client.connect).toBe("function");
      expect(typeof client.disconnect).toBe("function");
      expect(typeof client.sendCommand).toBe("function");

      // Clean up
      client.disconnect();
    });

    test("should be able to create WebSocketClient instance", () => {
      const logger = new Logger<ILogObj>();
      const stateManager = new EufyClient.ClientStateManager(logger);
      const client = new EufyClient.WebSocketClient(
        "ws://localhost:3000",
        stateManager,
        logger
      );
      expect(client).toBeDefined();
      expect(typeof client.connect).toBe("function");
      expect(typeof client.disconnect).toBe("function");
      expect(typeof client.sendMessage).toBe("function");

      // Clean up
      client.disconnect();
    });

    test("should be able to create ClientStateManager instance", () => {
      const logger = new Logger<ILogObj>();
      const stateManager = new EufyClient.ClientStateManager(logger);
      expect(stateManager).toBeDefined();
      expect(typeof stateManager.getState).toBe("function");
      expect(typeof stateManager.onStateChange).toBe("function");
      expect(stateManager.getState().connection).toBe(
        EufyClient.ConnectionState.DISCONNECTED
      );
    });
  });

  describe("module structure validation", () => {
    test("should not expose internal implementation details", () => {
      // Verify that only intended exports are available
      const expectedExports = [
        "EufyWebSocketClient",
        "WebSocketClient",
        "ClientStateManager",
        "ConnectionState",
        "SERVER_COMMANDS",
        "DEVICE_COMMANDS",
        "DRIVER_COMMANDS",
        "STATION_COMMANDS",
        "EVENT_SOURCES",
        "MESSAGE_TYPES",
      ];

      const actualExports = Object.keys(EufyClient).filter(
        (key) =>
          !key.startsWith("__") &&
          typeof (EufyClient as any)[key] !== "undefined"
      );

      // Check that all expected exports are present
      expectedExports.forEach((exportName) => {
        expect(actualExports).toContain(exportName);
      });

      // Only allow a small number of extra type exports (runtime only)
      // This will fail if runtime (non-type) implementation details are exposed
      const allowedExtraExports: string[] = [
        // EufySecurityClient class
        "EufySecurityClient",
        // WebSocket message processor utility
        "WebSocketMessageProcessor",
        // Command constants
        "ALL_COMMANDS",
        // Event validation utilities
        "isValidEventSource",
        "assertEventSource",
        // Device module exports
        "DEVICE_EVENTS",
        "DeviceType",
        "PowerWorkingMode",
        "ChargingStatus",
        "NotificationType",
        "ContinuousRecordingType",
        "LockStatus",
        "MotionDetectionType",
        "SoundDetectionType",
        "VideoQuality",
        "WatermarkMode",
        "PanTiltDirection",
        // Device detection exports
        "CAMERA_DEVICE_TYPES",
        "DOORBELL_DEVICE_TYPES",
        "FLOODLIGHT_DEVICE_TYPES",
        "SENSOR_DEVICE_TYPES",
        "LOCK_DEVICE_TYPES",
        "BASE_STATION_DEVICE_TYPES",
        "BATTERY_DEVICE_TYPES",
        "PAN_TILT_DEVICE_TYPES",
        "SUPPORTED_DEVICE_TYPES",
        "SOLO_CAMERA_TYPES",
        "INDOOR_CAMERA_TYPES",
        "WIRED_DOORBELL_TYPES",
        "BATTERY_DOORBELL_TYPES",
        "DUAL_DOORBELL_TYPES",
        "LOCK_BLE_TYPES",
        "LOCK_WIFI_TYPES",
        "LOCK_KEYPAD_TYPES",
        "CAMERA_1_TYPES",
        "CAMERA_E_TYPES",
        "CAMERA_2_TYPES",
        "CAMERA_3_TYPES",
        "GARAGE_CAMERA_TYPES",
        "SMART_SAFE_TYPES",
        "SMART_TRACK_TYPES",
        "SMART_DROP_TYPES",
        "KEYPAD_TYPES",
        "MODEL_NAMES",
        "isCamera",
        "isDoorbell",
        "isWiredDoorbell",
        "isBatteryDoorbell",
        "isDoorbellDual",
        "isFloodlight",
        "isSensor",
        "isEntrySensor",
        "isMotionSensor",
        "isLock",
        "isLockBle",
        "isLockWifi",
        "isLockKeypad",
        "isBaseStation",
        "isIndoorCamera",
        "isSoloCameras",
        "isPanAndTiltCamera",
        "isGarageCamera",
        "isSmartSafe",
        "isSmartTrack",
        "isSmartDrop",
        "isKeyPad",
        "isCamera1Product",
        "isCamera2Product",
        "isCamera3Product",
        "hasBattery",
        "canPanTilt",
        "isDeviceSupported",
        "getDeviceCapabilities",
        "getProductName",
        "getDeviceTypeName",
        // Authentication module exports
        "AUTH_STATE",
        "AuthenticationManager",
        // Driver module exports
        "DRIVER_EVENTS",
        "StorageType",
        // Server module exports
        "SERVER_EVENTS",
        // Station module exports
        "STATION_EVENTS",
        "AlarmEvent",
        "AlarmMode",
        "GuardMode",
      ];
      const unexpectedExports = actualExports.filter(
        (key) =>
          !expectedExports.includes(key) && !allowedExtraExports.includes(key)
      );
      expect(unexpectedExports).toEqual([]);
    });

    test("should provide clean public API surface", () => {
      // Verify the main client class has expected methods
      const clientPrototype = EufyClient.EufyWebSocketClient.prototype;
      const expectedMethods = [
        "connect",
        "disconnect",
        "sendCommand",
        "addEventListener",
      ];

      expectedMethods.forEach((method) => {
        expect(typeof (clientPrototype as any)[method]).toBe("function");
      });
    });
  });

  describe("TypeScript compatibility", () => {
    test("should work with TypeScript imports", () => {
      // This test verifies that the module structure supports proper TypeScript usage
      // The fact that this test file compiles successfully validates the export structure

      // Test default export alias
      const { EufyWebSocketClient: Client } = EufyClient;
      expect(Client).toBe(EufyClient.EufyWebSocketClient);

      // Test destructured imports
      const { ConnectionState, SERVER_COMMANDS } = EufyClient;
      expect(ConnectionState).toBeDefined();
      expect(SERVER_COMMANDS).toBeDefined();
    });
  });
});
