// packages/node-daemon/src/state.js
//
// Phase 5 (Node Telemetry) — small local state file, separate from
// config.js's wallet config, tracking exactly two things that only make
// sense persisted ACROSS process restarts (process.uptime() already
// covers in-process uptime honestly on its own, no file needed for
// that): restartCount (incremented once per "start" invocation) and the
// most recent error this daemon actually hit (timestamp + message).
// Both are genuinely observed facts about this daemon, never guessed —
// same discipline start.js's header comment already establishes for
// usedCapacityGB/shardsStored staying honestly 0.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".inaya", "node-daemon");
const STATE_PATH = path.join(STATE_DIR, "state.json");

function readState() {
  if (!fs.existsSync(STATE_PATH)) return { restartCount: 0, lastError: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    // A corrupted state file shouldn't crash the daemon — start fresh
    // rather than block heartbeats over a telemetry-only file.
    return { restartCount: 0, lastError: null };
  }
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** Call once per "start" invocation — increments and persists the
 *  restart counter, returns the new state. */
export function recordRestart() {
  const state = readState();
  state.restartCount = (state.restartCount || 0) + 1;
  writeState(state);
  return state;
}

/** Call whenever a heartbeat (or any operational cycle) genuinely fails —
 *  persists the error so it survives this process exiting/restarting,
 *  and so a "status" check run from a different terminal can see it. */
export function recordError(message) {
  const state = readState();
  state.lastError = { timestamp: new Date().toISOString(), message: String(message).slice(0, 500) };
  writeState(state);
  return state.lastError;
}

export function getState() {
  return readState();
}
