jest.unmock("../../src/utils/device-utils");

import { DeviceUtils } from "../../src/utils/device-utils";
import {
  getDeviceCapabilities,
  isDoorbell,
} from "@caplaz/eufy-security-client";

jest.mock("@scrypted/sdk", () => ({
  ScryptedInterface: {
    Camera: "Camera",
    VideoCamera: "VideoCamera",
    MotionSensor: "MotionSensor",
    Settings: "Settings",
    Refresh: "Refresh",
    Intercom: "Intercom",
    Battery: "Battery",
    Charger: "Charger",
    OnOff: "OnOff",
    Brightness: "Brightness",
    PanTiltZoom: "PanTiltZoom",
    BinarySensor: "BinarySensor",
    Sensors: "Sensors",
  },
  ScryptedDeviceType: {
    Camera: "Camera",
    Doorbell: "Doorbell",
    Sensor: "Sensor",
    Unknown: "Unknown",
  },
  SecuritySystemMode: {
    AwayArmed: "away",
    HomeArmed: "home",
    Disarmed: "disarmed",
    NightArmed: "night",
  },
}));

jest.mock("@caplaz/eufy-security-client", () => ({
  GuardMode: {
    AWAY: 0,
    HOME: 1,
    DISARMED: 6,
    CUSTOM1: 3,
    CUSTOM2: 4,
    CUSTOM3: 5,
  },
  AlarmMode: {},
  getDeviceCapabilities: jest
    .fn()
    .mockReturnValue({ battery: false, floodlight: false, panTilt: false }),
  isDoorbell: jest.fn().mockReturnValue(false),
  isCamera: jest.fn().mockReturnValue(true),
  isSensor: jest.fn().mockReturnValue(false),
  isLock: jest.fn().mockReturnValue(false),
  MODEL_NAMES: {},
}));

jest.mock("../../src/utils/ffmpeg-utils", () => ({
  FFmpegUtils: {
    convertH264ToJPEG: jest.fn().mockResolvedValue(Buffer.from([])),
  },
}));

jest.mock("../../src/utils/scrypted-device-detection", () => ({
  getScryptedDeviceType: jest.fn().mockReturnValue("Camera"),
}));

const makeApi = (properties: any) => ({
  getProperties: jest.fn().mockResolvedValue({ properties }),
  getPropertiesMetadata: jest.fn().mockResolvedValue({ properties: {} }),
});

const baseProps = { type: 1, name: "Test Cam", serialNumber: "CAM001" };

const makeWsClient = (properties: any) => ({
  commands: {
    device: jest.fn().mockReturnValue(makeApi(properties)),
  },
});

describe("DeviceUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDeviceCapabilities as jest.Mock).mockReturnValue({
      battery: false,
      floodlight: false,
      panTilt: false,
    });
    (isDoorbell as jest.Mock).mockReturnValue(false);
  });

  describe("createDeviceManifest", () => {
    it("includes base interfaces for all cameras", async () => {
      const wsClient = makeWsClient(baseProps) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Camera");
      expect(result.interfaces).toContain("VideoCamera");
      expect(result.interfaces).toContain("MotionSensor");
      expect(result.interfaces).toContain("Settings");
      expect(result.interfaces).toContain("Refresh");
    });

    it("adds Intercom when microphone AND speaker are present", async () => {
      const wsClient = makeWsClient({
        ...baseProps,
        microphone: true,
        speaker: true,
      }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Intercom");
    });

    it("does NOT add Intercom when microphone is missing", async () => {
      const wsClient = makeWsClient({ ...baseProps, speaker: true }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).not.toContain("Intercom");
    });

    it("does NOT add Intercom when speaker is missing", async () => {
      const wsClient = makeWsClient({ ...baseProps, microphone: true }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).not.toContain("Intercom");
    });

    it("does NOT add Intercom when neither microphone nor speaker is present", async () => {
      const wsClient = makeWsClient(baseProps) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).not.toContain("Intercom");
    });

    it("adds Battery when battery-capable device has battery property", async () => {
      (getDeviceCapabilities as jest.Mock).mockReturnValue({
        battery: true,
        floodlight: false,
        panTilt: false,
      });
      const wsClient = makeWsClient({ ...baseProps, battery: 80 }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Battery");
    });

    it("adds Charger when battery-capable device has chargingStatus", async () => {
      (getDeviceCapabilities as jest.Mock).mockReturnValue({
        battery: true,
        floodlight: false,
        panTilt: false,
      });
      const wsClient = makeWsClient({ ...baseProps, chargingStatus: 1 }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Charger");
    });

    it("adds OnOff for floodlight devices with light property", async () => {
      (getDeviceCapabilities as jest.Mock).mockReturnValue({
        battery: false,
        floodlight: true,
        panTilt: false,
      });
      const wsClient = makeWsClient({ ...baseProps, light: true }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("OnOff");
    });

    it("adds PanTiltZoom for PTZ devices", async () => {
      (getDeviceCapabilities as jest.Mock).mockReturnValue({
        battery: false,
        floodlight: false,
        panTilt: true,
      });
      const wsClient = makeWsClient(baseProps) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("PanTiltZoom");
    });

    it("adds BinarySensor for doorbell devices", async () => {
      (isDoorbell as jest.Mock).mockReturnValue(true);
      const wsClient = makeWsClient(baseProps) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("BinarySensor");
    });
  });
});
