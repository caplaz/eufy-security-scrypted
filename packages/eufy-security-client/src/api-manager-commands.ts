/**
 * Enhanced Command API with more elegant type-safe command execution
 *
 * This approach provides several elegant improvements to the current sendCommand implementation:
 *
 * 1. **Overloaded Methods**: Method overloads for better type inference without params
 * 2. **Command Builders**: Fluent builder pattern for complex commands
 * 3. **Smart Defaults**: Intelligent parameter handling with sensible defaults
 * 4. **Enhanced Type Safety**: Better generic constraints and inference
 * 5. **Command Grouping**: Logical organization of related commands
 * 6. **Performance Optimization**: Efficient method dispatch and minimal overhead
 *
 * @example Basic Usage
 * ```typescript
 * // Enhanced command execution
 * await api.commands.device("12345").getProperties();
 * await api.commands.driver().connect();
 * await api.commands.server().startListening();
 *
 * // Direct command execution with automatic parameter inference
 * await api.commands.command(DEVICE_COMMANDS.GET_PROPERTIES, { serialNumber: "12345" });
 * await api.commands.command(DRIVER_COMMANDS.CONNECT); // No params needed
 * ```
 *
 * @public
 * @since 1.0.0
 */

// Forward declaration to avoid circular dependency
export interface ApiManagerInterface {
  sendCommand<T extends SupportedCommandType>(
    command: T,
    params: ParamsForCommand<T>
  ): Promise<ResponseForCommand<T>>;
}

import { ResponseForCommand, SupportedCommandType, ParamsForCommand } from './types/commands';

// Import actual command constants
import { DEVICE_COMMANDS } from './device/constants';
import { STATION_COMMANDS } from './station/constants';
import { DRIVER_COMMANDS } from './driver/constants';
import { SERVER_COMMANDS } from './server/constants';
import { DeviceProperties } from './device/properties';
import { StationProperties } from './station/properties';

/**
 * Enhanced command API for Eufy Security WebSocket API
 *
 * Provides a fluent interface for building and executing commands with improved
 * type safety and developer experience. Supports both direct command execution
 * and builder pattern for complex operations.
 *
 * @public
 * @since 1.0.0
 */
export class EnhancedCommandAPI {
  /**
   * Creates a new EnhancedCommandAPI instance
   *
   * @param apiManager - API manager instance for command execution
   */
  constructor(private apiManager: ApiManagerInterface) {}

  /**
   * Enhanced sendCommand with automatic parameter handling
   *
   * Usage examples:
   * - await api.command(DEVICE_COMMANDS.GET_PROPERTIES, { serialNumber: "12345" })
   * - await api.command(DRIVER_COMMANDS.CONNECT) // No params needed
   * - await api.command(DEVICE_COMMANDS.SET_PROPERTY, { serialNumber: "12345", name: "enabled", value: true })
   */
  async command<T extends SupportedCommandType>(
    command: T,
    ...args: {} extends ParamsForCommand<T> ? [ParamsForCommand<T>?] : [ParamsForCommand<T>]
  ): Promise<ResponseForCommand<T>> {
    const params = (args[0] || {}) as ParamsForCommand<T>;
    return this.apiManager.sendCommand(command, params);
  }

  /**
   * Device command builder for more elegant device operations
   *
   * Usage: await api.device("12345").getProperties()
   *        await api.device("12345").setProperty("enabled", true)
   */
  device(serialNumber: string) {
    return new DeviceCommandBuilder(serialNumber, this);
  }

  /**
   * Station command builder for more elegant station operations
   *
   * Usage: await api.station("12345").getProperties()
   *        await api.station("12345").setGuardMode("home")
   */
  station(serialNumber: string) {
    return new StationCommandBuilder(serialNumber, this);
  }

  /**
   * Driver command builder for driver operations
   *
   * Usage: await api.driver().connect()
   *        await api.driver().isConnected()
   */
  driver() {
    return new DriverCommandBuilder(this);
  }

  /**
   * Server command builder for server operations
   *
   * Usage: await api.server().startListening()
   *        await api.server().setApiSchema(21)
   */
  server() {
    return new ServerCommandBuilder(this);
  }
}

/**
 * Device command builder with fluent interface
 *
 * Provides a convenient way to execute device-specific commands with automatic
 * serial number injection and type safety.
 *
 * @public
 */
