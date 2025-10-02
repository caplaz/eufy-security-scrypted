/**
 * Refresh Service
 *
 * Manages device property refresh operations.
 * Handles scheduled and user-initiated refreshes.
 *
 * @module services/device
 */

import { DeviceProperties } from "@caplaz/eufy-security-client";
import { ConsoleLogger } from "../../utils/console-logger";

/**
 * Device command API interface for refresh operations
 */
export interface IDeviceRefreshAPI {
  getProperties(): Promise<{ properties: DeviceProperties }>;
}

/**
 * Refresh complete callback
 */
export type RefreshCompleteCallback = (properties: DeviceProperties) => void;

/**
 * Refresh error callback
 */
export type RefreshErrorCallback = (error: Error) => void;

/**
 * RefreshService handles device property refresh operations
 *
 * This service:
 * - Manages refresh frequency
 * - Handles property retrieval from API
 * - Notifies listeners of successful/failed refreshes
 * - Supports both scheduled and manual refreshes
 */
export class RefreshService {
  private readonly DEFAULT_REFRESH_FREQUENCY = 600; // 10 minutes in seconds
  private refreshCompleteCallbacks = new Set<RefreshCompleteCallback>();
  private refreshErrorCallbacks = new Set<RefreshErrorCallback>();

  constructor(
    private deviceApi: IDeviceRefreshAPI,
    private logger: ConsoleLogger
  ) {}

  /**
   * Get refresh frequency in seconds
   *
   * @returns Refresh interval in seconds
   */
  getRefreshFrequency(): number {
    return this.DEFAULT_REFRESH_FREQUENCY;
  }

  /**
   * Refresh device properties
   *
   * Fetches latest properties from the device API.
   * Notifies listeners on success or failure.
   *
   * @param refreshInterface - Specific interface to refresh (currently unused, refreshes all)
   * @param userInitiated - Whether refresh was initiated by user
   * @returns Promise that resolves when refresh is complete
   */
  async refresh(
    refreshInterface?: string,
    userInitiated?: boolean
  ): Promise<DeviceProperties | undefined> {
    // Currently we don't have a way to refresh a single property,
    // so we always refresh everything
    if (refreshInterface) {
      this.logger.debug(
        `Refresh requested for interface ${refreshInterface}, but refreshing all properties`
      );
    }

    try {
      const logPrefix = userInitiated ? "User-initiated" : "Scheduled";
      this.logger.info(`${logPrefix} refresh starting`);

      const response = await this.deviceApi.getProperties();
      const properties = response.properties;

      this.logger.info(`${logPrefix} refresh completed successfully`);

      // Notify success callbacks
      this.notifyRefreshComplete(properties);

      return properties;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `Failed to refresh device properties: ${errorObj.message}, user initiated: ${userInitiated}`
      );

      // Notify error callbacks
      this.notifyRefreshError(errorObj);

      return undefined;
    }
  }

  /**
   * Subscribe to successful refresh events
   *
   * @param callback - Callback to invoke when refresh completes successfully
   * @returns Unsubscribe function
   */
  onRefreshComplete(callback: RefreshCompleteCallback): () => void {
    this.refreshCompleteCallbacks.add(callback);
    return () => this.refreshCompleteCallbacks.delete(callback);
  }

  /**
   * Subscribe to refresh error events
   *
   * @param callback - Callback to invoke when refresh fails
   * @returns Unsubscribe function
   */
  onRefreshError(callback: RefreshErrorCallback): () => void {
    this.refreshErrorCallbacks.add(callback);
    return () => this.refreshErrorCallbacks.delete(callback);
  }

  /**
   * Notify listeners of successful refresh
   */
  private notifyRefreshComplete(properties: DeviceProperties): void {
    this.refreshCompleteCallbacks.forEach((callback) => {
      try {
        callback(properties);
      } catch (error) {
        this.logger.error(`Error in refresh complete callback: ${error}`);
      }
    });
  }

  /**
   * Notify listeners of refresh error
   */
  private notifyRefreshError(error: Error): void {
    this.refreshErrorCallbacks.forEach((callback) => {
      try {
        callback(error);
      } catch (err) {
        this.logger.error(`Error in refresh error callback: ${err}`);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.refreshCompleteCallbacks.clear();
    this.refreshErrorCallbacks.clear();
  }
}
