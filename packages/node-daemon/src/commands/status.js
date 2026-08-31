// packages/node-daemon/src/commands/status.js
//
// Phase 5 (Node Telemetry) — reads back exactly what the coordinator has
// recorded about this node (GET /api/nodes/status), so an operator can
// confirm their heartbeats are actually landing and see their computed
// uptimeScoreBps + threat-reporting reputation without opening a browser.
// No local-only info here (that's what --version / the state file are
// for) — this is specifically "what does the server think of me."

import { resolveWallet } from "../resolveWallet.js";
import { API_BASE_URL } from "../constants.js";

function pctFromBps(bps) {
  return bps === null || bps === undefined ? "—" : `${(bps / 100).toFixed(1)}%`;
}

export async function statusCommand(options) {
  const { address } = await resolveWallet();
  const apiBaseUrl = options?.apiBaseUrl || API_BASE_URL;
  const nodeId = address.toLowerCase();

  try {
    const res = await fetch(`${apiBaseUrl}/api/nodes/status?nodeId=${nodeId}`);
    const body = await res.json();
    if (!res.ok) {
      console.error("Status check failed:", body.error || res.statusText);
      process.exit(1);
    }

    console.log(`Node: ${body.nodeId}`);
    console.log(`Capacity: ${body.usedCapacityGB}/${body.totalCapacityGB} GB used, ${body.shardsStored} shards`);
    console.log(`Last heartbeat: ${body.lastHeartbeatAt ? new Date(body.lastHeartbeatAt).toLocaleString() : "never"}`);
    console.log(`Uptime score: ${pctFromBps(body.uptimeScoreBps)}`);
    console.log(`Daemon: v${body.daemonVersion || "unknown"}, up ${body.daemonUptimeSeconds ?? "?"}s this run, ${body.restartCount ?? "?"} restart(s) recorded`);
    if (body.lastErrorAt) {
      console.log(`Last error (${new Date(body.lastErrorAt).toLocaleString()}): ${body.lastErrorMessage}`);
    }
    console.log(`Threat reporting: score ${pctFromBps(body.threatReporting.scoreBps)}, ${body.threatReporting.totalConfirmed} confirmed / ${body.threatReporting.totalFalsePositive} false-positive (confirmation rate ${pctFromBps(body.threatReporting.confirmationRate)})${body.threatReporting.checkpointed ? "" : " — not yet checkpointed on-chain"}`);
  } catch (err) {
    console.error("Status request failed:", err.message);
    process.exit(1);
  }
}
