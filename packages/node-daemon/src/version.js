// packages/node-daemon/src/version.js
//
// Reads the daemon's own version straight from package.json rather than
// hardcoding it a second time in bin/inaya-node-daemon.js's .version()
// call — one source of truth, no drift between what --version prints and
// what heartbeat.js actually reports to the coordinator.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_JSON_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");

export function getDaemonVersion() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf-8")).version;
  } catch {
    return "unknown";
  }
}
