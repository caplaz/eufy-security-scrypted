/**
 * Unit tests for EufyDevice motion state syncing.
 *
 * Covers the Custom Motion Sensor mixin override (#26): when the user
 * attaches Scrypted's "Custom Motion Sensor" extension to a camera, the
 * external sensor owns `motionDetected` and Eufy-reported motion must not
 * overwrite it.
 */

import { EufyDevice } from "../../src/eufy-device";
import { EufyWebSocketClient } from "@caplaz/eufy-security-client";

const getDeviceById = jest.fn();

jest.mock("@scrypted/sdk", () => {
  const mediaManager = {
    convertMediaObjectToJSON: jest.fn(),
    createFFmpegMediaObject: jest.fn(),
  };
  const systemManager = {
    getDeviceById: (id: string) => getDeviceById(id),
  };
  return {
    __esModule: true,
    ScryptedDeviceBase: class {
      info: any = { serialNumber: "TEST123" };
      mixins: string[] = [];
      motionDetected: boolean | undefined = undefined;
      onDeviceEvent = jest.fn();
      storage: any = {
        _m: new Map<string, string>(),
        getItem(k: string) {
          return this._m.has(k) ? this._m.get(k) : null;
        },
        setItem(k: string, v: string) {
          this._m.set(k, String(v));
        },
        removeItem(k: string) {
          this._m.delete(k);
        },
      };
      log: any = { a: jest.fn(), clearAlert: jest.fn() };
    },
    ScryptedInterface: {
      MotionSensor: "MotionSensor",
      Brightness: "Brightness",
      OnOff: "OnOff",
      Battery: "Battery",
      Charger: "Charger",
      Sensors: "Sensors",
      Settings: "Settings",
    },
    ScryptedMimeTypes: {
      FFmpegInput: "x-scrypted/x-ffmpeg-input",
    },
    SecuritySystemMode: {},
    ChargeState: {},
    deviceManager: {
      onDevicesChanged: jest.fn(),
    },
    systemManager,
    default: { mediaManager, systemManager },
    mediaManager,
  };
});

jest.mock("@caplaz/eufy-stream-server", () => ({
  StreamServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getPort: jest.fn().mockReturnValue(8080),
    getMuxedPort: jest.fn().mockReturnValue(undefined),
    getActiveConnectionCount: jest.fn().mockReturnValue(0),
    getVideoMetadata: jest.fn().mockReturnValue(null),
    getCachedKeyframe: jest.fn().mockReturnValue(null),
    setCachedKeyframe: jest.fn(),
    captureSnapshot: jest.fn(),
    isRunning: jest.fn().mockReturnValue(false),
    on: jest.fn(),
    off: jest.fn(),
    removeListener: jest.fn(),
  })),
}));

const makeLogger = (): any => {
  const sub: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    silly: jest.fn(),
    trace: jest.fn(),
    attachTransport: jest.fn(),
  };
  sub.getSubLogger = jest.fn().mockReturnValue(sub);
  return sub;
};

describe("EufyDevice motion state sync", () => {
  let device: EufyDevice;
  let mockWsClient: jest.Mocked<EufyWebSocketClient>;

  const syncMotion = (state: boolean) => {
    (device as any).stateReady = true;
    (device as any).stateService.updateProperty("motionDetected", state);
  };

  beforeEach(() => {
    getDeviceById.mockReset();

    const mockApi = {
      getProperties: jest.fn().mockResolvedValue({
        properties: { type: 1, name: "C", serialNumber: "TEST123" },
      }),
    };

    mockWsClient = {
      commands: { device: jest.fn().mockReturnValue(mockApi) },
      addEventListener: jest.fn().mockReturnValue(() => true),
      removeEventListenersBySerialNumber: jest.fn(),
    } as any;

    device = new EufyDevice("device_TEST123", mockWsClient, makeLogger());
  });

  afterEach(() => {
    device.dispose();
    jest.clearAllMocks();
  });

  test("syncs motionDetected when no mixins are attached", () => {
    syncMotion(true);
    expect(device.motionDetected).toBe(true);
  });

  test("does NOT sync motionDetected when a Custom Motion Sensor mixin is active", () => {
    (device as any).mixins = ["mixin-1"];
    getDeviceById.mockReturnValue({ name: "Custom Motion Sensor" });

    syncMotion(true);
    expect(device.motionDetected).toBeUndefined();
  });

  test("syncs motionDetected when only unrelated mixins are attached", () => {
    (device as any).mixins = ["mixin-1", "mixin-2"];
    getDeviceById.mockImplementation((id: string) =>
      id === "mixin-1" ? { name: "Rebroadcast" } : { name: "WebRTC" },
    );

    syncMotion(true);
    expect(device.motionDetected).toBe(true);
  });

  test("syncs motionDetected when a mixin device can no longer be resolved", () => {
    (device as any).mixins = ["gone"];
    getDeviceById.mockReturnValue(undefined);

    syncMotion(true);
    expect(device.motionDetected).toBe(true);
  });

  test("fails open if systemManager lookup throws", () => {
    (device as any).mixins = ["boom"];
    getDeviceById.mockImplementation(() => {
      throw new Error("system manager unavailable");
    });

    syncMotion(true);
    expect(device.motionDetected).toBe(true);
  });

  test("still syncs other state fields while motion is externally owned", () => {
    (device as any).mixins = ["mixin-1"];
    getDeviceById.mockReturnValue({ name: "Custom Motion Sensor" });

    (device as any).stateReady = true;
    (device as any).stateService.updateProperty("battery", 55);
    (device as any).stateService.updateProperty("motionDetected", true);

    expect(device.motionDetected).toBeUndefined();
    expect((device as any).batteryLevel).toBe(55);
  });
});
