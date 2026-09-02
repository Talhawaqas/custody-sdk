// packages/node-daemon/src/commands/register.js
//
// Two registrations, both required, neither substitutes for the other:
//   1. On-chain registerNode() on InayaNodeRegistry -- the source of truth for tier/
//      commission eligibility.
//   2. Off-chain POST /api/nodes/register -- the coordinator backend's own bookkeeping
//      (nodeId -> capacity/heartbeat tracking), used for shard-assignment eligibility later.
//      Reuses this route's EXISTING request shape as-is; the daemon does not touch or fix
//      the separate assign.js field-name mismatch (registerNode.js/heartbeat.js write
//      totalCapacityGB and never set `active`, assign.js filters on declaredCapacityGB/
//      active:true) -- that's shard-assignment plumbing, explicitly out of scope for this
//      daemon (registration + telemetry only, no shard storage/serving).
//
// nodeId is just the operator's own wallet address, lowercased -- one wallet, one node,
// no separate identifier scheme needed for a minimal daemon.

import { ethers } from "ethers";
import { resolveWallet } from "../resolveWallet.js";
import { signNodeAction } from "../nodeAuth.js";
import { NODE_REGISTRY_ADDRESS, NODE_REGISTRY_ABI, API_BASE_URL } from "../constants.js";

export async function registerCommand(capacityGB, options) {
  const capacity = Number(capacityGB);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    console.error("Capacity (GB) must be a positive number.");
    process.exit(1);
  }

  const { wallet, address } = await resolveWallet();
  const registry = new ethers.Contract(NODE_REGISTRY_ADDRESS, NODE_REGISTRY_ABI, wallet);

  const existing = await registry.nodes(address);
  if (existing.isRegistered) {
    console.log(`Already registered on-chain with ${existing.capacityGB} GB declared.`);
  } else {
    console.log(`Registering ${address} on InayaNodeRegistry with ${capacity} GB...`);
    const tx = await registry.registerNode(capacity);
    console.log("Tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed on-chain.");
  }

  const apiBaseUrl = options?.apiBaseUrl || API_BASE_URL;
  const nodeId = address.toLowerCase();
  try {
    const { message, signature, timestamp } = await signNodeAction(wallet, { action: "register", nodeId });
    const res = await fetch(`${apiBaseUrl}/api/nodes/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, operatorWallet: address, capacityGB: capacity, message, signature, timestamp }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      console.error("Off-chain registration failed:", body.error || res.statusText);
      console.error("On-chain registration still succeeded -- retry off-chain registration by re-running this command.");
      process.exit(1);
    }
    console.log(`Off-chain registration confirmed (nodeId: ${nodeId}).`);
  } catch (err) {
    console.error("Could not reach the coordinator backend:", err.message);
    console.error("On-chain registration still succeeded -- retry off-chain registration by re-running this command.");
    process.exit(1);
  }

  console.log('\nRegistration complete. Run "inaya-node-daemon start" to begin sending heartbeats.');
}
