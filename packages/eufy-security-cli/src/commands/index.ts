/**
 * Command exports
 */

export { BaseCommand } from "./base-command";
export { DeviceCommand } from "./device-command";

// Command registry for easy access
import { CommandHandler } from "../interfaces";
import { DriverCommand } from "./driver-command";
import { DeviceCommand } from "./device-command";

export function createCommandRegistry(
  context: any
): Map<string, CommandHandler> {
  const registry = new Map<string, CommandHandler>();

  // Register all available commands
  const commands = [new DriverCommand(context), new DeviceCommand(context)];

  commands.forEach((command) => {
    registry.set(command.name, command);
  });

  return registry;
}

export function getAvailableCommands(): string[] {
  return ["driver", "device"];
}
