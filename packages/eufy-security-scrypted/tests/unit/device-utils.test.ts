jest.unmock("../../src/utils/device-utils");

import { DeviceUtils } from "../../src/utils/device-utils";

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
    Lock: "Lock",
    Unknown: "Unknown",
  },
  SecuritySystemMode: {
    AwayArmed: "away",
    HomeArmed: "home",
    Disarmed: "disarmed",
    NightArmed: "night",
  },
}));

jest.mock("../../src/utils/ffmpeg-utils", () => ({
  FFmpegUtils: {
    convertH264ToJPEG: jest.fn().mockResolvedValue(Buffer.from([])),
  },
}));

const makeApi = (properties: any, hasTalkback = false) => ({
  getProperties: jest.fn().mockResolvedValue({ properties }),
  getPropertiesMetadata: jest.fn().mockResolvedValue({ properties: {} }),
  hasCommand: jest.fn().mockResolvedValue({ exists: hasTalkback }),
});

const baseProps = { type: 1, name: "Test Cam", serialNumber: "CAM001" };

const makeWsClient = (properties: any, hasTalkback = false) => ({
  commands: {
    device: jest.fn().mockReturnValue(makeApi(properties, hasTalkback)),
  },
});

describe("DeviceUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    it("adds Intercom when the device supports deviceStartTalkback", async () => {
      const wsClient = makeWsClient(baseProps, true) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Intercom");
    });

    it("adds Intercom even when microphone/speaker properties are absent (e.g. S220)", async () => {
      // BATTERY_DOORBELL_2 (S220) supports talkback but does not expose
      // microphone/speaker boolean properties; the server's hasCommand check
      // is authoritative.
      const wsClient = makeWsClient(baseProps, true) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Intercom");
    });

    it("does NOT add Intercom when the device does not support startTalkback", async () => {
      const wsClient = makeWsClient(
        { ...baseProps, microphone: true, speaker: true },
        false,
      ) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).not.toContain("Intercom");
    });

    it("adds Battery when battery-capable device has battery property", async () => {
      const wsClient = makeWsClient({ ...baseProps, battery: 80 }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Battery");
    });

    it("adds Charger when battery-capable device has chargingStatus", async () => {
      const wsClient = makeWsClient({ ...baseProps, chargingStatus: 1 }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("Charger");
    });

    it("adds OnOff for floodlight devices with light property", async () => {
      const wsClient = makeWsClient({
        ...baseProps,
        type: 3,
        light: true,
      }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("OnOff");
    });

    it("adds PanTiltZoom for PTZ devices", async () => {
      const wsClient = makeWsClient({ ...baseProps, type: 31 }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("PanTiltZoom");
    });

    it("adds BinarySensor for doorbell devices", async () => {
      const wsClient = makeWsClient({ ...baseProps, type: 5 }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.interfaces).toContain("BinarySensor");
    });

    it("uses stationSerialNumber as providerNativeId when present", async () => {
      const wsClient = makeWsClient({
        ...baseProps,
        stationSerialNumber: "HUB001",
      }) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.providerNativeId).toBe("station_HUB001");
    });

    it("falls back to own serial as providerNativeId when stationSerialNumber is absent", async () => {
      // Standalone doorbells (e.g. T8223/C30) report no stationSerialNumber
      const wsClient = makeWsClient(baseProps) as any;
      const result = await DeviceUtils.createDeviceManifest(wsClient, "CAM001");

      expect(result.providerNativeId).toBe("station_CAM001");
    });

    it("registers FamiLock S3 as a doorbell with video interfaces", async () => {
      const result = await DeviceUtils.createDeviceManifest(
        makeWsClient(
          {
            type: 203,
            model: "T85V0",
            battery: 70,
            serialNumber: "T85V0X",
          },
          true,
        ) as any,
        "T85V0X",
      );

      expect(result.type).toBe("Doorbell");
      expect(result.interfaces).toEqual(
        expect.arrayContaining([
          "Camera",
          "VideoCamera",
          "BinarySensor",
          "Battery",
          "Intercom",
        ]),
      );
    });

    it("registers C33 and Siren E20 without camera interfaces", async () => {
      const lock = await DeviceUtils.createDeviceManifest(
        makeWsClient({
          type: 201,
          model: "T85L0",
          serialNumber: "T85L0X",
        }) as any,
        "T85L0X",
      );
      const siren = await DeviceUtils.createDeviceManifest(
        makeWsClient({
          type: 123,
          model: "T90R0",
          serialNumber: "T90R0X",
        }) as any,
        "T90R0X",
      );

      expect(lock.type).toBe("Lock");
      expect(lock.interfaces).not.toContain("Camera");
      expect(siren.type).toBe("Sensor");
      expect(siren.interfaces).not.toContain("Camera");
    });
  });
});
