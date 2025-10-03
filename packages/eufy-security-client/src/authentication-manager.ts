/**
 * Authentication Manager
 *
 * Handles all authentication-related logic for Eufy Security clients,
 * including CAPTCHA challenges, 2FA verification, and authentication state management.
 *
 * This service encapsulates:
 * - Authentication state tracking (none, captcha_required, mfa_required)
 * - CAPTCHA and MFA data management
 * - User input handling for auth challenges
 * - WebSocket event listeners for auth events
 * - Post-authentication device discovery coordination
 *
 * @module authentication-manager
 */

import { Logger, ILogObj } from "tslog";
import { ApiManager } from "./api-manager";
import { StartListeningResponse } from "./server/responses";

/**
 * Authentication state constants
 */
export const AUTH_STATE = {
  NONE: "none",
  CAPTCHA_REQUIRED: "captcha_required",
  MFA_REQUIRED: "mfa_required",
} as const;

/**
 * Authentication state type derived from constants
 */
export type AuthState = (typeof AUTH_STATE)[keyof typeof AUTH_STATE];

/**
 * CAPTCHA challenge data
 */
export interface CaptchaData {
  captchaId: string;
  captcha: string; // Base64 image or data URL
}

/**
 * MFA challenge data
 */
export interface MfaData {
  methods: string[]; // Available 2FA methods (email, sms, etc.)
}

/**
 * Callback for when authentication state changes (to update UI)
 */
export type AuthStateChangeCallback = () => void;

/**
 * Callback for device registration after successful authentication
 */
export type DeviceRegistrationCallback = (
  result: StartListeningResponse
) => Promise<void>;

/**
 * Authentication Manager
 *
 * Centralizes all authentication logic, making it easier to:
 * - Test authentication flows independently
 * - Reuse authentication logic across different client implementations
 * - Maintain clear separation of concerns
 *
 * @example
 * ```typescript
 * const authManager = new AuthenticationManager(
 *   wsClient,
 *   logger, // tslog Logger instance
 *   () => updateUI(),
 *   async (result) => await registerDevices(result)
 * );
 *
 * // Check for pending auth after connection
 * await authManager.checkPendingAuth();
 *
 * // Get auth state for UI
 * const state = authManager.getAuthState();
 * const message = authManager.getAuthStatusMessage(true);
 *
 * // Handle user input
 * authManager.updateCaptchaCode("ABC123");
 * await authManager.submitCaptcha();
 * ```
 */
export class AuthenticationManager {
  private wsClient: ApiManager;
  private logger: Logger<ILogObj>;

  // Authentication state
  private authState: AuthState = AUTH_STATE.NONE;
  private captchaData: CaptchaData | null = null;
  private mfaData: MfaData | null = null;

  // Current user input (not persisted)
  private currentCaptchaCode = "";
  private currentVerifyCode = "";

  // Callbacks
  private onStateChange: AuthStateChangeCallback;
  private onDeviceRegistration: DeviceRegistrationCallback;

  constructor(
    wsClient: ApiManager,
    logger: Logger<ILogObj>,
    onStateChange: AuthStateChangeCallback,
    onDeviceRegistration: DeviceRegistrationCallback
  ) {
    this.wsClient = wsClient;
    this.logger = logger;
    this.onStateChange = onStateChange;
    this.onDeviceRegistration = onDeviceRegistration;

    this.setupEventListeners();
  }

  // =================== PUBLIC API ===================

  /**
   * Get current authentication state
   */
  getAuthState(): AuthState {
    return this.authState;
  }

  /**
   * Get current CAPTCHA data (if any)
   */
  getCaptchaData(): CaptchaData | null {
    return this.captchaData;
  }

  /**
   * Get current MFA data (if any)
   */
  getMfaData(): MfaData | null {
    return this.mfaData;
  }

  /**
   * Get current CAPTCHA code input
   */
  getCurrentCaptchaCode(): string {
    return this.currentCaptchaCode;
  }

  /**
   * Get current verification code input
   */
  getCurrentVerifyCode(): string {
    return this.currentVerifyCode;
  }

  /**
   * Update CAPTCHA code input (called on every keystroke)
   */
  updateCaptchaCode(code: string): void {
    this.currentCaptchaCode = code;
  }

  /**
   * Update verification code input (called on every keystroke)
   */
  updateVerifyCode(code: string): void {
    this.currentVerifyCode = code;
  }

  /**
   * Get a user-friendly authentication status message
   */
  getAuthStatusMessage(isDriverConnected: boolean): string {
    if (this.authState === AUTH_STATE.CAPTCHA_REQUIRED) {
      return "🔐 CAPTCHA required - check settings below";
    }
    if (this.authState === AUTH_STATE.MFA_REQUIRED) {
      return "🔐 2FA code required - check settings below";
    }
    if (isDriverConnected) {
      return "✅ Authenticated";
    }
    return "⚠️ Not connected - click Connect Account button";
  }

  /**
   * Check for pending authentication challenges after connection attempt
   */
  async checkPendingAuth(): Promise<void> {
    const pendingCaptcha = this.wsClient.getPendingCaptcha();
    if (pendingCaptcha) {
      this.captchaData = pendingCaptcha;
      this.authState = AUTH_STATE.CAPTCHA_REQUIRED;
      this.wsClient.clearPendingCaptcha();
      this.onStateChange();
      return;
    }

    const pendingMfa = this.wsClient.getPendingMfa();
    if (pendingMfa) {
      this.mfaData = pendingMfa;
      this.authState = AUTH_STATE.MFA_REQUIRED;
      this.wsClient.clearPendingMfa();
      this.onStateChange();
      return;
    }
  }

