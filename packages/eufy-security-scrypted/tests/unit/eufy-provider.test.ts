/**
 * Unit tests for EufySecurityProvider
 */

import { EufySecurityProvider } from "../../src/eufy-provider";
import { DeviceUtils } from "../../src/utils/device-utils";
import sdk from "@scrypted/sdk";
import { StartListeningResponse } from "@caplaz/eufy-security-client";

jest.mock("@scrypted/sdk", () => ({
  ScryptedDeviceBase: class {
    storage = { getItem: jest.fn().mockReturnValue(null), setItem: jest.fn() };
    console = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    nativeId = undefined;
  },
  ScryptedInterface: {
    Camera: "Camera",
    VideoCamera: "VideoCamera",
    MotionSensor: "MotionSensor",
    Settings: "Settings",
    Refresh: "Refresh",
    Battery: "Battery",
    Charger: "Charger",
    Sensors: "Sensors",
    OnOff: "OnOff",
    Brightness: "Brightness",
    PanTiltZoom: "PanTiltZoom",
    BinarySensor: "BinarySensor",
    SecuritySystem: "SecuritySystem",
  },
  SecuritySystemMode: {
    AwayArmed: "AwayArmed",
    HomeArmed: "HomeArmed",
    Disarmed: "Disarmed",
    NightArmed: "NightArmed",
  },
  ChargeState: {
    Charging: "Charging",
    NotCharging: "NotCharging",
  },
  default: {
    deviceManager: {
      onDevicesChanged: jest.fn(),
    },
    mediaManager: {
      createFFmpegMediaObject: jest.fn(),
    },
  },
  deviceManager: {
    onDevicesChanged: jest.fn(),
  },
}));

jest.mock("../../src/utils/device-utils", () => ({
  DeviceUtils: {
    createDeviceManifest: jest.fn(),
    createStationManifest: jest.fn(),
    genericDeviceInformation: jest.fn().mockReturnValue([]),
    allWriteableDeviceProperties: jest.fn().mockReturnValue([]),
  },
}));

jest.mock("@caplaz/eufy-security-client", () => {
  const actual = jest.requireActual("@caplaz/eufy-security-client");
  return {
    ...actual,
    EufyWebSocketClient: jest.fn().mockImplementation(() => ({
      isConnected: jest.fn().mockReturnValue(false),
      on: jest.fn(),
      off: jest.fn(),
    })),
    AuthenticationManager: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      off: jest.fn(),
    })),
  };
});

jest.mock("../../src/utils/memory-manager", () => ({
  MemoryManager: {
    setMemoryThreshold: jest.fn(),
  },
}));

describe("EufySecurityProvider.registerDevicesFromServerState", () => {
  let provider: EufySecurityProvider;
  let mockOnDevicesChanged: jest.Mock;
  let mockCreateDeviceManifest: jest.Mock;

  beforeEach(() => {
    mockOnDevicesChanged = (sdk.deviceManager.onDevicesChanged as jest.Mock);
    mockOnDevicesChanged.mockClear();

    mockCreateDeviceManifest = DeviceUtils.createDeviceManifest as jest.Mock;
    mockCreateDeviceManifest.mockClear();

    provider = new EufySecurityProvider("test-provider");
  });

  it("groups 3 devices across 2 stations into exactly 2 onDevicesChanged calls", async () => {
    // Two devices on station A, one device on station B
    const manifests = [
      { nativeId: "device_CAM001", providerNativeId: "station_STA001", name: "Cam 1" },
      { nativeId: "device_CAM002", providerNativeId: "station_STA001", name: "Cam 2" },
      { nativeId: "device_CAM003", providerNativeId: "station_STA002", name: "Cam 3" },
    ];

    mockCreateDeviceManifest
      .mockResolvedValueOnce(manifests[0])
      .mockResolvedValueOnce(manifests[1])
      .mockResolvedValueOnce(manifests[2]);

    const serverState = {
      state: {
        devices: ["CAM001", "CAM002", "CAM003"],
        stations: [],
      },
    } as unknown as StartListeningResponse;

    await (provider as any).registerDevicesFromServerState(serverState);

    expect(mockOnDevicesChanged).toHaveBeenCalledTimes(2);

    const calls = mockOnDevicesChanged.mock.calls;
    const callByStation = new Map(
      calls.map((c: any[]) => [c[0].providerNativeId, c[0].devices])
    );

    expect(callByStation.get("station_STA001")).toHaveLength(2);
    expect(callByStation.get("station_STA001")).toEqual(
      expect.arrayContaining([manifests[0], manifests[1]])
    );
    expect(callByStation.get("station_STA002")).toHaveLength(1);
    expect(callByStation.get("station_STA002")).toEqual([manifests[2]]);
  });

  it("makes a single onDevicesChanged call when all devices belong to one station", async () => {
    const manifests = [
      { nativeId: "device_CAM001", providerNativeId: "station_STA001", name: "Cam 1" },
      { nativeId: "device_CAM002", providerNativeId: "station_STA001", name: "Cam 2" },
    ];

    mockCreateDeviceManifest
      .mockResolvedValueOnce(manifests[0])
      .mockResolvedValueOnce(manifests[1]);

    const serverState = {
      state: { devices: ["CAM001", "CAM002"], stations: [] },
    } as unknown as StartListeningResponse;

    await (provider as any).registerDevicesFromServerState(serverState);

    expect(mockOnDevicesChanged).toHaveBeenCalledTimes(1);
    expect(mockOnDevicesChanged).toHaveBeenCalledWith({
      providerNativeId: "station_STA001",
      devices: manifests,
    });
  });

  it("does nothing when there are no devices", async () => {
    const serverState = {
      state: { devices: [], stations: [] },
    } as unknown as StartListeningResponse;

    await (provider as any).registerDevicesFromServerState(serverState);

    expect(mockOnDevicesChanged).not.toHaveBeenCalled();
    expect(mockCreateDeviceManifest).not.toHaveBeenCalled();
  });

  it("groups devices with undefined providerNativeId into their own onDevicesChanged call", async () => {
    const manifests = [
      { nativeId: "device_CAM001", providerNativeId: "station_STA001", name: "Cam 1" },
      { nativeId: "device_CAM002", providerNativeId: undefined, name: "Orphan Cam" },
    ];

    mockCreateDeviceManifest
      .mockResolvedValueOnce(manifests[0])
      .mockResolvedValueOnce(manifests[1]);

    const serverState = {
      state: { devices: ["CAM001", "CAM002"], stations: [] },
    } as unknown as StartListeningResponse;

    await (provider as any).registerDevicesFromServerState(serverState);

    expect(mockOnDevicesChanged).toHaveBeenCalledTimes(2);

    const calls = mockOnDevicesChanged.mock.calls;
    const stationCall = calls.find((c: any[]) => c[0].providerNativeId === "station_STA001");
    const undefinedCall = calls.find((c: any[]) => c[0].providerNativeId === undefined);

    expect(stationCall).toBeDefined();
    expect(stationCall![0].devices).toEqual([manifests[0]]);

    expect(undefinedCall).toBeDefined();
    expect(undefinedCall![0].devices).toEqual([manifests[1]]);
  });
});
