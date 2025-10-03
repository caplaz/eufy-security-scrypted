/**
 * Tests for AuthenticationManager
 */

import {
  AuthenticationManager,
  AUTH_STATE,
} from "../../src/authentication-manager";
import { ApiManager } from "../../src/api-manager";
import { Logger } from "tslog";
import { StartListeningResponse } from "../../src/server/responses";

// Mock ApiManager
jest.mock("../../src/api-manager");

describe("AuthenticationManager", () => {
  let authManager: AuthenticationManager;
  let mockApiManager: jest.Mocked<ApiManager>;
  let mockLogger: jest.Mocked<Logger<any>>;
  let stateChangeCalled: boolean;
  let eventListeners: Map<string, Function>;

  const mockStateChangeCallback = jest.fn(() => {
    stateChangeCalled = true;
  });

  const mockDeviceRegistrationCallback = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    stateChangeCalled = false;
    eventListeners = new Map();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    mockApiManager = {
      addEventListener: jest.fn((event: string, callback: Function) => {
        eventListeners.set(event, callback);
        return () => true;
      }),
      getPendingCaptcha: jest.fn().mockReturnValue(null),
      clearPendingCaptcha: jest.fn(),
      getPendingMfa: jest.fn().mockReturnValue(null),
      clearPendingMfa: jest.fn(),
      startListening: jest.fn(),
      commands: {
        driver: jest.fn(() => ({
          setCaptcha: jest.fn(),
          setVerifyCode: jest.fn(),
        })),
      },
    } as any;

    authManager = new AuthenticationManager(
      mockApiManager,
      mockLogger,
      mockStateChangeCallback,
      mockDeviceRegistrationCallback
    );
  });

  describe("initialization", () => {
    it("should initialize with NONE auth state", () => {
      expect(authManager.getAuthState()).toBe(AUTH_STATE.NONE);
    });

    it("should have null captcha and mfa data initially", () => {
      expect(authManager.getCaptchaData()).toBeNull();
      expect(authManager.getMfaData()).toBeNull();
    });

    it("should have empty code inputs initially", () => {
      expect(authManager.getCurrentCaptchaCode()).toBe("");
      expect(authManager.getCurrentVerifyCode()).toBe("");
    });

    it("should register event listeners on creation", () => {
      expect(mockApiManager.addEventListener).toHaveBeenCalledTimes(3);
    });
  });

  describe("AUTH_STATE constants", () => {
    it("should have correct values", () => {
      expect(AUTH_STATE.NONE).toBe("none");
      expect(AUTH_STATE.CAPTCHA_REQUIRED).toBe("captcha_required");
      expect(AUTH_STATE.MFA_REQUIRED).toBe("mfa_required");
    });
  });

  describe("CAPTCHA handling", () => {
    const mockCaptchaData = {
      captchaId: "test-123",
      captcha: "data:image/png;base64,ABC",
    };

    it("should handle captcha request event", () => {
      const handler = eventListeners.get("captcha request");
      handler?.(mockCaptchaData);

      expect(authManager.getAuthState()).toBe(AUTH_STATE.CAPTCHA_REQUIRED);
      expect(authManager.getCaptchaData()).toEqual(mockCaptchaData);
      expect(stateChangeCalled).toBe(true);
    });

    it("should update captcha code", () => {
      authManager.updateCaptchaCode("ABC123");
      expect(authManager.getCurrentCaptchaCode()).toBe("ABC123");
    });

    it("should reject empty captcha code", async () => {
      const handler = eventListeners.get("captcha request");
      handler?.(mockCaptchaData);
      authManager.updateCaptchaCode("");

      await expect(authManager.submitCaptcha()).rejects.toThrow(
        "Please enter a CAPTCHA code"
      );
    });

    it("should reject submission without pending captcha", async () => {
      authManager.updateCaptchaCode("ABC");
      await expect(authManager.submitCaptcha()).rejects.toThrow(
        "No CAPTCHA challenge found"
      );
    });

    it("should submit captcha successfully", async () => {
      const handler = eventListeners.get("captcha request");
      handler?.(mockCaptchaData);
      authManager.updateCaptchaCode("CORRECT");

      const mockSetCaptcha = jest.fn().mockResolvedValue({});
      (mockApiManager.commands.driver as jest.Mock).mockReturnValue({
        setCaptcha: mockSetCaptcha,
      });

      const mockResponse: StartListeningResponse = {
        state: {
          driver: { version: "2.4.3", connected: true, pushConnected: false },
          stations: [],
          devices: [],
        },
      };
      mockApiManager.startListening = jest.fn().mockResolvedValue(mockResponse);

      await authManager.submitCaptcha();

      expect(mockSetCaptcha).toHaveBeenCalledWith({
        captchaId: "test-123",
        captcha: "CORRECT",
      });
      expect(authManager.getCaptchaData()).toBeNull();
    });
  });

  describe("MFA handling", () => {
    const mockMfaData = { methods: ["email", "sms"] };

    it("should handle MFA request event", () => {
      const handler = eventListeners.get("verify code");
      handler?.({ methods: mockMfaData.methods });

      expect(authManager.getAuthState()).toBe(AUTH_STATE.MFA_REQUIRED);
      expect(authManager.getMfaData()).toEqual(mockMfaData);
    });

    it("should update verify code", () => {
      authManager.updateVerifyCode("123456");
      expect(authManager.getCurrentVerifyCode()).toBe("123456");
    });

    it("should reject empty verify code", async () => {
      const handler = eventListeners.get("verify code");
      handler?.({ methods: ["email"] });
      authManager.updateVerifyCode("");

      await expect(authManager.submitVerifyCode()).rejects.toThrow(
        "Please enter a verification code"
      );
    });

    it("should submit verify code successfully", async () => {
      const handler = eventListeners.get("verify code");
      handler?.({ methods: ["email"] });
      authManager.updateVerifyCode("123456");

      const mockSetVerifyCode = jest.fn().mockResolvedValue({});
      (mockApiManager.commands.driver as jest.Mock).mockReturnValue({
        setVerifyCode: mockSetVerifyCode,
      });

      const mockResponse: StartListeningResponse = {
        state: {
          driver: { version: "2.4.3", connected: true, pushConnected: false },
          stations: [],
          devices: [],
        },
      };
      mockApiManager.startListening = jest.fn().mockResolvedValue(mockResponse);

      await authManager.submitVerifyCode();

      expect(mockSetVerifyCode).toHaveBeenCalledWith({
        verifyCode: "123456",
        captchaId: "",
      });
    });
  });

  describe("getAuthStatusMessage()", () => {
    it("should return not connected message", () => {
      const msg = authManager.getAuthStatusMessage(false);
      expect(msg).toContain("Not connected");
    });

    it("should return authenticated message", () => {
      const msg = authManager.getAuthStatusMessage(true);
      expect(msg).toContain("Authenticated");
    });

    it("should return CAPTCHA message", () => {
      const handler = eventListeners.get("captcha request");
      handler?.({ captchaId: "123", captcha: "data:..." });

      const msg = authManager.getAuthStatusMessage(false);
      expect(msg).toContain("CAPTCHA");
    });

    it("should return 2FA message", () => {
      const handler = eventListeners.get("verify code");
      handler?.({ methods: ["email"] });

      const msg = authManager.getAuthStatusMessage(false);
      expect(msg).toContain("2FA");
    });
  });

  describe("checkPendingAuth()", () => {
    it("should check for pending captcha", async () => {
      mockApiManager.getPendingCaptcha = jest
        .fn()
        .mockReturnValue({ captchaId: "123", captcha: "data:..." });

      await authManager.checkPendingAuth();

      expect(authManager.getAuthState()).toBe(AUTH_STATE.CAPTCHA_REQUIRED);
      expect(mockApiManager.clearPendingCaptcha).toHaveBeenCalled();
    });

    it("should check for pending MFA", async () => {
      mockApiManager.getPendingMfa = jest
        .fn()
        .mockReturnValue({ methods: ["email"] });

      await authManager.checkPendingAuth();

      expect(authManager.getAuthState()).toBe(AUTH_STATE.MFA_REQUIRED);
      expect(mockApiManager.clearPendingMfa).toHaveBeenCalled();
    });

    it("should do nothing if no pending auth", async () => {
      await authManager.checkPendingAuth();
      expect(authManager.getAuthState()).toBe(AUTH_STATE.NONE);
    });
  });

  describe("resetAuthState()", () => {
    it("should reset all state", () => {
      const handler = eventListeners.get("captcha request");
      handler?.({ captchaId: "123", captcha: "data:..." });
      authManager.updateCaptchaCode("ABC");

      authManager.resetAuthState();

      expect(authManager.getAuthState()).toBe(AUTH_STATE.NONE);
      expect(authManager.getCaptchaData()).toBeNull();
      expect(authManager.getCurrentCaptchaCode()).toBe("");
    });
  });

  describe("requestNewCode()", () => {
    it("should request new verification code", async () => {
      const mockSetVerifyCode = jest.fn().mockResolvedValue({});
      (mockApiManager.commands.driver as jest.Mock).mockReturnValue({
        setVerifyCode: mockSetVerifyCode,
      });

      await authManager.requestNewCode();

      expect(mockSetVerifyCode).toHaveBeenCalledWith({
        verifyCode: "",
        captchaId: "",
      });
    });
  });

  describe("driver connected event", () => {
    it("should reset auth state on driver connected", () => {
      const captchaHandler = eventListeners.get("captcha request");
      captchaHandler?.({ captchaId: "123", captcha: "data:..." });

      expect(authManager.getAuthState()).toBe(AUTH_STATE.CAPTCHA_REQUIRED);

      const connectedHandler = eventListeners.get("connected");
      connectedHandler?.();

      expect(authManager.getAuthState()).toBe(AUTH_STATE.NONE);
    });
  });
});
