import { ParsedArgs } from "./interfaces";

/**
 * CLI argument parser for Eufy Camera CLI Streamer
 *
 * Handles comprehensive parsing and validation of command-line arguments with:
 * - Support for multiple commands (stream, list-devices, device-info, monitor)
 * - Flexible argument formats (short and long flags)
 * - Detailed validation with helpful error messages
 * - Built-in help system with usage examples
 * - Input sanitization and format validation
 *
 * @public
 */
export class CLIParser {
  private static readonly DEFAULT_PORT = 0; // 0 = system assigns random available port
  private static readonly WS_URL_REGEX = /^wss?:\/\/[\w.-]+(:\d+)?$/;
  private static readonly CAMERA_SERIAL_REGEX = /^[A-Z0-9]{10,20}$/;

  /**
   * Parse command-line arguments into structured format
   *
   * Processes raw command-line arguments and converts them into a typed
   * ParsedArgs object with proper validation and default values.
   *
   * @param args - Array of command-line arguments (excluding node and script name)
   * @returns Parsed and validated arguments object
   * @throws {Error} If arguments are malformed or invalid
   *
   * @example
   * ```typescript
   * const args = CLIParser.parse(['stream', '--ws-host', 'localhost:3000', '--camera-serial', 'ABC123']);
   * console.log(args.command); // 'stream'
   * console.log(args.wsHost); // 'localhost:3000'
   * ```
   */
  static parse(args: string[]): ParsedArgs {
    const result: ParsedArgs = {
      wsHost: "",
      cameraSerial: "",
      port: this.DEFAULT_PORT,
      verbose: false,
      help: false,
    };

    // Check if first argument is a command
    if (args.length > 0 && !args[0].startsWith("-")) {
      const possibleCommand = args[0];
      const validCommands = ["driver", "device"];

      if (validCommands.includes(possibleCommand)) {
        result.command = possibleCommand;
        args = args.slice(1); // Remove command from args

        // Check for subcommands
        if (
          possibleCommand === "driver" &&
          args.length > 0 &&
          !args[0].startsWith("-")
        ) {
          const possibleSubcommand = args[0];
          const validSubcommands = [
            "status",
            "connect",
            "set_captcha",
            "set_verify_code",
          ];

          if (validSubcommands.includes(possibleSubcommand)) {
            result.subcommand = possibleSubcommand;
            args = args.slice(1); // Remove subcommand from args

            // For set_captcha, the next arguments should be captchaId and captcha code
            if (possibleSubcommand === "set_captcha") {
              if (
                args.length < 2 ||
                args[0].startsWith("-") ||
                args[1].startsWith("-")
              ) {
                throw new Error(
                  "Both captcha ID and captcha code are required for set_captcha command"
                );
              }
              result.captchaId = args[0];
              result.captcha = args[1];
              args = args.slice(2); // Remove captchaId and captcha from args
            }
            // For set_verify_code, the next arguments should be captchaId and verify code
            else if (possibleSubcommand === "set_verify_code") {
              if (
                args.length < 2 ||
                args[0].startsWith("-") ||
                args[1].startsWith("-")
              ) {
                throw new Error(
                  "Both captcha ID and verification code are required for set_verify_code command"
                );
              }
              result.verifyCodeId = args[0];
              result.verifyCode = args[1];
              args = args.slice(2); // Remove captchaId and verify code from args
            }
          } else {
            throw new Error(
              `Unknown driver subcommand: ${possibleSubcommand}. Valid subcommands: ${validSubcommands.join(", ")}`
            );
          }
        } else if (
          possibleCommand === "device" &&
          args.length > 0 &&
          !args[0].startsWith("-")
        ) {
          const possibleSubcommand = args[0];
          const validSubcommands = ["list", "info", "stream", "monitor"];

          if (validSubcommands.includes(possibleSubcommand)) {
            result.subcommand = possibleSubcommand;
            args = args.slice(1); // Remove subcommand from args
          } else {
            throw new Error(
              `Unknown device subcommand: ${possibleSubcommand}. Valid subcommands: ${validSubcommands.join(", ")}`
            );
          }
        }
      } else {
        throw new Error(
          `Unknown command: ${possibleCommand}. Valid commands: ${validCommands.join(", ")}`
        );
      }
    } else {
      // Default to device stream command if no command specified
      result.command = "device";
      result.subcommand = "stream";
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      switch (arg) {
        case "--ws-host":
        case "-w":
          if (!nextArg || nextArg.startsWith("-")) {
            throw new Error("WebSocket host is required after --ws-host");
          }
          result.wsHost = nextArg;
          i++; // Skip next argument as it's the value
          break;

        case "--camera-serial":
        case "-c":
          if (!nextArg || nextArg.startsWith("-")) {
            throw new Error("Camera serial is required after --camera-serial");
          }
          result.cameraSerial = nextArg;
          i++; // Skip next argument as it's the value
          break;

        case "--port":
        case "-p":
          if (!nextArg || nextArg.startsWith("-")) {
            throw new Error("Port number is required after --port");
          }
          const port = parseInt(nextArg, 10);
          if (isNaN(port) || port < 0 || port > 65535) {
            throw new Error(
              "Port must be a valid number between 0 and 65535 (0 = random port)"
            );
          }
          result.port = port;
          i++; // Skip next argument as it's the value
          break;

        case "--verbose":
        case "-v":
          result.verbose = true;
          break;

        case "--help":
        case "-h":
          result.help = true;
          break;

        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    return result;
  }

  /**
   * Display comprehensive usage instructions and examples
   *
   * Shows detailed help information including:
   * - Command syntax and available options
   * - Usage examples for different scenarios
   * - Media player connection instructions
   * - Troubleshooting tips and common issues
   *
   * @static
   */
  static printUsage(): void {
    const usage = `
🎥 Eufy Camera CLI Streamer

Stream Eufy Security camera feeds directly to media players like ffplay and VLC.

USAGE:
  eufy-security-cli [COMMAND] [OPTIONS]

COMMANDS:
  driver status                     Check the connection status of the driver
  driver connect                    Establish connection to the Eufy Security driver
  driver set_captcha <id> <code>     Set captcha ID and code for 2FA verification
  driver set_verify_code <id> <code> Set captcha ID and verification code for 2FA
  device list                       List all available camera devices
  device info                       Show detailed information about a device
  device stream                     Start streaming from a camera device
  device monitor                    Monitor camera connection status and events

GLOBAL OPTIONS:
  --ws-host, -w <host>              WebSocket server host (e.g., 192.168.7.100:3000)
  --verbose, -v                     Enable verbose logging
  --help, -h                        Show this help message

STREAM COMMAND OPTIONS:
  --camera-serial, -c <serial>      Camera device serial number
  --port, -p <port>                 TCP server port (default: random available port)

EXAMPLES:
  # Establish connection to the driver
  eufy-security-cli driver connect --ws-host 192.168.7.100:3000

  # Check driver connection status
  eufy-security-cli driver status --ws-host 192.168.7.100:3000

  # Set captcha ID and code for 2FA verification
  eufy-security-cli driver set_captcha captcha123 123456 --ws-host 192.168.7.100:3000

  # Set captcha ID and verification code for 2FA
  eufy-security-cli driver set_verify_code captcha123 123456 --ws-host 192.168.7.100:3000

  # List all available devices
  eufy-security-cli device list --ws-host 192.168.7.100:3000

  # Get device information
  eufy-security-cli device info --ws-host 192.168.7.100:3000 --camera-serial ABC1234567890

  # Start streaming with development server
  eufy-security-cli device stream --ws-host 192.168.7.100:3000 --camera-serial ABC1234567890

  # Stream with custom port and verbose logging
  eufy-security-cli device stream -w 192.168.7.100:3000 -c ABC1234567890 -p 8080 -v

  # Monitor camera connection
  eufy-security-cli device monitor --ws-host 192.168.7.100:3000 --camera-serial ABC1234567890

CONNECTING WITH MEDIA PLAYERS:
  # The CLI will display the actual port when streaming starts, e.g.:
  # "TCP Server: localhost:45123"
  
  # Using ffplay (recommended)
  ffplay tcp://localhost:<displayed-port>

  # ffplay with optimized settings
  ffplay -fflags nobuffer -flags low_delay tcp://localhost:<displayed-port>

  # Using VLC
  vlc tcp://localhost:<displayed-port>

  # Using MPV
  mpv tcp://localhost:<displayed-port>

STREAM LIFECYCLE:
  1. CLI connects to WebSocket server and discovers camera
  2. TCP server starts and waits for media player connections
  3. When a player connects, camera streaming begins automatically
  4. Multiple players can connect to the same stream
  5. Stream stops 30 seconds after the last player disconnects

TROUBLESHOOTING:
  # Test WebSocket connectivity
  curl -I http://192.168.7.100:3000

  # Check if TCP port is available
  lsof -i :41855

  # Run with verbose logging for debugging
  eufy-security-cli stream -w 192.168.7.100:3000 -c ABC1234567890 -v

DOCUMENTATION:
  For detailed documentation, examples, and troubleshooting:
  - README.md - Complete CLI documentation with usage examples and troubleshooting

NOTES:
  - WebSocket host should point to a running eufy-security-ws server
  - Camera serial numbers are typically 10-20 alphanumeric characters
  - Output format: Raw H.264 video stream optimized for live streaming
  - Compatible with standard media players and streaming tools
`;

    console.log(usage.trim());
  }

  /**
   * Validate parsed arguments for correctness and completeness
   *
   * Performs comprehensive validation of parsed arguments including:
   * - Required field presence for each command type
   * - Format validation (URLs, serial numbers, ports)
   * - Range validation (port numbers, etc.)
   * - Command-specific requirement checking
   *
   * @param args - Parsed arguments to validate
   * @throws {Error} If validation fails with detailed error message
   *
   * @static
   */
  static validateArgs(args: ParsedArgs): void {
    // Skip validation if help is requested
    if (args.help) {
      return;
    }

    // Validate required arguments
    if (!args.wsHost) {
      throw new Error(
        "WebSocket host is required. Use --ws-host or -w to specify."
      );
    }

    // Validate WebSocket URL format
    this.validateWebSocketUrl(args.wsHost);

    // Command-specific validation
    if (
      args.command === "device" &&
      (args.subcommand === "info" ||
        args.subcommand === "stream" ||
        args.subcommand === "monitor")
    ) {
      if (!args.cameraSerial) {
        const commandName = args.subcommand
          ? `${args.command} ${args.subcommand}`
          : args.command;
        throw new Error(
          `❌ Camera serial is required for the ${commandName} command.\n\n` +
            `Usage: eufy-security-cli ${commandName} --ws-host <host> --camera-serial <serial>\n\n` +
            `💡 To find available device serials, run:\n` +
            `   eufy-security-cli device list --ws-host ${args.wsHost || "<host>"}`
        );
      }
      this.validateCameraSerial(args.cameraSerial);
    }

    // Stream command specific validation
    if (args.command === "stream" && args.port !== undefined) {
      if (args.port < 0 || args.port > 65535) {
        throw new Error(
          `❌ Invalid port number: ${args.port}\n\n` +
            `Port must be between 0 and 65535 (0 = automatic port assignment)\n\n` +
            `Examples:\n` +
            `   --port 0     # Let system assign available port\n` +
            `   --port 8080  # Use specific port 8080`
        );
      }
    }

    // Validate port if specified (only relevant for stream command)
    if (args.port !== undefined) {
      if (args.port < 0 || args.port > 65535) {
        throw new Error("Port must be between 0 and 65535 (0 = random port)");
      }
    }
  }

  /**
   * Validate WebSocket URL format
   * @param wsHost WebSocket host to validate
   * @throws Error if format is invalid
   */
  private static validateWebSocketUrl(wsHost: string): void {
    // Add protocol if missing
    let url = wsHost;
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      url = `ws://${url}`;
    }

    // Validate URL format
    if (!this.WS_URL_REGEX.test(url)) {
      throw new Error(
        `❌ Invalid WebSocket host format: ${wsHost}\n\n` +
          `Expected format: [ws://|wss://]hostname[:port]\n\n` +
          `Valid examples:\n` +
          `   192.168.1.100:3000\n` +
          `   ws://192.168.1.100:3000\n` +
          `   wss://my-server.com:3000\n` +
          `   localhost:3000`
      );
    }

    // Extract hostname and port manually to validate before URL constructor
    const match = url.match(/^wss?:\/\/([^:\/]+)(?::(\d+))?/);
    if (!match) {
      throw new Error(
        `❌ Invalid WebSocket host format: ${wsHost}\n\n` +
          `Expected format: [ws://|wss://]hostname[:port]\n\n` +
          `Valid examples:\n` +
          `   192.168.1.100:3000\n` +
          `   ws://192.168.1.100:3000\n` +
          `   wss://my-server.com:3000\n` +
          `   localhost:3000`
      );
    }

    const hostname = match[1];
    const port = match[2];

    // Validate port if specified
    if (port) {
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(
          `❌ Invalid port number: ${port}\n\n` +
            `Port must be between 1 and 65535\n\n` +
            `Example: ${hostname}:3000`
        );
      }
    }

    // Check if it's a valid IP address or hostname
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    if (ipRegex.test(hostname)) {
      // Validate IP address ranges
      const parts = hostname.split(".").map(Number);
      if (parts.some((part) => part < 0 || part > 255)) {
        throw new Error(
          `❌ Invalid IP address: ${hostname}\n\n` +
            `Each part of the IP address must be between 0 and 255\n\n` +
            `Example: 192.168.1.100:3000`
        );
      }
    } else if (!hostnameRegex.test(hostname)) {
      throw new Error(
        `❌ Invalid hostname: ${hostname}\n\n` +
          `Hostname must contain only letters, numbers, dots, and hyphens\n\n` +
          `Valid examples:\n` +
          `   localhost:3000\n` +
          `   my-server.com:3000\n` +
          `   192.168.1.100:3000`
      );
    }

    // Now try to parse as URL to validate structure (should work now)
    try {
      new URL(url);
    } catch (error) {
      throw new Error(
        `❌ Invalid WebSocket URL: ${url}\n\n` +
          `Please check the format and try again\n\n` +
          `Valid examples:\n` +
          `   192.168.1.100:3000\n` +
          `   ws://192.168.1.100:3000\n` +
          `   wss://my-server.com:3000`
      );
    }
  }

  /**
   * Validate camera serial format
   * @param serial Camera serial to validate
   * @throws Error if format is invalid
   */
  private static validateCameraSerial(serial: string): void {
    if (!this.CAMERA_SERIAL_REGEX.test(serial)) {
      throw new Error(
        `❌ Invalid camera serial format: ${serial}\n\n` +
          `Camera serial must be 10-20 alphanumeric characters (A-Z, 0-9)\n\n` +
          `Valid examples:\n` +
          `   ABC1234567890\n` +
          `   T8410P123456789012\n` +
          `   E123456789\n\n` +
          `💡 To find your camera serial:\n` +
          `   • Check the device label or QR code\n` +
          `   • Use: eufy-security-cli list-devices --ws-host <host>`
      );
    }
  }
}
