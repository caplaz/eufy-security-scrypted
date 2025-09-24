/**
 * Eufy Security Device Implementation for Scrypted
 */

import {
  VideoCamera,
  Camera,
  MediaObject,
  ResponseMediaStreamOptions,
  Setting,
  Settings,
  Refresh,
  Battery,
  MotionSensor,
  ScryptedMimeTypes,
  ScryptedDeviceType,
  ScryptedInterface,
} from "@scrypted/sdk";

import { EufyWebSocketClient } from "../../eufy-security-client/dist";
import { StreamServer } from "../../eufy-stream-server/dist";
import { createDebugLogger } from "./utils/debug-logger";

/**
 * Simplified Eufy Security Device
 */
export class EufyDevice
  implements VideoCamera, Settings, Refresh, Battery, MotionSensor
{
  private logger = createDebugLogger("EufyDevice");
  private properties: any = {};
  private isStreaming = false;

  constructor(
    private nativeId: string,
    private console: Console,
    private wsClient: EufyWebSocketClient,
    private streamServer?: StreamServer
  ) {
    this.logger.d("Creating EufyDevice instance", { nativeId });
  }

  async initialize(): Promise<void> {
    try {
      this.logger.d("Initializing device", { nativeId: this.nativeId });
      const deviceSerial = this.nativeId.replace("device_", "");
      const response = await this.wsClient.commands
        .device(deviceSerial)
        .getProperties();
      this.properties = response.properties;
      this.logger.i("Device initialized successfully", {
        deviceSerial,
        name: this.properties.name,
      });
    } catch (error) {
      this.logger.e("Failed to initialize device", {
        error,
        nativeId: this.nativeId,
      });
      throw error;
    }
  }

  // VideoCamera implementation
  async getVideoStream(
    options?: ResponseMediaStreamOptions
  ): Promise<MediaObject> {
    const deviceSerial = this.nativeId.replace("device_", "");

    if (!this.streamServer) {
      throw new Error("Stream server not available");
    }

    try {
      // Start livestream via WebSocket client
      await this.wsClient.commands.device(deviceSerial).startLivestream();
      this.isStreaming = true;

      // Return stream URL - this will depend on the actual MediaObject interface
      const streamUrl = `http://localhost:3001/stream/${deviceSerial}`;

      // For now, return a simple MediaObject - this may need adjustment based on Scrypted SDK
      return streamUrl as any;
    } catch (error) {
      this.logger.e("Failed to get video stream", { error, deviceSerial });
      throw error;
    }
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    return [
      {
        id: "default",
        name: "Default Stream",
        container: "mp4",
        video: {
          codec: "h264",
        },
      },
    ];
  }

  async getPictureOptions(): Promise<ResponseMediaStreamOptions[]> {
    return [];
  }

  async takePicture(
    options?: ResponseMediaStreamOptions
  ): Promise<MediaObject> {
    throw new Error("Picture capture not implemented");
  }

  // Battery implementation
  get batteryLevel(): number {
    return this.properties.battery || 0;
  }

  // MotionSensor implementation
  get motionDetected(): boolean {
    return this.properties.motionDetected || false;
  }

  // Settings implementation
  async getSettings(): Promise<Setting[]> {
    return [
      {
        key: "name",
        title: "Device Name",
        value: this.properties.name || "",
        description: "Name of the device",
      },
      {
        key: "battery",
        title: "Battery Level",
        value: this.properties.battery || 0,
        description: "Current battery level percentage",
        readonly: true,
      },
    ];
  }

  async putSetting(key: string, value: any): Promise<void> {
    const deviceSerial = this.nativeId.replace("device_", "");

    try {
      await this.wsClient.commands
        .device(deviceSerial)
        .setProperty(key as any, value);
      this.properties[key] = value;
      this.logger.i("Device setting updated", { deviceSerial, key, value });
    } catch (error) {
      this.logger.e("Failed to update device setting", { error, key, value });
      throw error;
    }
  }

  // Refresh implementation
  async getRefreshFrequency(): Promise<number> {
    return 60; // Refresh every minute
  }

  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<void> {
    try {
      this.logger.d("Refreshing device", { nativeId: this.nativeId });
      const deviceSerial = this.nativeId.replace("device_", "");
      const response = await this.wsClient.commands
        .device(deviceSerial)
        .getProperties();
      this.properties = response.properties;
    } catch (error) {
      this.logger.e("Failed to refresh device", { error });
    }
  }

  // Cleanup
  async cleanup(): Promise<void> {
    if (this.isStreaming) {
      try {
        const deviceSerial = this.nativeId.replace("device_", "");
        await this.wsClient.commands.device(deviceSerial).stopLivestream();
        this.isStreaming = false;
        this.logger.d("Stopped device stream during cleanup", { deviceSerial });
      } catch (error) {
        this.logger.e("Error stopping stream during cleanup", { error });
      }
    }
  }
}