  /**
   * Submit CAPTCHA code
   */
  async submitCaptcha(): Promise<void> {
    const captchaCode = this.currentCaptchaCode;

    if (!captchaCode || captchaCode.trim() === "") {
      this.logger.warn("⚠️ CAPTCHA code is empty");
      throw new Error("Please enter a CAPTCHA code");
    }

    if (!this.captchaData) {
      this.logger.warn("⚠️ No CAPTCHA data available");
      throw new Error("No CAPTCHA challenge found");
    }

    this.logger.info(
      `🔐 Submitting CAPTCHA code for ID: ${this.captchaData.captchaId}`
    );

    try {
      await this.wsClient.commands.driver().setCaptcha({
        captchaId: this.captchaData.captchaId,
        captcha: captchaCode.trim(),
      });

      this.logger.info("✅ CAPTCHA submitted successfully");

      // Clear CAPTCHA state
      this.captchaData = null;
      this.currentCaptchaCode = "";

      // Check post-CAPTCHA state (may need 2FA, or authentication complete)
      await this.checkPostCaptchaState();
      this.onStateChange();
    } catch (error) {
      this.logger.error("❌ CAPTCHA submission failed:", error);
      throw error;
    }
  }

  /**
   * Submit 2FA verification code
   */
  async submitVerifyCode(): Promise<void> {
    const verifyCode = this.currentVerifyCode;

    if (!verifyCode || verifyCode.trim() === "") {
      this.logger.warn("⚠️ Verification code is empty");
      throw new Error("Please enter a verification code");
    }

    const captchaId = this.captchaData?.captchaId || "";
    this.logger.info("🔐 Submitting 2FA verification code");

    try {
      await this.wsClient.commands.driver().setVerifyCode({
        verifyCode: verifyCode,
        captchaId: captchaId,
      });

      this.logger.info("✅ Verification code submitted successfully");

      // Clear MFA state
      this.mfaData = null;
      this.currentVerifyCode = "";

      // Check post-verification state
      await this.checkPostVerificationState();
      this.onStateChange();
    } catch (error) {
      this.logger.error("❌ Verification code submission failed:", error);
      throw error;
    }
  }

  /**
   * Request a new verification code
   */
  async requestNewCode(): Promise<void> {
    this.logger.info("🔄 Requesting new verification code");

    try {
      // The driver should send a new code
      // This typically triggers another "verify code" event
      await this.wsClient.commands.driver().setVerifyCode({
        verifyCode: "", // Empty code requests a new one
        captchaId: this.captchaData?.captchaId || "",
      });

      this.logger.info("✅ New verification code requested");
      this.onStateChange();
    } catch (error) {
      this.logger.error("❌ Failed to request new code:", error);
      throw error;
    }
  }

  /**
   * Reset authentication state (on successful connection)
   */
  resetAuthState(): void {
    this.authState = AUTH_STATE.NONE;
    this.captchaData = null;
    this.mfaData = null;
    this.currentCaptchaCode = "";
    this.currentVerifyCode = "";
  }

  // =================== PRIVATE METHODS ===================

  /**
   * Set up WebSocket event listeners for authentication events
   */
  private setupEventListeners(): void {
    // Listen for CAPTCHA requests
    this.wsClient.addEventListener(
      "captcha request",
      (event) => {
        this.logger.info("🔐 CAPTCHA requested");
        this.captchaData = {
          captchaId: event.captchaId,
          captcha: event.captcha,
        };
        this.authState = AUTH_STATE.CAPTCHA_REQUIRED;
        this.onStateChange();
      },
      { source: "driver" }
    );

    // Listen for MFA requests
    this.wsClient.addEventListener(
      "verify code",
      (event) => {
        this.logger.info("🔐 2FA verification requested");
        this.mfaData = { methods: event.methods || [] };
        this.authState = AUTH_STATE.MFA_REQUIRED;
        this.onStateChange();
      },
      { source: "driver" }
    );

    // Listen for driver connected events
    this.wsClient.addEventListener(
      "connected",
      () => {
        this.logger.info("✅ Driver connected");
        this.resetAuthState();
        this.onStateChange();
      },
      { source: "driver" }
    );
  }

  /**
   * Check authentication state after CAPTCHA submission
   * May transition to 2FA if required, or complete authentication
   */
  private async checkPostCaptchaState(): Promise<void> {
    const pendingMfa = this.wsClient.getPendingMfa();
    if (pendingMfa) {
      this.mfaData = pendingMfa;
      this.authState = AUTH_STATE.MFA_REQUIRED;
      this.wsClient.clearPendingMfa();
      return;
    }

    const listeningResult = await this.wsClient.startListening();
    if (listeningResult.state.driver.connected) {
      this.authState = AUTH_STATE.NONE;
      this.logger.info("✅ Authentication complete (CAPTCHA flow)");

      // Trigger device registration
      await this.onDeviceRegistration(listeningResult);
    }
  }

  /**
   * Check authentication state after 2FA verification
   * Completes authentication and discovers devices if successful
   */
  private async checkPostVerificationState(): Promise<void> {
    const listeningResult = await this.wsClient.startListening();
    if (listeningResult.state.driver.connected) {
      this.authState = AUTH_STATE.NONE;
      this.logger.info("✅ Authentication complete (2FA flow)");

      // Trigger device registration
      await this.onDeviceRegistration(listeningResult);
    }
  }
}
