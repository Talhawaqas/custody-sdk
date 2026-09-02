// packages/node-daemon/src/commands/start.js
//
// Foreground heartbeat loop -- registration + telemetry ONLY. Deliberately reports
// usedCapacityGB: 0 and shardsStored: 0 on every beat: this daemon never stores or serves
// shards (that's a separate, unbuilt piece of the system), so there is nothing else true to
// report. totalCapacityGB is re-read from the chain each cycle rather than cached, so a
// capacity change on-chain is reflected without restarting the daemon.
//
// Phase 5 (Node Telemetry) additionally reports daemonVersion (version.js,
// read from package.json), uptimeSeconds (process.uptime() — genuinely
// this PROCESS's uptime, resets on a real restart, which is honest: a
// restart really did happen), and restartCount/lastError from state.js's
// persisted local file — real, locally-observed facts, same "never
// fabricate what isn't true" discipline as the capacity fields above.
//
// Runs as a plain foreground process. For unattended operation, wrap it as a native
// background service with "inaya-node-daemon service:install" (see service.js) rather than
// nohup/forever-style process babysitting.

import { ethers } from "ethers";
import { resolveWallet } from "../resolveWallet.js";
import { recordRestart, recordError, getState } from "../state.js";
import { getDaemonVersion } from "../version.js";
import { signNodeAction } from "../nodeAuth.js";
import { NODE_REGISTRY_ADDRESS, NODE_REGISTRY_ABI, API_BASE_URL, HEARTBEAT_INTERVAL_MS } from "../constants.js";

async function sendHeartbeat({ apiBaseUrl, nodeId, address, wallet, registry }) {
  const node = await registry.nodes(address);
  if (!node.isRegistered) {
    const message = `Not registered on-chain. Run "inaya-node-daemon register <capacityGB>" first.`;
    console.error(`[${new Date().toISOString()}] ${message}`);
    recordError(message);
    return;
  }

  const state = getState();
  try {
    const { message: signedMessage, signature, timestamp } = await signNodeAction(wallet, { action: "heartbeat", nodeId });
    const res = await fetch(`${apiBaseUrl}/api/nodes/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId,
        operatorWallet: address,
        totalCapacityGB: Number(node.capacityGB),
        usedCapacityGB: 0,
        shardsStored: 0,
        daemonVersion: getDaemonVersion(),
        uptimeSeconds: Math.round(process.uptime()),
        restartCount: state.restartCount || 0,
        lastErrorAt: state.lastError?.timestamp || null,
        lastErrorMessage: state.lastError?.message || null,
        message: signedMessage,
        signature,
        timestamp,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      const message = body.error || res.statusText;
      console.error(`[${new Date().toISOString()}] Heartbeat failed:`, message);
      recordError(`Heartbeat rejected: ${message}`);
      return;
    }
    console.log(`[${new Date().toISOString()}] Heartbeat sent (${node.capacityGB} GB declared).`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Heartbeat request failed:`, err.message);
    recordError(`Heartbeat request failed: ${err.message}`);
  }
}

export async function startCommand(options) {
  const { wallet, address } = await resolveWallet();
  const registry = new ethers.Contract(NODE_REGISTRY_ADDRESS, NODE_REGISTRY_ABI, wallet);
  const apiBaseUrl = options?.apiBaseUrl || API_BASE_URL;
  const nodeId = address.toLowerCase();
  const intervalMs = Number(options?.interval) > 0 ? Number(options.interval) * 1000 : HEARTBEAT_INTERVAL_MS;

  recordRestart();
  console.log(`Starting heartbeat loop for ${address} (every ${Math.round(intervalMs / 1000)}s). Ctrl+C to stop.`);

  await sendHeartbeat({ apiBaseUrl, nodeId, address, wallet, registry });
  const timer = setInterval(() => sendHeartbeat({ apiBaseUrl, nodeId, address, wallet, registry }), intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    console.log("\nStopping heartbeat loop.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
