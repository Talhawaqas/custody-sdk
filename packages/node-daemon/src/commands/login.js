// packages/node-daemon/src/commands/login.js
//
// Same pattern as packages/cli/src/commands/login.js: encrypts the wallet private key at
// rest with a daemon password, never stores it in plaintext. INAYA_PRIVATE_KEY /
// INAYA_DAEMON_PASSWORD let this run non-interactively when scripting a fleet setup.

import { ethers } from "ethers";
import { promptHidden } from "../prompt.js";
import { encryptSecret } from "../secretCrypto.js";
import { writeConfig } from "../config.js";

export async function loginCommand() {
  const privateKey = process.env.INAYA_PRIVATE_KEY || (await promptHidden("Node operator wallet private key: "));
  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey);
  } catch {
    console.error("That doesn't look like a valid private key.");
    process.exit(1);
  }

  const password =
    process.env.INAYA_DAEMON_PASSWORD || (await promptHidden("Set a daemon password (encrypts the key at rest): "));
  if (!password) {
    console.error("A daemon password is required to encrypt the stored key.");
    process.exit(1);
  }

  writeConfig({ address: wallet.address, encryptedKey: encryptSecret(privateKey, password) });
  console.log(`Logged in as ${wallet.address}`);
  console.log("Config saved to ~/.inaya/node-daemon/config.json (private key stored encrypted, never in plaintext).");
}
