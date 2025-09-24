/**
 * Shared core types for Eufy Security WebSocket Client.
 *
 * Provides JSON value types, common property interfaces, and property metadata types used across all modules.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];

/**
 * Common properties shared by both devices and stations.
 */
export interface CommonEufyProperties {
  name: string;
  model: string;
  serialNumber: string;
  hardwareVersion: string;
  softwareVersion: string;
  type: number;
}

// Property metadata types
export type PropertyMetadataType = "number" | "boolean" | "string";

/**
 * Base metadata for properties in the Eufy Security WebSocket API.
 * Provides common fields for property metadata definitions.
 */
export type PropertyMetadataBase<T extends PropertyMetadataType> = {
  type: T;
  name: string;
  label: string;
  writeable: true;
  default?: T extends "boolean"
    ? boolean
    : T extends "number"
      ? number
      : string;
};

export type PropertyMetadataAny =
  | PropertyMetadataBase<"boolean">
  | PropertyMetadataBase<"string">
  | (PropertyMetadataBase<"number"> & {
      states?: Record<number, string>;
      min?: number;
      max?: number;
      unit?: string;
    });

export interface IndexedProperty {
  [index: string]: PropertyMetadataAny;
}

// Utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredProperties<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
