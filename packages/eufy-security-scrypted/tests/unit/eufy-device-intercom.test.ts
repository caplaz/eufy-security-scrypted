/**
 * Unit tests for EufyDevice intercom (talkback) flow.
 *
 * Covers startIntercom/stopIntercom orchestration of:
 *  - livestream bootstrap (only when not already streaming)
 *  - waitForDeviceEvent timeout/resolve semantics
 *  - error path when startTalkback rejects
 *  - re-entrant startIntercom while already active
 *  - propagating isLivestreaming() failures
 */

import { EufyDevice } from "../../src/eufy-device";
import {
  DEVICE_EVENTS,
  EufyWebSocketClient,
} from "@caplaz/eufy-security-client";
import { Logger, ILogObj } from "tslog";

jest.mock("@scrypted/sdk", () => {
  const mediaManager = {
    convertMediaObjectToJSON: jest
      .fn()
      .mockResolvedValue({ inputArguments: ["-f", "s16le", "-i", "pipe:0"] }),
    createFFmpegMediaObject: jest.fn(),
  };
  return {
    __esModule: true,
    ScryptedDeviceBase: class {
      info: any = { serialNumber: "TEST123" };
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
    default: { mediaManager },
    mediaManager,
  };
});

jest.mock("@caplaz/eufy-stream-server", () => ({
  StreamServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getPort: jest.fn().mockReturnValue(8080),
    getActiveConnectionCount: jest.fn().mockReturnValue(0),
  })),
}));

jest.mock("child_process", () => ({
  spawn: jest.fn().mockImplementation(() => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const stdoutHandlers: Record<string, (...args: any[]) => void> = {};
    const stderrHandlers: Record<string, (...args: any[]) => void> = {};
    return {
      stdout: {
        on: jest.fn((event: string, cb: (...args: any[]) => void) => {
          stdoutHandlers[event] = cb;
        }),
        _handlers: stdoutHandlers,
      },
      stderr: {
        on: jest.fn((event: string, cb: (...args: any[]) => void) => {
          stderrHandlers[event] = cb;
        }),
        _handlers: stderrHandlers,
      },
      on: jest.fn((event: string, cb: (...args: any[]) => void) => {
        handlers[event] = cb;
      }),
      _handlers: handlers,
      kill: jest.fn(),
    };
  }),
}));

