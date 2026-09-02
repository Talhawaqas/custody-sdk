// packages/node-daemon/src/resolveWallet.js
//
// Same shape as packages/cli/src/resolveWallet.js. The password can come from
// INAYA_DAEMON_PASSWORD so this works unattended when run as a background service
// (no stdin available in that context) -- same reasoning as the CLI's
// INAYA_CLI_PASSWORD for CI/CD.
//
// INAYA_DAEMON_PASSWORD_FILE is the preferred unattended path (service.js writes to it, chmod
// 0600) -- a plain INAYA_DAEMON_PASSWORD env var still works for anyone setting it up by hand, but
// service.js no longer bakes the raw password into the service definition itself, since on Linux
// that means a systemd unit file, and unit files under /etc/systemd/system/ are world-readable by
// default (`systemctl cat` needs no privilege) -- any local user could recover the password that
// decrypts the stored wallet key. A 0600 file the unit only references by path doesn't have that
// problem: the unit file itself carries a path, not a secret.

import fs from "node:fs";
import { ethers } from "ethers";
import { decryptSecret } from "./secretCrypto.js";
import { requireConfig } from "./config.js";
import { promptHidden } from "./prompt.js";
import { RPC_URL } from "./constants.js";

async function resolvePassword() {
  if (process.env.INAYA_DAEMON_PASSWORD) return process.env.INAYA_DAEMON_PASSWORD;
  if (process.env.INAYA_DAEMON_PASSWORD_FILE) return fs.readFileSync(process.env.INAYA_DAEMON_PASSWORD_FILE, "utf8").trim();
  return promptHidden("Daemon password: ");
}

export async function resolveWallet() {
  const config = requireConfig();
  const password = await resolvePassword();
  const privateKey = decryptSecret(config.encryptedKey, password);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  return { wallet, provider, address: config.address };
}
