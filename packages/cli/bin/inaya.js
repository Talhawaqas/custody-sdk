#!/usr/bin/env node
// packages/cli/bin/inaya.js
import { Command } from "commander";
import { loginCommand } from "../src/commands/login.js";
import { uploadCommand } from "../src/commands/upload.js";
import { listCommand } from "../src/commands/list.js";
import { deployCommand } from "../src/commands/deploy.js";

const program = new Command();

program
  .name("inaya")
  .description("CLI for @inaya-network/custody-sdk -- encrypt, shard, and anchor files to the Inaya DePIN network.")
  .version("0.1.0");

program
  .command("login")
  .description("Authenticate with a wallet private key. Reads INAYA_PRIVATE_KEY / INAYA_CLI_PASSWORD from the environment for non-interactive (CI) use.")
  .action(loginCommand);

program
  .command("upload <path>")
  .description("Encrypt, shard, pin, and anchor a local file.")
  .option("--passkey <passkey>", "Encryption passkey (falls back to INAYA_PASSKEY, then an interactive prompt)")
  .option("--api-base-url <url>", "Also register this file in your Metadata backend, so \"inaya list\" can find it later")
  .action(uploadCommand);

program
  .command("list")
  .description("Print the ledger of files registered for the logged-in wallet (requires a deployed Metadata backend -- see examples/nextjs-metadata-api-routes.js).")
  .option("--api-base-url <url>", "Your deployed Metadata backend's base URL (falls back to INAYA_API_BASE_URL)")
  .action(listCommand);

program
  .command("deploy <path>")
  .description("Pin a local static site directory to IPFS (your own Pinata account) and submit it to the Web3 App Store for review.")
  .option("--name <name>", "App name (falls back to an interactive prompt)")
  .option("--description <description>", "App description (falls back to an interactive prompt)")
  .option("--category <category>", 'App Store category (Storage/DeFi/Social/Gaming/Tools/Other), default "Tools"')
  .option("--api-base-url <url>", "Your deployed App Store backend's base URL (falls back to INAYA_API_BASE_URL) -- without this, the directory is pinned but not submitted")
  .option("-y, --yes", "Skip the confirmation prompt (for CI use)")
  .action(deployCommand);

program.parseAsync(process.argv);
