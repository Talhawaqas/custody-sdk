#!/usr/bin/env node
// packages/cli/bin/inaya.js
import { Command } from "commander";
import { loginCommand } from "../src/commands/login.js";
import { uploadCommand } from "../src/commands/upload.js";
import { listCommand } from "../src/commands/list.js";

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

program.parseAsync(process.argv);
