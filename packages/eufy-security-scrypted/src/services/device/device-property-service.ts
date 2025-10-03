/**
 * Device Property Service
 *
 * Manages device property retrieval, updates, and synchronization.
 * Handles property change events and maintains property cache.
 *
 * @module services/device
 */

import {
  EufyWebSocketClient,
  DeviceProperties,
  DEVICE_EVENTS,
  DevicePropertyChangedEventPayload,
  EVENT_SOURCES,
} from "@caplaz/eufy-security-client";
import { ConsoleLogger } from "../../utils/console-logger";

/**
 * Device property change event
 */
export interface DevicePropertyUpdate {
  name: keyof DeviceProperties;
  value: any;
}

/**
 * Callback for property change events
 */
export type PropertyChangeCallback = (update: DevicePropertyUpdate) => void;

/**
 * DevicePropertyService handles all device property operations
 */
export class DevicePropertyService {
  private properties?: DeviceProperties;
  private propertiesLoadedPromise: Promise<void>;
  private propertyChangeCallbacks = new Set<PropertyChangeCallback>();
  private eventListenerRemover?: () => boolean;

  constructor(
    private wsClient: EufyWebSocketClient,
    private serialNumber: string,
    private logger: ConsoleLogger
  ) {
    this.propertiesLoadedPromise = this.loadInitialProperties();
    this.setupPropertyChangeListener();
  }

  /**
   * Get current device properties
   *
   * @returns Current properties or undefined if not loaded
   */
  getProperties(): DeviceProperties | undefined {
    return this.properties;
  }

  /**
   * Wait for properties to be loaded
   *
   * @returns Promise that resolves when properties are loaded
   */
  async waitForProperties(): Promise<DeviceProperties> {
    await this.propertiesLoadedPromise;
    return this.properties!;
  }

  /**
   * Refresh properties from the server
   *
   * @returns Updated properties
   */
  async refreshProperties(): Promise<DeviceProperties> {
    this.logger.debug("Refreshing device properties");

    const api = this.wsClient.commands.device(this.serialNumber);
    const response = await api.getProperties();
    this.properties = response.properties;

    this.logger.debug(`Properties refreshed for device ${this.serialNumber}`);
    return this.properties;
  }

  /**
   * Update a device property
   *
   * @param propertyName - Name of the property to update
   * @param value - New value for the property
   */
  async updateProperty(
    propertyName: keyof DeviceProperties,
    value: any
  ): Promise<void> {
    this.logger.info(`Updating property ${propertyName} to ${value}`);

    const api = this.wsClient.commands.device(this.serialNumber);
    await api.setProperty(propertyName, value);

    // Update local cache
    if (this.properties) {
      this.properties = {
        ...this.properties,
        [propertyName]: value,
      };
    }
  }

  /**
   * Subscribe to property change events
   *
   * @param callback - Callback to invoke on property changes
   * @returns Unsubscribe function
   */
  onPropertyChange(callback: PropertyChangeCallback): () => void {
    this.propertyChangeCallbacks.add(callback);
    return () => this.propertyChangeCallbacks.delete(callback);
  }

  /**
   * Get a specific property value
   *
   * @param propertyName - Name of the property to get
   * @returns Property value or undefined if not available
   */
  getProperty<K extends keyof DeviceProperties>(
    propertyName: K
  ): DeviceProperties[K] | undefined {
    return this.properties?.[propertyName];
  }

  /**
   * Check if a property exists
   *
   * @param propertyName - Name of the property to check
   * @returns true if property exists
   */
  hasProperty(propertyName: keyof DeviceProperties): boolean {
    return this.properties !== undefined && propertyName in this.properties;
  }

  /**
   * Load initial properties from the server
   */
  private async loadInitialProperties(): Promise<void> {
    try {
      this.logger.debug(
        `Loading initial properties for device ${this.serialNumber}`
      );

      const api = this.wsClient.commands.device(this.serialNumber);
      const response = await api.getProperties();
      this.properties = response.properties;

      this.logger.debug(
        `Initial properties loaded for device ${this.serialNumber}`
      );
    } catch (error) {
      this.logger.error(`Failed to load initial properties: ${error}`);
      throw error;
    }
  }

  /**
   * Set up listener for property change events
   */
  private setupPropertyChangeListener(): void {
    this.eventListenerRemover = this.wsClient.addEventListener(
      DEVICE_EVENTS.PROPERTY_CHANGED,
      (event: DevicePropertyChangedEventPayload) => {
        this.handlePropertyChanged(event);
      },
      {
        source: EVENT_SOURCES.DEVICE,
        serialNumber: this.serialNumber,
      }
    );
  }

  /**
   * Handle property change event from WebSocket
   */
  private handlePropertyChanged(
    event: DevicePropertyChangedEventPayload
  ): void {
    const { name, value } = event;

    this.logger.debug(`Property changed: ${name} = ${value}`);

    // Update local cache
    if (this.properties) {
      this.properties = {
        ...this.properties,
        [name]: value,
      };
    }

    // Notify callbacks
    const update: DevicePropertyUpdate = { name, value };
    this.propertyChangeCallbacks.forEach((callback) => {
      try {
        callback(update);
      } catch (error) {
        this.logger.error(`Error in property change callback: ${error}`);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.eventListenerRemover) {
      this.eventListenerRemover();
      this.eventListenerRemover = undefined;
    }
    this.propertyChangeCallbacks.clear();
  }
}