export class DeviceCommandBuilder {
  /**
   * Creates a new DeviceCommandBuilder instance
   *
   * @param serialNumber - Device serial number for all commands
   * @param api - Enhanced command API instance
   */
  constructor(
    private serialNumber: string,
    private api: EnhancedCommandAPI
  ) {}

  /**
   * Get all properties for this device
   *
   * @returns Promise resolving to device properties object
   *
   * @example
   * ```typescript
   * const properties = await api.device("T8210N20123456789").getProperties();
   * console.log('Device name:', properties.name);
   * ```
   */
  async getProperties() {
    return this.api.command(DEVICE_COMMANDS.GET_PROPERTIES, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Get device properties metadata
   */
  async getPropertiesMetadata() {
    return this.api.command(DEVICE_COMMANDS.GET_PROPERTIES_METADATA, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Check if the device has a specific property
   */
  async hasProperty(propertyName: keyof DeviceProperties) {
    return this.api.command(DEVICE_COMMANDS.HAS_PROPERTY, {
      serialNumber: this.serialNumber,
      propertyName,
    });
  }

  /**
   * Check if the device supports a specific command
   */
  async hasCommand(commandName: string) {
    return this.api.command(DEVICE_COMMANDS.HAS_COMMAND, {
      serialNumber: this.serialNumber,
      commandName,
    });
  }

  /**
   * Get a list of commands supported by the device
   */
  async getCommands() {
    return this.api.command(DEVICE_COMMANDS.GET_COMMANDS, {
      serialNumber: this.serialNumber,
    });
  }

  // Streaming operations
  /**
   * Check if the device is currently livestreaming
   */
  async isLivestreaming() {
    return this.api.command(DEVICE_COMMANDS.IS_LIVESTREAMING, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Start livestreaming from the device
   *
   * @returns Promise resolving when livestream starts successfully
   * @throws {Error} If device doesn't support livestreaming or command fails
   *
   * @example
   * ```typescript
   * await api.device("T8210N20123456789").startLivestream();
   * console.log('Livestream started');
   * ```
   */
  async startLivestream() {
    return this.api.command(DEVICE_COMMANDS.START_LIVESTREAM, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Stop livestreaming on the device
   *
   * @returns Promise resolving when livestream stops successfully
   *
   * @example
   * ```typescript
   * await api.device("T8210N20123456789").stopLivestream();
   * console.log('Livestream stopped');
   * ```
   */
  async stopLivestream() {
    return this.api.command(DEVICE_COMMANDS.STOP_LIVESTREAM, {
      serialNumber: this.serialNumber,
    });
  }

  // RTSP streaming
  /**
   * Check if RTSP livestreaming is active
   */
  async isRtspLivestreaming() {
    return this.api.command(DEVICE_COMMANDS.IS_RTSP_LIVESTREAMING, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Start RTSP livestreaming
   */
  async startRtspLivestream() {
    return this.api.command(DEVICE_COMMANDS.START_RTSP_LIVESTREAM, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Stop RTSP livestreaming
   */
  async stopRtspLivestream() {
    return this.api.command(DEVICE_COMMANDS.STOP_RTSP_LIVESTREAM, {
      serialNumber: this.serialNumber,
    });
  }

  // Download operations
  /**
   * Check if the device is currently downloading
   */
  async isDownloading() {
    return this.api.command(DEVICE_COMMANDS.IS_DOWNLOADING, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Start downloading with the device
   */
  async startDownload(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.START_DOWNLOAD>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.START_DOWNLOAD, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Cancel an ongoing download
   */
  async cancelDownload() {
    return this.api.command(DEVICE_COMMANDS.CANCEL_DOWNLOAD, {
      serialNumber: this.serialNumber,
    });
  }

  // Control operations
  /**
   * Trigger the device alarm
   */
  async triggerAlarm(
    params?: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.TRIGGER_ALARM>, 'serialNumber'>
  ) {
    // Ensure 'seconds' is always a number (default to 0 if not provided)
    const seconds = params && typeof params['seconds'] === 'number' ? params['seconds'] : 0;
    return this.api.command(DEVICE_COMMANDS.TRIGGER_ALARM, {
      serialNumber: this.serialNumber,
      seconds,
      ...params,
    });
  }

  /**
   * Reset the device alarm
   */
  async resetAlarm() {
    return this.api.command(DEVICE_COMMANDS.RESET_ALARM, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Pan and tilt the device camera
   */
  async panAndTilt(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.PAN_AND_TILT>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.PAN_AND_TILT, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Calibrate the device
   */
  async calibrate() {
    return this.api.command(DEVICE_COMMANDS.CALIBRATE, {
      serialNumber: this.serialNumber,
    });
  }

  // Property operations with type safety
  /**
   * Set a property on the device
   */
  async setProperty<K extends keyof DeviceProperties>(name: K, value: any) {
    return this.api.command(DEVICE_COMMANDS.SET_PROPERTY, {
      serialNumber: this.serialNumber,
      name,
      value,
    });
  }

  // Communication
  /**
   * Send a quick response from the device
   */
  async quickResponse(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.QUICK_RESPONSE>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.QUICK_RESPONSE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Get the list of voices supported by the device
   */
  async getVoices() {
    return this.api.command(DEVICE_COMMANDS.GET_VOICES, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Start the talkback feature
   */
  async startTalkback() {
    return this.api.command(DEVICE_COMMANDS.START_TALKBACK, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Stop the talkback feature
   */
  async stopTalkback() {
    return this.api.command(DEVICE_COMMANDS.STOP_TALKBACK, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Check if a talkback session is ongoing
   */
  async isTalkbackOngoing() {
    return this.api.command(DEVICE_COMMANDS.IS_TALKBACK_ONGOING, {
      serialNumber: this.serialNumber,
    });
  }

  // Lock operations
  /**
   * Calibrate the lock mechanism
   */
  async calibrateLock() {
    return this.api.command(DEVICE_COMMANDS.CALIBRATE_LOCK, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Unlock the device
   */
  async unlock() {
    return this.api.command(DEVICE_COMMANDS.UNLOCK, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Snooze the device (temporary disable)
   */
  async snooze(params?: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SNOOZE>, 'serialNumber'>) {
    return this.api.command(DEVICE_COMMANDS.SNOOZE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  // User management
  /**
   * Add a new user to the device
   */
  async addUser(params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.ADD_USER>, 'serialNumber'>) {
    return this.api.command(DEVICE_COMMANDS.ADD_USER, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Delete a user from the device
   */
  async deleteUser(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.DELETE_USER>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.DELETE_USER, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Get the list of users configured on the device
   */
  async getUsers() {
    return this.api.command(DEVICE_COMMANDS.GET_USERS, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Update user information
   */
  async updateUser(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.UPDATE_USER>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.UPDATE_USER, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Update a user's passcode
   */
  async updateUserPasscode(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.UPDATE_USER_PASSCODE>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.UPDATE_USER_PASSCODE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Update a user's schedule
   */
  async updateUserSchedule(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.UPDATE_USER_SCHEDULE>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.UPDATE_USER_SCHEDULE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Verify a user's PIN
   */
  async verifyPin(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.VERIFY_PIN>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.VERIFY_PIN, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  // Device control settings
  /**
   * Open the device (wake up from sleep)
   */
  async open() {
    return this.api.command(DEVICE_COMMANDS.OPEN, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Set the status LED behavior
   */
  async setStatusLed(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_STATUS_LED>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_STATUS_LED, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure auto night vision settings
   */
  async setAutoNightVision(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_AUTO_NIGHT_VISION>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_AUTO_NIGHT_VISION, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure motion detection settings
   */
  async setMotionDetection(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_MOTION_DETECTION>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_MOTION_DETECTION, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure sound detection settings
   */
  async setSoundDetection(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_SOUND_DETECTION>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_SOUND_DETECTION, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure pet detection settings
   */
  async setPetDetection(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_PET_DETECTION>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_PET_DETECTION, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure RTSP stream settings
   */
  async setRtspStream(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_RTSP_STREAM>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_RTSP_STREAM, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure anti-theft detection settings
   */
  async setAntiTheftDetection(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_ANTI_THEFT_DETECTION>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_ANTI_THEFT_DETECTION, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Configure watermark settings for the device
   */
  async setWatermark(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.SET_WATERMARK>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.SET_WATERMARK, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Enable or activate the device
   */
  async enableDevice(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.ENABLE_DEVICE>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.ENABLE_DEVICE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Lock the device (secure it)
   */
  async lockDevice(
    params: Omit<ParamsForCommand<typeof DEVICE_COMMANDS.LOCK_DEVICE>, 'serialNumber'>
  ) {
    return this.api.command(DEVICE_COMMANDS.LOCK_DEVICE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }
}

/**
 * Station command builder with fluent interface
 */
export class StationCommandBuilder {
  constructor(
    private serialNumber: string,
    private api: EnhancedCommandAPI
  ) {}

  /**
   * Get station properties
   */
  async getProperties() {
    return this.api.command(STATION_COMMANDS.GET_PROPERTIES, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Get station properties metadata
   */
  async getPropertiesMetadata() {
    return this.api.command(STATION_COMMANDS.GET_PROPERTIES_METADATA, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Check if the station has a specific property
   */
  async hasProperty(propertyName: keyof StationProperties) {
    return this.api.command(STATION_COMMANDS.HAS_PROPERTY, {
      serialNumber: this.serialNumber,
      propertyName,
    });
  }

  /**
   * Check if the station supports a specific command
   */
  async hasCommand(commandName: string) {
    return this.api.command(STATION_COMMANDS.HAS_COMMAND, {
      serialNumber: this.serialNumber,
      commandName,
    });
  }

  /**
   * Get a list of commands supported by the station
   */
  async getCommands() {
    return this.api.command(STATION_COMMANDS.GET_COMMANDS, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Check if the station is connected
   */
  async isConnected() {
    return this.api.command(STATION_COMMANDS.IS_CONNECTED, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Connect the station
   */
  async connect() {
    return this.api.command(STATION_COMMANDS.CONNECT, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Disconnect the station
   */
  async disconnect() {
    return this.api.command(STATION_COMMANDS.DISCONNECT, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Set a property on the station
   */
  async setProperty<K extends keyof StationProperties>(name: K, value: any) {
    return this.api.command(STATION_COMMANDS.SET_PROPERTY, {
      serialNumber: this.serialNumber,
      name,
      value,
    });
  }

  /**
   * Trigger the station alarm
   */
  async triggerAlarm(
    params?: Omit<ParamsForCommand<typeof STATION_COMMANDS.TRIGGER_ALARM>, 'serialNumber'>
  ) {
    // Ensure 'seconds' is always a number (default to 0 if not provided)
    const seconds = params && typeof params['seconds'] === 'number' ? params['seconds'] : 0;
    return this.api.command(STATION_COMMANDS.TRIGGER_ALARM, {
      serialNumber: this.serialNumber,
      seconds,
      ...params,
    });
  }

  /**
   * Reset the station alarm
   */
  async resetAlarm() {
    return this.api.command(STATION_COMMANDS.RESET_ALARM, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Reboot the station
   */
  async reboot() {
    return this.api.command(STATION_COMMANDS.REBOOT, {
      serialNumber: this.serialNumber,
    });
  }

  /**
   * Activate the station chime
   */
  async chime(params: Omit<ParamsForCommand<typeof STATION_COMMANDS.CHIME>, never>) {
    return this.api.command(STATION_COMMANDS.CHIME, {
      ...params,
    });
  }

  /**
   * Download an image from the station
   */
  async downloadImage(
    params: Omit<ParamsForCommand<typeof STATION_COMMANDS.DOWNLOAD_IMAGE>, never>
  ) {
    return this.api.command(STATION_COMMANDS.DOWNLOAD_IMAGE, {
      ...params,
    });
  }

  /**
   * Query the latest information from the station's database
   */
  async databaseQueryLatestInfo(
    params: Omit<
      ParamsForCommand<typeof STATION_COMMANDS.DATABASE_QUERY_LATEST_INFO>,
      'serialNumber'
    >
  ) {
    return this.api.command(STATION_COMMANDS.DATABASE_QUERY_LATEST_INFO, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Query local data from the station's database
   */
  async databaseQueryLocal(
    params: Omit<ParamsForCommand<typeof STATION_COMMANDS.DATABASE_QUERY_LOCAL>, 'serialNumber'>
  ) {
    return this.api.command(STATION_COMMANDS.DATABASE_QUERY_LOCAL, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Count database entries by date
   */
  async databaseCountByDate(
    params: Omit<ParamsForCommand<typeof STATION_COMMANDS.DATABASE_COUNT_BY_DATE>, 'serialNumber'>
  ) {
    return this.api.command(STATION_COMMANDS.DATABASE_COUNT_BY_DATE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }

  /**
   * Delete entries from the station's database
   */
  async databaseDelete(
    params: Omit<ParamsForCommand<typeof STATION_COMMANDS.DATABASE_DELETE>, 'serialNumber'>
  ) {
    return this.api.command(STATION_COMMANDS.DATABASE_DELETE, {
      serialNumber: this.serialNumber,
      ...params,
    });
  }
}

/**
 * Driver command builder with fluent interface
 */
export class DriverCommandBuilder {
  constructor(private api: EnhancedCommandAPI) {}

  /**
   * Connect the driver
   */
  async connect() {
    return this.api.command(DRIVER_COMMANDS.CONNECT);
  }

  /**
   * Disconnect the driver
   */
  async disconnect() {
    return this.api.command(DRIVER_COMMANDS.DISCONNECT);
  }

  /**
   * Check if the driver is connected
   */
  async isConnected() {
    return this.api.command(DRIVER_COMMANDS.IS_CONNECTED);
  }

  /**
   * Check if the push service is connected
   */
  async isPushConnected() {
    return this.api.command(DRIVER_COMMANDS.IS_PUSH_CONNECTED);
  }

  /**
   * Check if the MQTT service is connected
   */
  async isMqttConnected() {
    return this.api.command(DRIVER_COMMANDS.IS_MQTT_CONNECTED);
  }

  /**
   * Set the verification code for the driver
   */
  async setVerifyCode(params: ParamsForCommand<typeof DRIVER_COMMANDS.SET_VERIFY_CODE>) {
    return this.api.command(DRIVER_COMMANDS.SET_VERIFY_CODE, params);
  }

  /**
   * Set the captcha for the driver
   */
  async setCaptcha(params: ParamsForCommand<typeof DRIVER_COMMANDS.SET_CAPTCHA>) {
    return this.api.command(DRIVER_COMMANDS.SET_CAPTCHA, params);
  }

  /**
   * Refresh the poll data
   */
  async pollRefresh() {
    return this.api.command(DRIVER_COMMANDS.POLL_REFRESH);
  }

  /**
   * Get video event data
   */
  async getVideoEvents(params: ParamsForCommand<typeof DRIVER_COMMANDS.GET_VIDEO_EVENTS>) {
    return this.api.command(DRIVER_COMMANDS.GET_VIDEO_EVENTS, params);
  }

  /**
   * Get alarm event data
   */
  async getAlarmEvents(params: ParamsForCommand<typeof DRIVER_COMMANDS.GET_ALARM_EVENTS>) {
    return this.api.command(DRIVER_COMMANDS.GET_ALARM_EVENTS, params);
  }

  /**
   * Get history event data
   */
  async getHistoryEvents(params: ParamsForCommand<typeof DRIVER_COMMANDS.GET_HISTORY_EVENTS>) {
    return this.api.command(DRIVER_COMMANDS.GET_HISTORY_EVENTS, params);
  }

  /**
   * Set the log level for the driver
   */
  async setLogLevel(params: ParamsForCommand<typeof DRIVER_COMMANDS.SET_LOG_LEVEL>) {
    return this.api.command(DRIVER_COMMANDS.SET_LOG_LEVEL, params);
  }

  /**
   * Get the current log level
   */
  async getLogLevel() {
    return this.api.command(DRIVER_COMMANDS.GET_LOG_LEVEL);
  }

  /**
   * Start listening to logs
   */
  async startListeningLogs() {
    return this.api.command(DRIVER_COMMANDS.START_LISTENING_LOGS);
  }

  /**
   * Stop listening to logs
   */
  async stopListeningLogs() {
    return this.api.command(DRIVER_COMMANDS.STOP_LISTENING_LOGS);
  }

  /**
   * Check if log listening is active
   */
  async isListeningLogs() {
    return this.api.command(DRIVER_COMMANDS.IS_LISTENING_LOGS);
  }
}

/**
 * Server command builder with fluent interface
 */
export class ServerCommandBuilder {
  constructor(private api: EnhancedCommandAPI) {}

  /**
   * Start the server listening for connections
   */
  async startListening() {
    return this.api.command(SERVER_COMMANDS.START_LISTENING);
  }

  /**
   * Set the API schema version for the server
   */
  async setApiSchema(schemaVersion: number) {
    return this.api.command(SERVER_COMMANDS.SET_API_SCHEMA, { schemaVersion });
  }
}
