// packages/node-daemon/src/config.js
//
// Own config path (~/.inaya/node-daemon/config.json) rather than reusing the plain
// CLI's ~/.inaya/config.json -- a machine could run both @inaya-network/cli (for uploads)
// and this daemon (for node operation) with different wallets, so they must not clobber
// each other's session.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".inaya", "node-daemon");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

export function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function requireConfig() {
  const config = readConfig();
  if (!config) {
    console.error('Not logged in. Run "inaya-node-daemon login" first.');
    process.exit(1);
  }
  return config;
}

export { CONFIG_PATH, CONFIG_DIR };
