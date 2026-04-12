/**
 * Schema compatibility and negotiation types for Eufy Security WebSocket Client.
 *
 * Defines the SchemaCompatibilityInfo interface for schema version negotiation and compatibility checks.
 *
 * Server schema version history (eufy-security-ws npm package versions):
 *   schema 13  — eufy-security-ws ^1.6.x  (CLIENT_MIN_SCHEMA)
 *   schema 21  — eufy-security-ws ^2.1.0  (CLIENT_PREFERRED_SCHEMA)
 *     Added: station.database_query_by_date command + "database query by date" event
 *     Added: station "connection error" event
 *
 * This library defines its own protocol types and does NOT import from the eufy-security-ws
 * npm package at runtime. The Docker container (bropat/eufy-security-ws) is the runtime peer.
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
