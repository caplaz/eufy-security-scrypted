/**
 * Authentication Service Tests
 *
 * Unit tests for the AuthenticationService module.
 */

import { AuthenticationService } from "../../../src/services/authentication/authentication-service";
import { EufyWebSocketClient } from "@caplaz/eufy-security-client";
import { createConsoleLogger } from "../../../src/utils/console-logger";

// Mock WebSocket client
const createMockWsClient = () => {
  const eventListeners = new Map<string, any[]>();

  // Create persistent mock functions
  const connectMock = jest.fn().mockResolvedValue({});
  const disconnectMock = jest.fn().mockResolvedValue({});
  const setCaptchaMock = jest.fn().mockResolvedValue({});
  const setVerifyCodeMock = jest.fn().mockResolvedValue({});

  return {
    commands: {
      driver: () => ({
        connect: connectMock,
        disconnect: disconnectMock,
        setCaptcha: setCaptchaMock,
        setVerifyCode: setVerifyCodeMock,
      }),
    },
    _connectMock: connectMock,
    _disconnectMock: disconnectMock,
    _setCaptchaMock: setCaptchaMock,
    _setVerifyCodeMock: setVerifyCodeMock,
    addEventListener: jest.fn((event: string, callback: any, options?: any) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event)!.push({ callback, options });
      return () => {
        const listeners = eventListeners.get(event) || [];
        const index = listeners.findIndex((l) => l.callback === callback);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    }),
    startListening: jest.fn().mockResolvedValue({
      state: {
        driver: { connected: false },
      },
    }),
    getState: jest.fn().mockReturnValue({
      driverConnected: false,
    }),
    getPendingCaptcha: jest.fn().mockReturnValue(null),
    getPendingMfa: jest.fn().mockReturnValue(null),
    clearPendingCaptcha: jest.fn(),
    clearPendingMfa: jest.fn(),
    // Helper to trigger events
    _triggerEvent: (event: string, data: any) => {
      const listeners = eventListeners.get(event) || [];
      listeners.forEach((listener) => {
        listener.callback(data);
      });
    },
  } as any;
};

