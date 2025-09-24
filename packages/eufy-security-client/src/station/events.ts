/**
 * Eufy WebSocket API Station Events
 *
 * Contains TypeScript interfaces for station-level event payloads in the Eufy Security WebSocket API.
 *
 * See: eufy-security-ws/docs/api_events.md for event schema details.
 */

// Import constants and types
import { STATION_EVENTS, StationEventType } from "./constants";
import { JSONValue } from "../types/shared";
import { EVENT_SOURCES } from "../common/constants";
import { StationPropertyName } from "./properties";

// Event source types
export type StationEventSource = typeof EVENT_SOURCES.STATION;

// Base server event payload - minimal structure
export interface BaseStationEventPayload<TEventName extends StationEventType> {
  source: StationEventSource;
  event: TEventName;
}

// Base station event payload with serial number (for most station events)
export interface BaseStationEventPayloadWithSerial<
  TEventName extends StationEventType
> extends BaseStationEventPayload<TEventName> {
  serialNumber: string;
}

// Station management event payloads (use base without serial number)
export interface StationAddedEventPayload
  extends BaseStationEventPayload<typeof STATION_EVENTS.STATION_ADDED> {
  station: string; // Station serial number (schema 13+)
}

export interface StationRemovedEventPayload
  extends BaseStationEventPayload<typeof STATION_EVENTS.STATION_REMOVED> {
  station: string; // Station serial number (schema 13+)
}

// Station connection event payloads
export interface StationConnectedEventPayload
  extends BaseStationEventPayloadWithSerial<typeof STATION_EVENTS.CONNECTED> {
  // No additional properties
}

export interface StationDisconnectedEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.DISCONNECTED
  > {
  // No additional properties
}

// Station property changed event payload
export interface StationPropertyChangedEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.PROPERTY_CHANGED
  > {
  name: StationPropertyName;
  value: JSONValue;
}

// Station alarm event payloads
export interface StationAlarmEventPayload
  extends BaseStationEventPayloadWithSerial<typeof STATION_EVENTS.ALARM_EVENT> {
  alarmType: string;
}

export interface StationAlarmDelayEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.ALARM_DELAY_EVENT
  > {
  alarmType: string;
}

export interface StationAlarmArmedEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.ALARM_ARMED_EVENT
  > {
  alarmType: string;
}

export interface StationAlarmArmDelayEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.ALARM_ARM_DELAY_EVENT
  > {
  alarmType: string;
}

// Station mode event payloads
export interface StationGuardModeChangedEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.GUARD_MODE_CHANGED
  > {
  guardMode: number;
}

export interface StationCurrentModeChangedEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.CURRENT_MODE_CHANGED
  > {
  currentMode: number;
}

// Station database event payloads
export interface StationImageDownloadedEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.IMAGE_DOWNLOADED
  > {
  filename: string;
  path: string;
}

export interface StationDatabaseQueryLatestEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.DATABASE_QUERY_LATEST
  > {
  data: JSONValue[];
}

export interface StationDatabaseQueryLocalEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.DATABASE_QUERY_LOCAL
  > {
  data: JSONValue[];
}

export interface StationDatabaseCountByDateEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.DATABASE_COUNT_BY_DATE
  > {
  date: string;
  count: number;
}

export interface StationDatabaseDeleteEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.DATABASE_DELETE
  > {
  deleted: boolean;
}

// Station command result event payload
export interface StationCommandResultEventPayload
  extends BaseStationEventPayloadWithSerial<
    typeof STATION_EVENTS.COMMAND_RESULT
  > {
  command: string;
  returnCode: number;
  returnCodeName: string;
  customData?: JSONValue;
}

// Union type for all station event payloads
export type StationEventPayload =
  | StationAddedEventPayload
  | StationRemovedEventPayload
  | StationConnectedEventPayload
  | StationDisconnectedEventPayload
  | StationPropertyChangedEventPayload
  | StationAlarmEventPayload
  | StationAlarmDelayEventPayload
  | StationAlarmArmedEventPayload
  | StationAlarmArmDelayEventPayload
  | StationGuardModeChangedEventPayload
  | StationCurrentModeChangedEventPayload
  | StationImageDownloadedEventPayload
  | StationDatabaseQueryLatestEventPayload
  | StationDatabaseQueryLocalEventPayload
  | StationDatabaseCountByDateEventPayload
  | StationDatabaseDeleteEventPayload
  | StationCommandResultEventPayload;

// Helper type to get specific event payload by event type
export type StationEventPayloadByType<T extends StationEventType> = Extract<
  StationEventPayload,
  { event: T }
>;

// Event listener type for station events
export type StationEventListener<T extends StationEventType> = (
  event: StationEventPayloadByType<T>
) => void;

// Generic station event listener
export type AnyStationEventListener = (event: StationEventPayload) => void;
