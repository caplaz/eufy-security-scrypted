/**
 * Eufy Security WebSocket Client - Public API
 *
 * This is the main entry point for the Eufy Security WebSocket Client library.
 * It provides a clean, strongly typed interface for interacting with the
 * eufy-security-ws container through WebSocket connections.
 *
 * Exports all main API classes, types, and utilities for external use.
 */

// ================= MAIN CLIENT =================
export { ApiManager as EufyWebSocketClient } from "./api-manager";
export { WebSocketClient } from "./websocket-client";
export { EufySecurityClient } from "./eufy-security-client";

// ================= STATE MANAGEMENT =================
export { ClientStateManager, ConnectionState } from "./client-state";

// ================= COMMON =================
export * from "./common";

// ================= DEVICE =================
export * from "./device";

// ================= DRIVER =================
export * from "./driver";

// ================= SERVER =================
export * from "./server";

// ================= STATION =================
export * from "./station";

// ================= TYPES =================
export * from "./types/events";
export * from "./types/schema";
export * from "./types/shared";

// ================= AUTHENTICATION =================
export {
  AUTH_STATE,
  AuthenticationManager,
  type AuthState,
  type AuthStateChangeCallback,
  type CaptchaData,
  type DeviceRegistrationCallback,
  type MfaData,
} from "./authentication-manager";

// ================= UTILITIES =================
export { WebSocketMessageProcessor } from "./utils/websocket-message-processor";
export * from "./utils/device-detection";

// ================= WEBSOCKET TYPES =================
export { MESSAGE_TYPES } from "./websocket-types";
