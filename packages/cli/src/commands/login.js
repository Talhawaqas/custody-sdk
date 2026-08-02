// packages/cli/src/commands/login.js
//
// Authenticates the CLI with a wallet private key, encrypts it at rest
// with a CLI password (see secretCrypto.js), and stores it in
// ~/.inaya/config.json. Both secrets can come from environment variables
// instead of interactive prompts (INAYA_PRIVATE_KEY / INAYA_CLI_PASSWORD)
// specifically so this works unattended in a CI/CD pipeline — the
// "Automation Focus" this command exists for.

import { ethers } from "ethers";
import { promptHidden } from "../prompt.js";
import { encryptSecret } from "../secretCrypto.js";
import { writeConfig } from "../config.js";

export async function loginCommand() {
  const privateKey = process.env.INAYA_PRIVATE_KEY || await promptHidden("Wallet private key: ");
  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey);
  } catch {
    console.error("That doesn't look like a valid private key.");
    process.exit(1);
  }

  const cliPassword = process.env.INAYA_CLI_PASSWORD || await promptHidden("Set a CLI password (encrypts the key at rest): ");
  if (!cliPassword) {
    console.error("A CLI password is required to encrypt the stored key.");
    process.exit(1);
  }

  writeConfig({ address: wallet.address, encryptedKey: encryptSecret(privateKey, cliPassword) });
  console.log(`Logged in as ${wallet.address}`);
  console.log("Config saved to ~/.inaya/config.json (private key stored encrypted, never in plaintext).");
}
