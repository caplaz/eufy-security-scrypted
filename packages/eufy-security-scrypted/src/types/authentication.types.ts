/**
 * Authentication Types
 *
 * Type definitions for authentication services including CAPTCHA and MFA handling.
 */

/**
 * Authentication state representing the current authentication challenge status
 */
export type AuthenticationState = "none" | "captcha_required" | "mfa_required";

/**
 * CAPTCHA challenge data received from the server
 */
export interface CaptchaData {
  /** Unique identifier for the CAPTCHA challenge */
  captchaId: string;
  /** Base64 encoded CAPTCHA image or data URL */
  captcha: string;
}

/**
 * Multi-factor authentication data
 */
export interface MfaData {
  /** Available MFA methods (e.g., ['email', 'sms']) */
  methods: string[];
}

/**
 * Result of an authentication attempt
 */
export interface AuthenticationResult {
  /** Whether authentication was successful */
  success: boolean;
  /** Whether driver connection was established */
  driverConnected: boolean;
  /** Error message if authentication failed */
  error?: string;
}

/**
 * Authentication event listener callback
 */
export type AuthenticationEventCallback = (state: AuthenticationState) => void;
