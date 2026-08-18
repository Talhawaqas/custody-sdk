// packages/node-daemon/src/resolveWallet.js
//
// Same shape as packages/cli/src/resolveWallet.js. The password can come from
// INAYA_DAEMON_PASSWORD so this works unattended when run as a background service
// (no stdin available in that context) -- same reasoning as the CLI's
// INAYA_CLI_PASSWORD for CI/CD.

import { ethers } from "ethers";
import { decryptSecret } from "./secretCrypto.js";
import { requireConfig } from "./config.js";
import { promptHidden } from "./prompt.js";
import { RPC_URL } from "./constants.js";

export async function resolveWallet() {
  const config = requireConfig();
  const password = process.env.INAYA_DAEMON_PASSWORD || (await promptHidden("Daemon password: "));
  const privateKey = decryptSecret(config.encryptedKey, password);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  return { wallet, provider, address: config.address };
}
