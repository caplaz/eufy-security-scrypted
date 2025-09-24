import { BaseCommand } from "../types/commands";
import { SERVER_COMMANDS, ServerCommandType } from "./constants";

/**
 * Base interface for server commands
 */
export interface BaseServerCommand<T extends ServerCommandType>
  extends BaseCommand<T> {}

export interface StartListeningCommand
  extends BaseServerCommand<typeof SERVER_COMMANDS.START_LISTENING> {}

export interface SetApiSchemaCommand
  extends BaseServerCommand<typeof SERVER_COMMANDS.SET_API_SCHEMA> {
  schemaVersion: number;
}

/**
 * Union type for all server commands
 */
export type ServerCommand = StartListeningCommand | SetApiSchemaCommand;
