// examples/trust-fabric-integration.mjs
//
// SOW Phase 5 — Integration Prototype for the Trust Fabric SOW's GO/CONDITIONAL GO workstreams
// (see docs/trust-fabric-phase3-adr.md's decision gate; Workstream A/TEE is DEFERred on hardware,
// so it isn't part of this prototype). Demonstrates the two integration points end to end, using
// only local/offline calls (no live RPC, no live bridge) so this runs anywhere with no funded
// wallet and no network dependency — exactly like examples/node-script.mjs's dual-mode connection
// pattern, but exercising InayaKernel.ComplianceProofs and InayaKernel.Intent instead of the
// custody/staking pipeline.
//
// Run with: node examples/trust-fabric-integration.mjs

import { ethers } from "ethers";
import { InayaKernel } from "../src/index.js";

const { ComplianceProofs, Intent } = InayaKernel;

async function main() {
  console.log("=== Integration 1: ComplianceProofs gating a compliance-evidence read ===\n");

  // In a real host app, this commitment would be registered once at org-membership time (see
  // docs/trust-fabric-phase0-1.md's Workstream B design) -- here we derive one on the fly.
  const officerWallet = ethers.Wallet.createRandom();
  const officerCommitment = ComplianceProofs.deriveAccessCommitment(officerWallet.privateKey);
  console.log(`Compliance officer's registered commitment: ${officerCommitment.slice(0, 20)}...`);

  // The officer proves they control the private key behind that commitment, scoped to one
  // specific policy/action, without ever transmitting the key itself.
  const { proof, policy, action, timestamp } = ComplianceProofs.proveAuthorizedAccess({
    privateKey: officerWallet.privateKey,
    policy: "org:acme-corp:evidence-vault",
    action: "read",
  });
  console.log(`Proof generated for policy="${policy}" action="${action}" (${JSON.stringify(proof).length} bytes)`);

  // The host app's own access-control checkpoint -- gating a read the same way it would gate any
  // other sensitive operation, just with a ZK proof instead of (or in addition to) a session check.
  function checkComplianceEvidenceAccess({ proof, publicKey, policy, action, timestamp }) {
    const result = ComplianceProofs.verifyAuthorizedAccessProof({ proof, publicKey, policy, action, timestamp });
    if (!result.valid) throw new Error(`Access denied: ${result.reason}`);
    return { granted: true };
  }

  const access = checkComplianceEvidenceAccess({ proof, publicKey: officerCommitment, policy, action, timestamp });
  console.log(`Access check result: ${JSON.stringify(access)}\n`);

  // An attacker who intercepted the proof cannot replay it for a different policy.
  try {
    checkComplianceEvidenceAccess({ proof, publicKey: officerCommitment, policy: "org:acme-corp:findings", action, timestamp });
    console.log("UNEXPECTED: replay for a different policy was accepted");
  } catch (err) {
    console.log(`Replay-for-different-policy correctly rejected: ${err.message}\n`);
  }

  console.log("=== Integration 2: Intent — AI-proposed cross-chain transfer, human-approved ===\n");

  // The same guarded-execution shape as inaya-network-dapp/src/lib/ai-action-requests.js: an
  // AI assistant can CREATE and walk an intent through VALIDATE/DISCOVER/SIMULATE/RISK_CHECK, but
  // can never itself flip PENDING_APPROVAL -> APPROVED. Only a human, through canApprove, can.
  const userWallet = ethers.Wallet.createRandom();
  let intent = await Intent.createIntent({
    connection: userWallet,
    intentId: `demo-${Date.now()}`,
    sourceChainId: 97,
    destChainId: 11155111,
    asset: "INAYA",
    amount: "1000000000000000000",
    recipient: "0x0000000000000000000000000000000000dEaD",
    maxFee: "1000000000000000",
    deadline: Date.now() + 10 * 60 * 1000,
    nonce: 1,
  });
  console.log(`Intent created and signed by ${userWallet.address}, status=${intent.status}`);

  const validated = await Intent.validateIntent(intent);
  if (!validated.valid) throw new Error(`Unexpected: ${validated.reason}`);
  intent = validated.intent;
  console.log(`Intent validated (signature + freshness + deadline all checked locally, no network call), status=${intent.status}`);

  // A local, offline "bridge client" stand-in -- swap this for a real @inaya-network/bridge-sdk
  // InayaBridgeClient in production; Intent's pipeline only needs the same three methods.
  const offlineBridgeClient = {
    async getSupportedChains() {
      return [
        { chainId: 97, isHome: true, contracts: { inayaToken: "0x3966a3378c8d9e6bb34dd0b8458eef4b878ce94e", bridge: "0xaF1341ea8a5284D561aD2F1287698DAFE180c484" } },
        { chainId: 11155111, isHome: false, contracts: { bridge: "0xc8780daE7de676F81904D3118DD30c7c81c85f37" } },
      ];
    },
    async bridgeTransfer() { return { messageHash: "0xdemo", sourceTxHash: "0xdemo-tx" }; },
    async getTransferStatus() { return { status: "COMPLETED" }; },
  };

  intent = await Intent.discoverRoutes({ intent, bridgeClient: offlineBridgeClient });
  console.log(`Route discovered: ${intent.status === "ROUTES_DISCOVERED" ? "yes" : "no route"}`);

  // requestIntentApproval/decideIntentApproval only makes sense mid-pipeline once risk-checked;
  // for this demo we skip straight to showing the approval gate itself in isolation, matching
  // how a host app's AI assistant would propose without ever being able to self-approve.
  console.log("\nAI assistant proposes this intent for human approval (cannot approve its own proposal):");
  const proposedForApproval = { ...intent, status: "RISK_CHECKED" }; // demo shortcut past simulate/risk-check, which need a live provider
  const pending = Intent.requestIntentApproval(proposedForApproval);
  console.log(`  status=${pending.status}`);

  const aiSelfApprovalAttempt = Intent.decideIntentApproval({ intent: pending, decision: "approve", approverAddress: "ai-assistant", canApprove: false });
  console.log(`  AI's own self-approval attempt (canApprove=false, exactly as ai-action-requests.js enforces): status=${aiSelfApprovalAttempt.status}, reason=${aiSelfApprovalAttempt.failureReason}`);

  const humanApproval = Intent.decideIntentApproval({ intent: pending, decision: "approve", approverAddress: "0xComplianceManager", canApprove: true });
  console.log(`  Human compliance manager's approval (canApprove=true, resolved via the host app's own authority check): status=${humanApproval.status}\n`);

  const executed = await Intent.executeIntent({ intent: humanApproval, bridgeClient: offlineBridgeClient, userAddress: userWallet.address });
  console.log(`Executed (route re-derived fresh from bridgeClient at this exact moment, per the route-substitution fix): status=${executed.status}, messageHash=${executed.messageHash}`);

  const settled = await Intent.pollSettlement({ intent: executed, bridgeClient: offlineBridgeClient });
  console.log(`Settled: status=${settled.status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
