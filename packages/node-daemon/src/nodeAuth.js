// packages/node-daemon/src/nodeAuth.js
//
// Wallet-signature proof for register/heartbeat, same shape custody-sdk's own metadata.js already
// uses for its mutating calls (buildMetadataMessage/signMetadataAction) -- a canonical message
// signed with the operator's wallet, sent alongside the request body. Before this, register.js and
// start.js's heartbeat loop sent { nodeId, operatorWallet, ... } as plain, unverified fields: the
// coordinator backend had no way to tell a real operator's beat from anyone else POSTing a wallet
// address they don't control, which matters here because heartbeat data feeds uptimeScoreBps/tier
// (reward-eligibility-adjacent). See inaya-network-dapp's src/lib/nodeAuth.js for the matching
// server-side verifier.

export function buildNodeActionMessage({ action, nodeId, timestamp }) {
  return ["Inaya Node Action", `action: ${action}`, `nodeId: ${nodeId}`, `timestamp: ${timestamp}`].join("\n");
}

/** Signs a fresh, timestamped proof that `wallet` controls `nodeId` for this one action. Callers
 *  attach the returned { message, signature, timestamp } to the request body alongside nodeId. */
export async function signNodeAction(wallet, { action, nodeId }) {
  const timestamp = Date.now();
  const message = buildNodeActionMessage({ action, nodeId, timestamp });
  const signature = await wallet.signMessage(message);
  return { message, signature, timestamp };
}
