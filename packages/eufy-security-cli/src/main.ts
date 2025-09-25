#!/usr/bin/env node

/**
 * CLI entry point for Eufy Camera CLI
 * Handles command parsing and execution
 */

import { CLIApplication } from "./cli-application";

async function main() {
  try {
    // Get command-line arguments (skip node and script name)
    const args = process.argv.slice(2);

    // Handle version flag
    if (args.includes("--version") || args.includes("-V")) {
      CLIApplication.displayVersion();
      process.exit(0);
    }

    // Handle commands flag
    if (args.includes("--commands")) {
      CLIApplication.displayCommands();
      process.exit(0);
    }

    // Create and run CLI application
    const app = new CLIApplication();
    await app.run(args);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

if (require.main === module) {
  main();
}