describe("AuthenticationService", () => {
  let service: AuthenticationService;
  let mockWsClient: ReturnType<typeof createMockWsClient>;
  let mockLogger: ReturnType<typeof createConsoleLogger>;

  beforeEach(() => {
    mockWsClient = createMockWsClient();
    mockLogger = createConsoleLogger("Test");
    service = new AuthenticationService(mockWsClient, mockLogger);
  });

  afterEach(() => {
    service.dispose();
  });

  describe("Initialization", () => {
    it("should initialize with 'none' auth state", () => {
      expect(service.getState()).toBe("none");
    });

    it("should have no CAPTCHA data initially", () => {
      expect(service.getCaptchaData()).toBeNull();
    });

    it("should have no MFA data initially", () => {
      expect(service.getMfaData()).toBeNull();
    });
  });

  describe("Connection Management", () => {
    it("should successfully connect when driver connects", async () => {
      mockWsClient.startListening.mockResolvedValueOnce({
        state: {
          driver: { connected: true },
        },
      });

      const result = await service.connect();

      expect(result.success).toBe(true);
      expect(result.driverConnected).toBe(true);
      expect(service.getState()).toBe("none");
    });

    it("should handle connection when authentication is required", async () => {
      mockWsClient.startListening.mockResolvedValueOnce({
        state: {
          driver: { connected: false },
        },
      });

      const result = await service.connect();

      expect(result.success).toBe(false);
      expect(result.driverConnected).toBe(false);
    });

    it("should disconnect successfully", async () => {
      await service.disconnect();

      expect(mockWsClient._disconnectMock).toHaveBeenCalled();
      expect(service.getState()).toBe("none");
    });
  });

  describe("CAPTCHA Handling", () => {
    it("should handle CAPTCHA request event", () => {
      const captchaData = {
        captchaId: "test-captcha-id",
        captcha: "base64-image-data",
      };

      mockWsClient._triggerEvent("captcha request", captchaData);

      expect(service.getState()).toBe("captcha_required");
      expect(service.getCaptchaData()).toEqual(captchaData);
    });

    it("should submit CAPTCHA successfully", async () => {
      // Set up CAPTCHA state
      mockWsClient._triggerEvent("captcha request", {
        captchaId: "test-id",
        captcha: "image-data",
      });

      mockWsClient.startListening.mockResolvedValueOnce({
        state: {
          driver: { connected: true },
        },
      });

      const result = await service.submitCaptcha("ABC123");

      expect(mockWsClient._setCaptchaMock).toHaveBeenCalledWith({
        captchaId: "test-id",
        captcha: "ABC123",
      });
      expect(result.success).toBe(true);
      expect(service.getCaptchaData()).toBeNull();
    });

    it("should reject empty CAPTCHA code", async () => {
      mockWsClient._triggerEvent("captcha request", {
        captchaId: "test-id",
        captcha: "image-data",
      });

      await expect(service.submitCaptcha("")).rejects.toThrow(
        "CAPTCHA code is required"
      );
    });

    it("should reject CAPTCHA submission without CAPTCHA data", async () => {
      await expect(service.submitCaptcha("ABC123")).rejects.toThrow(
        "No CAPTCHA data available"
      );
    });
  });

  describe("MFA Handling", () => {
    it("should handle MFA request event", () => {
      const mfaData = {
        methods: ["email", "sms"],
      };

      mockWsClient._triggerEvent("verify code", mfaData);

      expect(service.getState()).toBe("mfa_required");
      expect(service.getMfaData()).toEqual(mfaData);
    });

    it("should submit MFA code successfully", async () => {
      mockWsClient._triggerEvent("verify code", {
        methods: ["email"],
      });

      mockWsClient.startListening.mockResolvedValueOnce({
        state: {
          driver: { connected: true },
        },
      });

      const result = await service.submitMfaCode("123456");

      expect(mockWsClient._setVerifyCodeMock).toHaveBeenCalledWith({
        captchaId: "",
        verifyCode: "123456",
      });
      expect(result.success).toBe(true);
      expect(service.getMfaData()).toBeNull();
    });

    it("should reject empty MFA code", async () => {
      mockWsClient._triggerEvent("verify code", {
        methods: ["email"],
      });

      await expect(service.submitMfaCode("")).rejects.toThrow(
        "Verification code is required"
      );
    });
  });

  describe("State Change Events", () => {
    it("should notify listeners on state change", () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      mockWsClient._triggerEvent("captcha request", {
        captchaId: "test",
        captcha: "data",
      });

      expect(callback).toHaveBeenCalledWith("captcha_required");
    });

    it("should not notify after unsubscribing", () => {
      const callback = jest.fn();
      const unsubscribe = service.onStateChange(callback);

      unsubscribe();

      mockWsClient._triggerEvent("captcha request", {
        captchaId: "test",
        captcha: "data",
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should handle multiple listeners", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onStateChange(callback1);
      service.onStateChange(callback2);

      mockWsClient._triggerEvent("captcha request", {
        captchaId: "test",
        captcha: "data",
      });

      expect(callback1).toHaveBeenCalledWith("captcha_required");
      expect(callback2).toHaveBeenCalledWith("captcha_required");
    });
  });

  describe("Driver Connection Status", () => {
    it("should return driver connection status", async () => {
      mockWsClient.getState.mockReturnValueOnce({
        driverConnected: true,
      });

      const isConnected = await service.isDriverConnected();

      expect(isConnected).toBe(true);
    });
  });

  describe("Cleanup", () => {
    it("should clear all data on dispose", () => {
      mockWsClient._triggerEvent("captcha request", {
        captchaId: "test",
        captcha: "data",
      });

      expect(service.getState()).toBe("captcha_required");

      service.dispose();

      // Note: dispose clears callbacks but doesn't reset state
      // State is managed through authentication flow, not dispose
      expect(service.getCaptchaData()).toBeNull();
      expect(service.getMfaData()).toBeNull();
    });
  });
});
