/**
 * Eufy WebSocket API Driver Events
 *
 * Contains TypeScript interfaces for driver-level event payloads in the Eufy Security WebSocket API.
 *
 * See: eufy-security-ws/docs/api_events.md for event schema details.
 */

/**
 * Driver level events for Eufy WebSocket API
 */

// Import constants and types
import { DRIVER_EVENTS, DriverEventType } from "./constants";
import { EVENT_SOURCES } from "../common/constants";

// Event source types
export type DriverEventSource = typeof EVENT_SOURCES.DRIVER;

// Base driver event payload - minimal structure
export interface BaseDriverEventPayload<TEventName extends DriverEventType> {
  source: DriverEventSource;
  event: TEventName;
}

// Driver events
export interface DriverVerifyCodeEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.VERIFY_CODE> {
  methods?: string[];
}

export interface DriverCaptchaRequestEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.CAPTCHA_REQUEST> {
  captchaId: string;
  captcha: string;
}

export interface DriverConnectedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.CONNECTED> {
  // No additional properties
}

export interface DriverDisconnectedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.DISCONNECTED> {
  // No additional properties
}

export interface DriverPushConnectedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.PUSH_CONNECTED> {
  // No additional properties
}

export interface DriverPushDisconnectedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.PUSH_DISCONNECTED> {
  // No additional properties
}

export interface DriverMqttConnectedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.MQTT_CONNECTED> {
  // No additional properties
}

export interface DriverMqttDisconnectedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.MQTT_DISCONNECTED> {
  // No additional properties
}

export interface DriverLogLevelChangedEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.LOG_LEVEL_CHANGED> {
  level: string;
}

export interface DriverLoggingEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.LOGGING> {
  level: string;
  message: string;
}

export interface DriverConnectionErrorEventPayload
  extends BaseDriverEventPayload<typeof DRIVER_EVENTS.CONNECTION_ERROR> {
  error: string;
}

// Union type for all driver event payloads
export type DriverEventPayload =
  | DriverVerifyCodeEventPayload
  | DriverCaptchaRequestEventPayload
  | DriverConnectedEventPayload
  | DriverDisconnectedEventPayload
  | DriverPushConnectedEventPayload
  | DriverPushDisconnectedEventPayload
  | DriverMqttConnectedEventPayload
  | DriverMqttDisconnectedEventPayload
  | DriverLogLevelChangedEventPayload
  | DriverLoggingEventPayload
  | DriverConnectionErrorEventPayload;

// Helper type to get specific event payload by event type
export type DriverEventPayloadByType<T extends DriverEventType> = Extract<
  DriverEventPayload,
  { event: T }
>;

// Event listener type for driver events
export type DriverEventListener<T extends DriverEventType> = (
  event: DriverEventPayloadByType<T>
) => void;

// Generic driver event listener
export type AnyDriverEventListener = (event: DriverEventPayload) => void;
