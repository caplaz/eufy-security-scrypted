/**
 * Main entry point for the Eufy Security Scrypted plugin
 *
 * This file exports the main provider class that Scrypted will instantiate
 * when the plugin is loaded. The plugin provides comprehensive integration
 * with Eufy security devices through the eufy-security-ws WebSocket server.
 *
 * Features:
 * - Device discovery and management
 * - Video streaming with H.264 support using eufy-stream-server
 * - Motion detection and sensor monitoring
 * - Device control (lights, pan/tilt, etc.)
 * - Memory management and performance optimization
 * - HomeKit Secure Video compatibility
 *
 * @public
 * @since 1.0.0
 */

import { EufySecurityProvider } from "./eufy-provider";

export default EufySecurityProvider;
