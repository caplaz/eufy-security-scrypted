/**
 * Unified driver properties interface for Eufy driver
 *
 * Contains all possible driver properties, including connection and log state fields.
 * Used for type safety and property mapping throughout the client and plugin.
 */

/**
 * Unified driver properties interface.
 * Extend as needed for driver-level properties.
 */
export interface DriverProperties {
  // Example driver properties (customize as needed)
  connected: boolean;
  pushConnected: boolean;
  mqttConnected?: boolean;
  logLevel?: string;
}

export type DriverPropertyName = keyof DriverProperties;
export type DriverProperty = {
  name: DriverPropertyName;
  value: DriverProperties[DriverPropertyName];
};
