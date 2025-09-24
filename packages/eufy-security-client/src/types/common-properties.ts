// Common properties shared by both devices and stations.
//
// Defines the CommonEufyProperties interface for use in device and station property typing.
// Used throughout the client and plugin for type safety.

export interface CommonEufyProperties {
  name: string;
  model: string;
  serialNumber: string;
  hardwareVersion: string;
  softwareVersion: string;
  type: number;
}
