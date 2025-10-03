/**
 * PTZ Control Handler
 *
 * Manages Pan-Tilt-Zoom operations for compatible Eufy cameras.
 *
 * @module services/interfaces
 */

import {
  EufyWebSocketClient,
  PanTiltDirection,
} from "@caplaz/eufy-security-client";
import { PanTiltZoomCommand } from "@scrypted/sdk";
import { Logger, ILogObj } from "tslog";

/**
 * PTZControlHandler manages pan, tilt, and zoom operations
 */
export class PTZControlHandler {
  constructor(
    private wsClient: EufyWebSocketClient,
    private serialNumber: string,
    private logger: Logger<ILogObj>
  ) {}

  /**
   * Execute a PTZ command
   *
   * @param command - PTZ command with pan, tilt, or zoom values
   */
  async executeCommand(command: PanTiltZoomCommand): Promise<void> {
    const api = this.wsClient.commands.device(this.serialNumber);

    // Tilt takes precedence over pan
    if (command.tilt !== undefined) {
      const direction =
        command.tilt > 0 ? PanTiltDirection.UP : PanTiltDirection.DOWN;

      await api.panAndTilt({ direction });
      this.logger.info(
        `🎥 Tilted camera ${direction === PanTiltDirection.UP ? "up" : "down"}`
      );
      return;
    }

    if (command.pan !== undefined) {
      const direction =
        command.pan > 0 ? PanTiltDirection.RIGHT : PanTiltDirection.LEFT;

      await api.panAndTilt({ direction });
      this.logger.info(
        `🎥 Panned camera ${direction === PanTiltDirection.RIGHT ? "right" : "left"}`
      );
      return;
    }

    throw new Error("PTZ command must specify pan or tilt");
  }

  /**
   * Tilt camera up
   */
  async tiltUp(): Promise<void> {
    return this.executeCommand({ tilt: 1 });
  }

  /**
   * Tilt camera down
   */
  async tiltDown(): Promise<void> {
    return this.executeCommand({ tilt: -1 });
  }

  /**
   * Pan camera right
   */
  async panRight(): Promise<void> {
    return this.executeCommand({ pan: 1 });
  }

  /**
   * Pan camera left
   */
  async panLeft(): Promise<void> {
    return this.executeCommand({ pan: -1 });
  }
}
