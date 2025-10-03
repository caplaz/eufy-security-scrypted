/**
 * Authentication Service
 *
 * Manages Eufy cloud authentication including CAPTCHA and MFA challenges.
 * Provides a clean interface for handling complex authentication flows.
 *
 * @module services/authentication
 */

import {
  EufyWebSocketClient,
  StartListeningResponse,
} from "@caplaz/eufy-security-client";
import { ConsoleLogger } from "../../utils/console-logger";

/**
 * Authentication state representing the current authentication challenge status
 */
export type AuthenticationState = "none" | "captcha_required" | "mfa_required";

/**
 * CAPTCHA challenge data received from the server
 */
export interface CaptchaData {
  captchaId: string;
  captcha: string;
}

/**
 * Multi-factor authentication data
 */
export interface MfaData {
  methods: string[];
}

/**
 * Result of an authentication attempt
 */
export interface AuthenticationResult {
  success: boolean;
  driverConnected: boolean;
  error?: string;
}

/**
 * Authentication event listener callback
 */
export type AuthenticationEventCallback = (state: AuthenticationState) => void;

/**
 * AuthenticationService handles all authentication-related operations
 * including CAPTCHA challenges, MFA verification, and connection state management.
 */
export class AuthenticationService {
  private authState: AuthenticationState = "none";
  private captchaData: CaptchaData | null = null;
  private mfaData: MfaData | null = null;
  private eventCallbacks: Set<AuthenticationEventCallback> = new Set();

  constructor(
    private wsClient: EufyWebSocketClient,
    private logger: ConsoleLogger
  ) {
    this.setupEventListeners();
  }

  /**
   * Get current authentication state
   */
  getState(): AuthenticationState {
    return this.authState;
  }

  /**
   * Get current CAPTCHA data if available
   */
  getCaptchaData(): CaptchaData | null {
    return this.captchaData;
  }

  /**
   * Get current MFA data if available
   */
  getMfaData(): MfaData | null {
    return this.mfaData;
  }

