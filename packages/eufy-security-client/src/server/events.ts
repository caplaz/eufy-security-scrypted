/**
 * Server level events for Eufy WebSocket API
 */

// Import constants and types
import { EVENT_SOURCES } from "../common";
import { SERVER_EVENTS, ServerEventType } from "./constants";

// Event source types
export type ServerEventSource = typeof EVENT_SOURCES.SERVER;

// Base server event payload - minimal structure
export interface BaseServerEventPayload<TEventName extends ServerEventType> {
  source: ServerEventSource;
  event: TEventName;
}

// Connection event payload - sent when server is ready
export interface ShutdownEventPayload
  extends BaseServerEventPayload<typeof SERVER_EVENTS.SHUTDOWN> {}

// Union type for all server event payloads
export type ServerEventPayload = ShutdownEventPayload;

export type ServerEventPayloadByType<T extends ServerEventType> = Extract<
  ServerEventPayload,
  { event: T }
>;
