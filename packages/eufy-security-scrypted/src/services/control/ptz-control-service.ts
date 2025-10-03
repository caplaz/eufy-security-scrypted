/**
 * PTZ Control Service
 *
 * Manages pan/tilt/zoom operations for Eufy devices.
 * Handles PTZ capability detection and command execution.
 *
 * @module services/control
 */

import { PanTiltZoomCommand } from "@scrypted/sdk";
import {
  PanTiltDirection,
  getDeviceCapabilities,
} from "@caplaz/eufy-security-client";
import { ConsoleLogger } from "../../utils/console-logger";
import { DeviceApi, PtzCapabilities } from "./types";

/**
 * PtzControlService handles pan/tilt/zoom operations
 *
 * This service manages PTZ control for compatible Eufy cameras:
 * - Capability detection based on device type
 * - Command routing to appropriate API methods
 * - Direction mapping for pan and tilt operations
 */
export class PtzControlService {
  constructor(
    private deviceApi: DeviceApi,
    private getDeviceType: () => number | undefined,
    private logger: ConsoleLogger
  ) {}

  /**
   * Update PTZ capabilities based on device type
   *
   * @returns PTZ capabilities for the device
   */
  updateCapabilities(): PtzCapabilities {
    const deviceType = this.getDeviceType();
    const capabilities = getDeviceCapabilities(deviceType || 0);

    return {
      pan: capabilities.panTilt,
      tilt: capabilities.panTilt,
      zoom: false, // No Eufy cameras currently support zoom
    };
  }

  /**
   * Execute a PTZ command
   *
   * Handles pan and tilt commands by routing to the appropriate
   * device API method. Tilt commands are prioritized over pan
   * commands when both are provided.
   *
   * @param command - PTZ command from Scrypted
   * @throws Error if command is not implemented or unsupported
   */
  async executeCommand(command: PanTiltZoomCommand): Promise<void> {
    // Tilt has priority over pan if both are provided
    if (command.tilt !== undefined) {
      await this.executeTilt(command.tilt);
      return;
    }

    if (command.pan !== undefined) {
      await this.executePan(command.pan);
      return;
    }

    throw new Error("Method not implemented.");
  }

  /**
   * Execute tilt command
   *
   * @param tiltValue - Positive for up, negative for down
   */
  private async executeTilt(tiltValue: number): Promise<void> {
    const direction =
      tiltValue > 0 ? PanTiltDirection.UP : PanTiltDirection.DOWN;

    await this.deviceApi.panAndTilt({ direction });

    this.logger.info(`Tilted camera ${tiltValue > 0 ? "up" : "down"}`);
  }

  /**
   * Execute pan command
   *
   * @param panValue - Positive for right, negative for left
   */
  private async executePan(panValue: number): Promise<void> {
    const direction =
      panValue > 0 ? PanTiltDirection.RIGHT : PanTiltDirection.LEFT;

    await this.deviceApi.panAndTilt({ direction });

    this.logger.info(`Panned camera ${panValue > 0 ? "right" : "left"}`);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.logger.debug("PTZ control service disposed");
  }
}
