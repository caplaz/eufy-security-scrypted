/**
 * Command exports
 */

export { BaseCommand } from "./base-command";
export { StreamCommand } from "./stream-command";
export { ListDevicesCommand } from "./list-devices-command";
export { DeviceInfoCommand } from "./device-info-command";
export { MonitorCommand } from "./monitor-command";

// Command registry for easy access
import { CommandHandler } from "../interfaces";
import { StreamCommand } from "./stream-command";
import { ListDevicesCommand } from "./list-devices-command";
import { DeviceInfoCommand } from "./device-info-command";
import { MonitorCommand } from "./monitor-command";

export function createCommandRegistry(
  context: any
): Map<string, CommandHandler> {
  const registry = new Map<string, CommandHandler>();

  // Register all available commands
  const commands = [
    new StreamCommand(context),
    new ListDevicesCommand(context),
    new DeviceInfoCommand(context),
    new MonitorCommand(context),
  ];

  commands.forEach((command) => {
    registry.set(command.name, command);
  });

  return registry;
}

export function getAvailableCommands(): string[] {
  return ["stream", "list-devices", "device-info", "monitor"];
}
