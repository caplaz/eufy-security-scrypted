/**
 * Schema 21 Compliance Tests
 *
 * These tests ensure strict compatibility with eufy-security-ws schema version 21
 * and validate that only documented commands are available and that undocumented
 * commands have been properly removed.
 */

import {
  DEVICE_COMMANDS,
  DRIVER_COMMANDS,
  SERVER_COMMANDS,
  STATION_COMMANDS,
} from "../../src";

describe("Schema 21 Compliance Tests", () => {
  describe("Undocumented Command Removal Validation", () => {
    test("should NOT include undocumented preset position commands", () => {
      const allDeviceCommands = Object.values(DEVICE_COMMANDS);

      // These were removed as they're not in the official schema 21 docs
      expect(allDeviceCommands).not.toContain("device.preset_position");
      expect(allDeviceCommands).not.toContain("device.save_preset_position");
      expect(allDeviceCommands).not.toContain("device.delete_preset_position");
    });

    test("device commands should only contain documented ones", () => {
      const allDeviceCommands = Object.values(DEVICE_COMMANDS);

      // Should contain documented commands
      expect(allDeviceCommands).toContain("device.get_properties");
      expect(allDeviceCommands).toContain("device.set_property");
      expect(allDeviceCommands).toContain("device.start_livestream");
      expect(allDeviceCommands).toContain("device.stop_livestream");
      expect(allDeviceCommands).toContain("device.start_rtsp_livestream");
      expect(allDeviceCommands).toContain("device.stop_rtsp_livestream");
      expect(allDeviceCommands).toContain("device.start_download");
      expect(allDeviceCommands).toContain("device.cancel_download");
      expect(allDeviceCommands).toContain("device.trigger_alarm");
      expect(allDeviceCommands).toContain("device.reset_alarm");
      expect(allDeviceCommands).toContain("device.pan_and_tilt");
      expect(allDeviceCommands).toContain("device.calibrate");
      expect(allDeviceCommands).toContain("device.quick_response");

      // Should NOT contain undocumented preset commands
      expect(allDeviceCommands).not.toContain("device.preset_position");
      expect(allDeviceCommands).not.toContain("device.save_preset_position");
      expect(allDeviceCommands).not.toContain("device.delete_preset_position");
    });

    test("station commands should contain documented ones", () => {
      const allStationCommands = Object.values(STATION_COMMANDS);

      // Should contain documented commands
      expect(allStationCommands).toContain("station.get_properties");
      expect(allStationCommands).toContain("station.set_property");
      expect(allStationCommands).toContain("station.trigger_alarm");
      expect(allStationCommands).toContain("station.reset_alarm");
      expect(allStationCommands).toContain("station.set_guard_mode");
      expect(allStationCommands).toContain("station.reboot");
    });

    test("driver commands should contain documented ones", () => {
      const allDriverCommands = Object.values(DRIVER_COMMANDS);

      // Should contain documented commands
      expect(allDriverCommands).toContain("driver.connect");
      expect(allDriverCommands).toContain("driver.disconnect");
      expect(allDriverCommands).toContain("driver.poll_refresh");
    });

    test("server commands should contain documented ones", () => {
      const allServerCommands = Object.values(SERVER_COMMANDS);

      // Should contain documented commands
      expect(allServerCommands).toContain("start_listening");
      expect(allServerCommands).toContain("set_api_schema");
    });
  });

  describe("Command Structure Validation", () => {
    test("should maintain consistent naming patterns", () => {
      // All device commands should start with "device."
      Object.values(DEVICE_COMMANDS).forEach((cmd) => {
        expect(cmd).toMatch(/^device\./);
      });

      // All station commands should start with "station."
      Object.values(STATION_COMMANDS).forEach((cmd) => {
        expect(cmd).toMatch(/^station\./);
      });

      // All driver commands should start with "driver."
      Object.values(DRIVER_COMMANDS).forEach((cmd) => {
        expect(cmd).toMatch(/^driver\./);
      });

      // Server commands should not have a prefix (legacy pattern)
      Object.values(SERVER_COMMANDS).forEach((cmd) => {
        expect(cmd).not.toMatch(/^(device|station|driver|server)\./);
      });
    });

    test("should use snake_case for all commands", () => {
      const allCommands = [
        ...Object.values(DEVICE_COMMANDS),
        ...Object.values(STATION_COMMANDS),
        ...Object.values(DRIVER_COMMANDS),
        ...Object.values(SERVER_COMMANDS),
      ];

      allCommands.forEach((cmd) => {
        // Should be snake_case (or dot notation for commands)
        expect(cmd).toMatch(/^[a-z][a-z0-9_.]*$/);
        // Should not contain camelCase
        expect(cmd).not.toMatch(/[A-Z]/);
      });
    });

    test("should not expose any internal or undocumented functionality", () => {
      // Verify that common undocumented commands are not present
      const allDeviceCommands = Object.values(DEVICE_COMMANDS);

      // These are commonly seen in implementations but not documented in schema 21
      expect(allDeviceCommands).not.toContain("device.preset_position");
      expect(allDeviceCommands).not.toContain("device.save_preset_position");
      expect(allDeviceCommands).not.toContain("device.delete_preset_position");

      // Should not contain any test or debug commands
      expect(allDeviceCommands.some((cmd) => cmd.includes("test"))).toBe(false);
      expect(allDeviceCommands.some((cmd) => cmd.includes("debug"))).toBe(
        false
      );
    });
  });

  describe("Schema Version Compatibility", () => {
    test("should support only documented schema 21 commands", () => {
      // Core documented commands that should be present
      expect(DEVICE_COMMANDS.GET_PROPERTIES).toBe("device.get_properties");
      expect(DEVICE_COMMANDS.SET_PROPERTY).toBe("device.set_property");
      expect(DEVICE_COMMANDS.START_LIVESTREAM).toBe("device.start_livestream");
      expect(DEVICE_COMMANDS.STOP_LIVESTREAM).toBe("device.stop_livestream");
      expect(DEVICE_COMMANDS.START_RTSP_LIVESTREAM).toBe(
        "device.start_rtsp_livestream"
      );
      expect(DEVICE_COMMANDS.STOP_RTSP_LIVESTREAM).toBe(
        "device.stop_rtsp_livestream"
      );
      expect(DEVICE_COMMANDS.START_DOWNLOAD).toBe("device.start_download");
      expect(DEVICE_COMMANDS.CANCEL_DOWNLOAD).toBe("device.cancel_download");
      expect(DEVICE_COMMANDS.TRIGGER_ALARM).toBe("device.trigger_alarm");
      expect(DEVICE_COMMANDS.RESET_ALARM).toBe("device.reset_alarm");
      expect(DEVICE_COMMANDS.PAN_AND_TILT).toBe("device.pan_and_tilt");
      expect(DEVICE_COMMANDS.CALIBRATE).toBe("device.calibrate");
      expect(DEVICE_COMMANDS.QUICK_RESPONSE).toBe("device.quick_response");

      expect(STATION_COMMANDS.GET_PROPERTIES).toBe("station.get_properties");
      expect(STATION_COMMANDS.SET_PROPERTY).toBe("station.set_property");
      expect(STATION_COMMANDS.TRIGGER_ALARM).toBe("station.trigger_alarm");
      expect(STATION_COMMANDS.RESET_ALARM).toBe("station.reset_alarm");
      expect(STATION_COMMANDS.SET_GUARD_MODE).toBe("station.set_guard_mode");
      expect(STATION_COMMANDS.REBOOT).toBe("station.reboot");

      expect(DRIVER_COMMANDS.CONNECT).toBe("driver.connect");
      expect(DRIVER_COMMANDS.DISCONNECT).toBe("driver.disconnect");
      expect(DRIVER_COMMANDS.POLL_REFRESH).toBe("driver.poll_refresh");

      expect(SERVER_COMMANDS.START_LISTENING).toBe("start_listening");
      expect(SERVER_COMMANDS.SET_API_SCHEMA).toBe("set_api_schema");
    });

    test("should NOT have deprecated or removed commands", () => {
      // Explicitly check that removed commands are not present
      const deviceKeys = Object.keys(DEVICE_COMMANDS);
      expect(deviceKeys).not.toContain("PRESET_POSITION");
      expect(deviceKeys).not.toContain("SAVE_PRESET_POSITION");
      expect(deviceKeys).not.toContain("DELETE_PRESET_POSITION");
    });
  });

  describe("Backward Compatibility Safety", () => {
    test("should maintain stable public API surface", () => {
      // Ensure we're not accidentally exposing implementation details
      expect(typeof DEVICE_COMMANDS).toBe("object");
      expect(typeof STATION_COMMANDS).toBe("object");
      expect(typeof DRIVER_COMMANDS).toBe("object");
      expect(typeof SERVER_COMMANDS).toBe("object");

      // Should be consistent object structures
      expect(DEVICE_COMMANDS).toBeDefined();
      expect(Object.keys(DEVICE_COMMANDS).length).toBeGreaterThan(0);
    });

    test("should provide comprehensive command coverage", () => {
      // Verify we have reasonable coverage of documented commands
      expect(Object.keys(DEVICE_COMMANDS).length).toBeGreaterThan(20);
      expect(Object.keys(STATION_COMMANDS).length).toBeGreaterThan(10);
      expect(Object.keys(DRIVER_COMMANDS).length).toBeGreaterThan(3);
      expect(Object.keys(SERVER_COMMANDS).length).toBeGreaterThanOrEqual(2);
    });
  });
});
