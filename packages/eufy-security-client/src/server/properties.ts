/**
 * Unified server properties interface.
 * Extend as needed for server-level properties.
 */
export interface ServerProperties {
  // Example server properties (customize as needed)
  schemaVersion: number;
  serverTime?: number;
  status?: string;
}

export type ServerPropertyName = keyof ServerProperties;
export type ServerProperty = {
  name: ServerPropertyName;
  value: ServerProperties[ServerPropertyName];
};
