/**
 * Light Control Service
 *
 * Manages light operations for Eufy devices with spotlight/floodlight capabilities.
 * Handles on/off control and brightness adjustment.
 *
 * @module services/control
 */

import { ConsoleLogger } from "../../utils/console-logger";
import { DeviceApi } from "./types";

/**
 * LightControlService handles light operations
 *
 * This service manages light control for Eufy devices:
 * - Turn light on/off
 * - Adjust brightness level
 * - Property updates via device API
 *
 * Note: State updates are received via property change events
 * from the WebSocket connection, so these methods don't update
 * local state directly.
 */
export class LightControlService {
  constructor(
    private deviceApi: DeviceApi,
    private logger: ConsoleLogger
  ) {}

  /**
   * Turn light on
   *
   * State will be updated via property change event from WebSocket
   */
  async turnOn(): Promise<void> {
    await this.deviceApi.setProperty("light", true);
    this.logger.info("Light turned on");
  }

  /**
   * Turn light off
   *
   * State will be updated via property change event from WebSocket
   */
  async turnOff(): Promise<void> {
    await this.deviceApi.setProperty("light", false);
    this.logger.info("Light turned off");
  }

  /**
   * Set brightness level
   *
   * @param brightness - Brightness level (0-100)
   * State will be updated via property change event from WebSocket
   */
  async setBrightness(brightness: number): Promise<void> {
    // Validate brightness range
    if (brightness < 0 || brightness > 100) {
      throw new Error(
        `Invalid brightness value: ${brightness}. Must be between 0 and 100.`
      );
    }

    await this.deviceApi.setProperty(
      "lightSettingsBrightnessManual",
      brightness
    );
    this.logger.info(`Light brightness set to ${brightness}%`);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.logger.debug("Light control service disposed");
  }
}
