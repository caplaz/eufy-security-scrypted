/**
 * Light Control Handler
 *
 * Manages light control operations for Eufy devices with floodlight capabilities.
 * Implements OnOff and Brightness interfaces.
 *
 * @module services/interfaces
 */

import { EufyWebSocketClient } from "@caplaz/eufy-security-client";
import { ConsoleLogger } from "../../utils/console-logger";

/**
 * LightControlHandler manages light-related operations
 */
export class LightControlHandler {
  constructor(
    private wsClient: EufyWebSocketClient,
    private serialNumber: string,
    private logger: ConsoleLogger
  ) {}

  /**
   * Turn the light on
   */
  async turnOn(): Promise<void> {
    this.logger.info("💡 Turning light on");
    const api = this.wsClient.commands.device(this.serialNumber);
    await api.setProperty("light", true);
  }

  /**
   * Turn the light off
   */
  async turnOff(): Promise<void> {
    this.logger.info("💡 Turning light off");
    const api = this.wsClient.commands.device(this.serialNumber);
    await api.setProperty("light", false);
  }

  /**
   * Set brightness level
   *
   * @param brightness - Brightness level (0-100)
   */
  async setBrightness(brightness: number): Promise<void> {
    this.logger.info(`💡 Setting brightness to ${brightness}%`);

    if (brightness < 0 || brightness > 100) {
      throw new Error("Brightness must be between 0 and 100");
    }

    const api = this.wsClient.commands.device(this.serialNumber);
    await api.setProperty("lightSettingsBrightnessManual", brightness);
  }
}