  /**
   * Subscribe to authentication state changes
   */
  onStateChange(callback: AuthenticationEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Initiate connection to Eufy cloud
   *
   * @returns Authentication result with connection status
   */
  async connect(): Promise<AuthenticationResult> {
    this.logger.info("🔗 Initiating Eufy cloud connection");

    try {
      // Send connect command to the driver
      await this.wsClient.commands.driver().connect();
      this.logger.info("✅ Driver connect command sent");

      // Wait for server to process
      await this.delay(1000);

      // Check connection state
      const result = await this.wsClient.startListening();

      if (result.state.driver.connected) {
        this.logger.info("✅ Driver fully connected - authentication complete");
        this.setState("none");
        return {
          success: true,
          driverConnected: true,
        };
      }

      // Check for pending authentication challenges
      await this.checkPendingAuth();

      if (this.authState === "none") {
        this.logger.info("💡 No authentication challenges detected");
        return {
          success: false,
          driverConnected: false,
          error: "Connection in progress. Check driver logs for details.",
        };
      }

      return {
        success: false,
        driverConnected: false,
      };
    } catch (error) {
      this.logger.error("❌ Connection failed:", error);
      await this.checkPendingAuth();

      return {
        success: false,
        driverConnected: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Disconnect from Eufy cloud
   */
  async disconnect(): Promise<void> {
    this.logger.info("🔌 Disconnecting from Eufy cloud");

    try {
      await this.wsClient.commands.driver().disconnect();
      this.setState("none");
      this.logger.info("✅ Disconnected successfully");
    } catch (error) {
      this.logger.error("❌ Failed to disconnect:", error);
      throw error;
    }
  }

  /**
   * Submit CAPTCHA solution
   *
   * @param code - The CAPTCHA code entered by the user
   * @returns Authentication result after CAPTCHA submission
   */
  async submitCaptcha(code: string): Promise<AuthenticationResult> {
    this.logger.info("🔐 Submitting CAPTCHA code");

    if (!code || code.trim() === "") {
      throw new Error("CAPTCHA code is required");
    }

    if (!this.captchaData) {
      throw new Error("No CAPTCHA data available");
    }

    try {
      await this.wsClient.commands.driver().setCaptcha({
        captchaId: this.captchaData.captchaId,
        captcha: code.trim(),
      });

      this.logger.info("✅ CAPTCHA submitted successfully");

      // Clear CAPTCHA data
      this.captchaData = null;
      this.wsClient.clearPendingCaptcha();

      // Check post-CAPTCHA state
      return await this.checkPostCaptchaState();
    } catch (error) {
      this.logger.error("❌ CAPTCHA submission failed:", error);
      throw error;
    }
  }

  /**
   * Submit MFA verification code
   *
   * @param code - The MFA code entered by the user
   * @returns Authentication result after MFA submission
   */
  async submitMfaCode(code: string): Promise<AuthenticationResult> {
    this.logger.info("🔐 Submitting 2FA verification code");

    if (!code || code.trim() === "") {
      throw new Error("Verification code is required");
    }

    const captchaId = this.captchaData?.captchaId || "";

    try {
      await this.wsClient.commands.driver().setVerifyCode({
        captchaId,
        verifyCode: code.trim(),
      });

      this.logger.info("✅ Verification code submitted successfully");

      // Clear MFA data
      this.mfaData = null;
      this.wsClient.clearPendingMfa();

      // Check post-verification state
      return await this.checkPostVerificationState();
    } catch (error) {
      this.logger.error("❌ Verification code submission failed:", error);
      throw error;
    }
  }

  /**
   * Check if driver is currently connected
   */
  async isDriverConnected(): Promise<boolean> {
    const state = this.wsClient.getState();
    return state.driverConnected;
  }

  /**
   * Set up event listeners for authentication events
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
        this.setState("captcha_required");
      },
      { source: "driver" }
    );

    // Listen for MFA requests
    this.wsClient.addEventListener(
      "verify code",
      (event) => {
        this.logger.info("🔐 2FA verification requested");
        this.mfaData = { methods: event.methods || [] };
        this.setState("mfa_required");
      },
      { source: "driver" }
    );

    // Listen for driver connected events
    this.wsClient.addEventListener(
      "connected",
      () => {
        this.logger.info("✅ Driver connected");
        this.setState("none");
        this.captchaData = null;
        this.mfaData = null;
      },
      { source: "driver" }
    );
  }

  /**
   * Check for pending authentication challenges
   */
  private async checkPendingAuth(): Promise<void> {
    const pendingCaptcha = this.wsClient.getPendingCaptcha();
    if (pendingCaptcha) {
      this.captchaData = pendingCaptcha;
      this.setState("captcha_required");
      this.wsClient.clearPendingCaptcha();
      return;
    }

    const pendingMfa = this.wsClient.getPendingMfa();
    if (pendingMfa) {
      this.mfaData = pendingMfa;
      this.setState("mfa_required");
      this.wsClient.clearPendingMfa();
      return;
    }
  }

  /**
   * Check authentication state after CAPTCHA submission
   */
  private async checkPostCaptchaState(): Promise<AuthenticationResult> {
    const pendingMfa = this.wsClient.getPendingMfa();
    if (pendingMfa) {
      this.mfaData = pendingMfa;
      this.setState("mfa_required");
      this.wsClient.clearPendingMfa();
      return {
        success: false,
        driverConnected: false,
      };
    }

    const result = await this.wsClient.startListening();
    if (result.state.driver.connected) {
      this.setState("none");
      return {
        success: true,
        driverConnected: true,
      };
    }

    return {
      success: false,
      driverConnected: false,
    };
  }

  /**
   * Check authentication state after MFA submission
   */
  private async checkPostVerificationState(): Promise<AuthenticationResult> {
    const result = await this.wsClient.startListening();
    if (result.state.driver.connected) {
      this.setState("none");
      return {
        success: true,
        driverConnected: true,
      };
    }

    return {
      success: false,
      driverConnected: false,
    };
  }

  /**
   * Update authentication state and notify listeners
   */
  private setState(newState: AuthenticationState): void {
    if (this.authState !== newState) {
      this.authState = newState;
      this.eventCallbacks.forEach((callback) => callback(newState));
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.eventCallbacks.clear();
    this.captchaData = null;
    this.mfaData = null;
  }
}
