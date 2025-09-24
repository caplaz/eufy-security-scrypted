/**
 * Schema compatibility and negotiation types for Eufy Security WebSocket Client.
 *
 * Defines the SchemaCompatibilityInfo interface for schema version negotiation and compatibility checks.
 */
export interface SchemaCompatibilityInfo {
  clientMinSchema: number;
  clientPreferredSchema: number;
  serverMinSchema: number;
  serverMaxSchema: number;
  negotiatedSchema: number;
  isCompatible: boolean;
}

// Already contains SchemaCompatibilityInfo from types.ts