describe("EufyDevice Intercom Flow", () => {
  let device: EufyDevice;
  let mockWsClient: jest.Mocked<EufyWebSocketClient>;
  let mockApi: any;
  let mockLogger: any;
  let mockSubLogger: any;

  // Capture event listeners registered via wsClient.addEventListener so
  // tests can simulate the LIVESTREAM_STARTED / TALKBACK_STARTED events
  // the device waits for.
  let listeners: Array<{ eventType: string; cb: (payload?: any) => void }>;

  const fireEvent = (eventType: string) => {
    listeners.filter((l) => l.eventType === eventType).forEach((l) => l.cb());
  };

  beforeEach(() => {
    listeners = [];

    mockSubLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      silly: jest.fn(),
      trace: jest.fn(),
      attachTransport: jest.fn(),
      getSubLogger: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
        silly: jest.fn(),
        trace: jest.fn(),
        attachTransport: jest.fn(),
      }),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      silly: jest.fn(),
      trace: jest.fn(),
      getSubLogger: jest.fn().mockReturnValue(mockSubLogger),
    };

    mockApi = {
      isLivestreaming: jest.fn().mockResolvedValue({ livestreaming: true }),
      startLivestream: jest.fn().mockResolvedValue(undefined),
      stopLivestream: jest.fn().mockResolvedValue(undefined),
      startTalkback: jest.fn().mockResolvedValue(undefined),
      stopTalkback: jest.fn().mockResolvedValue(undefined),
      talkbackAudioData: jest.fn().mockResolvedValue(undefined),
      panAndTilt: jest.fn().mockResolvedValue(undefined),
      getProperties: jest.fn().mockResolvedValue({
        properties: { type: 1, name: "C", serialNumber: "TEST123" },
      }),
    };

    mockWsClient = {
      commands: { device: jest.fn().mockReturnValue(mockApi) },
      addEventListener: jest.fn(
        (eventType: string, cb: (payload?: any) => void) => {
          const entry = { eventType, cb };
          listeners.push(entry);
          return () => {
            const idx = listeners.indexOf(entry);
            if (idx >= 0) listeners.splice(idx, 1);
            return idx >= 0;
          };
        },
      ),
      removeEventListenersBySerialNumber: jest.fn(),
    } as any;

    device = new EufyDevice("device_TEST123", mockWsClient, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("startIntercom", () => {
    test("skips livestream bootstrap when already streaming", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: true });

      const promise = device.startIntercom({} as any);
      // Allow the await chain to register the talkback-started listener.
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await promise;

      expect(mockApi.startLivestream).not.toHaveBeenCalled();
      expect(mockApi.startTalkback).toHaveBeenCalledTimes(1);
      expect((device as any).talkbackActive).toBe(true);
      expect((device as any).intercomStartedLivestream).toBe(false);
    });

    test("bootstraps livestream when not currently streaming", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: false });

      const promise = device.startIntercom({} as any);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.LIVESTREAM_STARTED);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await promise;

      expect(mockApi.startLivestream).toHaveBeenCalledTimes(1);
      expect(mockApi.startTalkback).toHaveBeenCalledTimes(1);
      expect((device as any).intercomStartedLivestream).toBe(true);
    });

    test("propagates isLivestreaming() failures with context", async () => {
      mockApi.isLivestreaming.mockRejectedValue(new Error("ws closed"));

      await expect(device.startIntercom({} as any)).rejects.toThrow(
        /Failed to query livestream status before starting talkback/,
      );
      expect(mockApi.startTalkback).not.toHaveBeenCalled();
    });

    test("rolls back bootstrapped livestream when startTalkback fails", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: false });
      mockApi.startTalkback.mockRejectedValue(new Error("p2p closed"));

      const promise = device.startIntercom({} as any);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.LIVESTREAM_STARTED);

      await expect(promise).rejects.toThrow("p2p closed");
      expect(mockApi.stopLivestream).toHaveBeenCalledTimes(1);
      expect((device as any).talkbackActive).toBe(false);
      expect((device as any).intercomStartedLivestream).toBe(false);
    });

    test("tears down a previous session before starting a new one", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: true });

      const waitForListener = async (eventType: string, baseline: number) => {
        for (let i = 0; i < 50; i++) {
          if (
            listeners.filter((l) => l.eventType === eventType).length > baseline
          )
            return;
          await Promise.resolve();
        }
      };

      // First session — drive it to active
      const baselineTalk = listeners.filter(
        (l) => l.eventType === DEVICE_EVENTS.TALKBACK_STARTED,
      ).length;
      const first = device.startIntercom({} as any);
      await waitForListener(DEVICE_EVENTS.TALKBACK_STARTED, baselineTalk);
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await first;
      expect((device as any).talkbackActive).toBe(true);

      // Second call must stop the active talkback before re-arming.
      const second = device.startIntercom({} as any);
      await waitForListener(DEVICE_EVENTS.TALKBACK_STARTED, baselineTalk);
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await second;

      expect(mockApi.stopTalkback).toHaveBeenCalledTimes(1);
      expect(mockApi.startTalkback).toHaveBeenCalledTimes(2);
    });
  });

  describe("stopIntercom", () => {
    test("is a no-op when no talkback session is active", async () => {
      await device.stopIntercom();

      expect(mockApi.stopTalkback).not.toHaveBeenCalled();
      expect(mockApi.stopLivestream).not.toHaveBeenCalled();
    });

    test("stops talkback but leaves livestream alone when we didn't start it", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: true });

      const start = device.startIntercom({} as any);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await start;

      await device.stopIntercom();

      expect(mockApi.stopTalkback).toHaveBeenCalledTimes(1);
      expect(mockApi.stopLivestream).not.toHaveBeenCalled();
    });

    test("stops livestream we bootstrapped when no other viewers remain", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: false });
      (device as any).streamServer.getActiveConnectionCount.mockReturnValue(0);

      const start = device.startIntercom({} as any);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.LIVESTREAM_STARTED);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await start;

      await device.stopIntercom();

      expect(mockApi.stopTalkback).toHaveBeenCalledTimes(1);
      expect(mockApi.stopLivestream).toHaveBeenCalledTimes(1);
    });

    test("keeps bootstrapped livestream running when viewers are still attached", async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: false });
      (device as any).streamServer.getActiveConnectionCount.mockReturnValue(2);

      const start = device.startIntercom({} as any);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.LIVESTREAM_STARTED);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await start;

      await device.stopIntercom();

      expect(mockApi.stopTalkback).toHaveBeenCalledTimes(1);
      expect(mockApi.stopLivestream).not.toHaveBeenCalled();
    });
  });

  describe("FFmpeg subprocess callbacks", () => {
    /**
     * Helper: start intercom and drive it all the way to talkbackActive so
     * that the FFmpeg process has been spawned and its handlers registered.
     */
    const startIntercomActive = async () => {
      mockApi.isLivestreaming.mockResolvedValue({ livestreaming: true });
      const promise = device.startIntercom({} as any);
      await Promise.resolve();
      await Promise.resolve();
      fireEvent(DEVICE_EVENTS.TALKBACK_STARTED);
      await promise;
    };

    const getSpawnedProcess = () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawn } = require("child_process");
      return spawn.mock.results[spawn.mock.results.length - 1].value as {
        stdout: { _handlers: Record<string, (...args: any[]) => void> };
        stderr: { _handlers: Record<string, (...args: any[]) => void> };
        _handlers: Record<string, (...args: any[]) => void>;
      };
    };

    test("stdout sends audio chunk when talkbackActive is true", async () => {
      await startIntercomActive();
      const proc = getSpawnedProcess();
      const chunk = Buffer.from("audio-data");

      proc.stdout._handlers["data"](chunk);
      // talkbackAudioData returns a promise — flush it
      await Promise.resolve();

      expect(mockApi.talkbackAudioData).toHaveBeenCalledWith(chunk);
    });

    test("stdout is a no-op when talkbackActive is false", async () => {
      await startIntercomActive();
      (device as any).talkbackActive = false;
      const proc = getSpawnedProcess();

      proc.stdout._handlers["data"](Buffer.from("audio-data"));
      await Promise.resolve();

      expect(mockApi.talkbackAudioData).not.toHaveBeenCalled();
    });

    test("stdout handles talkbackAudioData rejection without propagating", async () => {
      mockApi.talkbackAudioData.mockRejectedValueOnce(new Error("send failed"));
      await startIntercomActive();
      const proc = getSpawnedProcess();

      proc.stdout._handlers["data"](Buffer.from("audio-data"));
      // Flush the rejected promise so the .catch() branch executes
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSubLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Failed to send talkback audio chunk/),
      );
    });

    test("stderr handler logs FFmpeg output", async () => {
      await startIntercomActive();
      const proc = getSpawnedProcess();

      proc.stderr._handlers["data"](Buffer.from("some ffmpeg stderr line\n"));

      expect(mockSubLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/Talkback FFmpeg: some ffmpeg stderr line/),
      );
    });

    test("error handler logs process error", async () => {
      await startIntercomActive();
      const proc = getSpawnedProcess();

      proc._handlers["error"](new Error("ENOENT"));

      expect(mockSubLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Talkback FFmpeg process error/),
      );
    });

    test("exit handler logs exit code and clears talkbackProcess", async () => {
      await startIntercomActive();
      expect((device as any).talkbackProcess).toBeDefined();
      const proc = getSpawnedProcess();

      proc._handlers["exit"](0);

      expect(mockSubLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/Talkback FFmpeg exited with code 0/),
      );
      expect((device as any).talkbackProcess).toBeUndefined();
    });
  });

  describe("waitForDeviceEvent", () => {
    const countListeners = (eventType: string) =>
      listeners.filter((l) => l.eventType === eventType).length;

    test("rejects with timeout error when the event never arrives", async () => {
      jest.useFakeTimers();
      try {
        const baseline = countListeners(DEVICE_EVENTS.LIVESTREAM_STARTED);

        const promise = (device as any).waitForDeviceEvent(
          DEVICE_EVENTS.LIVESTREAM_STARTED,
          1000,
        );
        expect(countListeners(DEVICE_EVENTS.LIVESTREAM_STARTED)).toBe(
          baseline + 1,
        );

        jest.advanceTimersByTime(1000);
        await expect(promise).rejects.toThrow(
          /Timed out waiting for "livestream started"/,
        );
        // Listener self-removes on timeout.
        expect(countListeners(DEVICE_EVENTS.LIVESTREAM_STARTED)).toBe(baseline);
      } finally {
        jest.useRealTimers();
      }
    });

    test("resolves and removes the listener when the event fires", async () => {
      const baseline = countListeners(DEVICE_EVENTS.LIVESTREAM_STARTED);

      const promise = (device as any).waitForDeviceEvent(
        DEVICE_EVENTS.LIVESTREAM_STARTED,
        5000,
      );
      fireEvent(DEVICE_EVENTS.LIVESTREAM_STARTED);
      await expect(promise).resolves.toBeUndefined();
      expect(countListeners(DEVICE_EVENTS.LIVESTREAM_STARTED)).toBe(baseline);
    });
  });
});
