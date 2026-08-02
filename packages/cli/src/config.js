// packages/cli/src/config.js
//
// Local session store at ~/.inaya/config.json — one config per machine,
// same convention as most CLI tools (aws, gh, npm itself). The private
// key field is always the encryptSecret() output (salt/iv/ciphertext),
// never plaintext — see secretCrypto.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".inaya");
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
    console.error('Not logged in. Run "inaya login" first.');
    process.exit(1);
  }
  return config;
}

export { CONFIG_PATH };
