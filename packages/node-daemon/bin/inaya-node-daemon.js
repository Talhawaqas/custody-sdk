#!/usr/bin/env node
// packages/node-daemon/bin/inaya-node-daemon.js
import { Command } from "commander";
import { loginCommand } from "../src/commands/login.js";
import { registerCommand } from "../src/commands/register.js";
import { startCommand } from "../src/commands/start.js";
import { serviceInstallCommand, serviceUninstallCommand } from "../src/commands/service.js";

const program = new Command();

program
  .name("inaya-node-daemon")
  .description(
    "Inaya Network node operator daemon -- registers your node and reports heartbeat/telemetry. Does not store or serve shards."
  )
  .version("0.1.0");

program
  .command("login")
  .description("Store your node operator wallet, encrypted at rest. Reads INAYA_PRIVATE_KEY / INAYA_DAEMON_PASSWORD from the environment for unattended use.")
  .action(loginCommand);

program
  .command("register <capacityGB>")
  .description("Register this node on-chain (InayaNodeRegistry) and with the coordinator backend.")
  .option("--api-base-url <url>", "Coordinator backend base URL (falls back to INAYA_API_BASE_URL, then production)")
  .action(registerCommand);

program
  .command("start")
  .description("Run the heartbeat loop in the foreground. Ctrl+C to stop.")
  .option("--api-base-url <url>", "Coordinator backend base URL (falls back to INAYA_API_BASE_URL, then production)")
  .option("--interval <seconds>", "Heartbeat interval in seconds (default 300)")
  .action(startCommand);

const service = program.command("service").description("Install/uninstall as a native background service (Windows Service / systemd / launchd).");
service.command("install").description("Install and start the background service.").action(serviceInstallCommand);
service.command("uninstall").description("Stop and remove the background service.").action(serviceUninstallCommand);

program.parseAsync(process.argv);
