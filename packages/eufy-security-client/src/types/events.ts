/**
 * Event type unions and helpers for Eufy Security WebSocket Client.
 *
 * Provides type unions and helpers for all event types and payloads across device, driver, server, and station.
 */

import { EventSource } from "../common/constants";
import {
  DeviceEventPayload,
  DeviceEventPayloadByType,
  DeviceEventSource,
  DeviceEventType,
} from "../device";
import {
  DriverEventPayload,
  DriverEventPayloadByType,
  DriverEventType,
} from "../driver/";
import {
  ServerEventPayload,
  ServerEventPayloadByType,
  ServerEventType,
} from "../server/";
import {
  StationEventPayload,
  StationEventPayloadByType,
  StationEventSource,
  StationEventType,
} from "../station/";

export type EventType =
  | DeviceEventType
  | DriverEventType
  | ServerEventType
  | StationEventType;

export type AllEventPayloads =
  | DeviceEventPayload
  | DriverEventPayload
  | ServerEventPayload
  | StationEventPayload;

export type EventPayloadForType<
  T extends EventType,
  S extends EventSource,
> = T extends DeviceEventType
  ? S extends DeviceEventSource
    ? DeviceEventPayloadByType<T>
    : never
  : T extends DriverEventType
    ? DriverEventPayloadByType<T>
    : T extends StationEventType
      ? S extends StationEventSource
        ? StationEventPayloadByType<T>
        : never
      : T extends ServerEventType
        ? ServerEventPayloadByType<T>
        : Extract<AllEventPayloads, { event: T }>;

export type EventCallbackForType<T extends EventType, S extends EventSource> = (
  payload: EventPayloadForType<T, S>,
) => void;

export interface EventListener<T extends EventType, S extends EventSource> {
  id: string;
  eventType: T;
  eventCallback: EventCallbackForType<T, S>;
  source?: S;
  serialNumber?: string;
}
