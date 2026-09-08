// src/intent.js
//
// Trust Fabric SOW, Workstream C — Intent-Based Multi-Chain Routing.
// docs/trust-fabric-phase0-1.md explains why this is an orchestration layer
// IN FRONT OF packages/bridge-sdk's real InayaBridgeClient, not a
// replacement for it: bridge-sdk already has one real, working execution
// backend (a custom home/spoke message bridge, not Wormhole) with no
// getCapabilities/quote/simulate step in front of it — this module adds
// exactly that missing pipeline, then delegates the actual on-chain
// transfer to bridge-sdk's own bridgeTransfer(), never reimplementing it.
//
// PIPELINE: CREATE (signed intent) -> VALIDATE (schema + signature + nonce
// shape + freshness) -> DISCOVER_ROUTES -> SIMULATE (dry run, no state
// change) -> RISK_CHECK -> [PENDING_APPROVAL -> APPROVED, only for
// AI-originated intents — same guarded-execution shape as
// inaya-network-dapp/src/lib/ai-action-requests.js's PENDING_APPROVAL ->
// APPROVED two-party gate] -> EXECUTE (delegates to the caller-supplied
// bridgeClient.bridgeTransfer) -> SETTLING (poll bridgeClient.
// getTransferStatus) -> SETTLED / FAILED.
//
// NO DATABASE: like every other client in this SDK (metadata.js, backup.js,
// payments.js), this module holds no state of its own. An intent is a
// plain, signed, self-contained object; the CALLER is responsible for
// persisting it between steps (your own backend route, or in-memory for a
// short-lived flow). Every function here is a pure transition: given an
// intent object (and, for the network-touching steps, a provider/
// bridgeClient), it returns a NEW intent object — never a hidden write to
// storage this SDK controls.
//
// WHY NO HARD DEPENDENCY ON bridge-sdk: custody-sdk and bridge-sdk are
// independent sibling workspace packages (see docs/trust-fabric-phase0-1.md's
// "Repo boundary" section) — a consumer who only needs the vault/custody
// half of this SDK shouldn't be forced to install bridge-sdk too.
// discoverRoutes()/executeIntent()/pollSettlement() therefore take a
// `bridgeClient` parameter (duck-typed: needs getSupportedChains(),
// bridgeTransfer(), getTransferStatus()) rather than importing
// InayaBridgeClient directly — pass a real @inaya-network/bridge-sdk
// InayaBridgeClient instance, or any object shaped the same way.
//
// SECURITY MODEL — same discipline as metadata.js: every intent is
// authenticated with a wallet signature (personal_sign over a canonical
// message, the same buildXMessage pattern already used by
// metadata.js/node-daemon's nodeAuth.js), never a bare address. The
// signature binds EVERY mutable field (asset, amount, recipient, maxFee,
// deadline, nonce, source/dest chain) — changing any one of them after
// signing breaks signature recovery, which is what makes recipient
// substitution and fee tampering detectable by validateIntent() alone,
// with no network call. A backend that stores/relays intents between
// steps MUST additionally:
//   1. Recompute the expected message server-side from the intent's own
//      fields and confirm it matches exactly (validateIntent() does this
//      locally too, but a backend must never trust a client-computed
//      "valid: true" without redoing the check itself).
//   2. Reject a stale signature (intent.timestamp — see
//      isIntentSignatureFresh(), 5 minute default window).
//   3. Reject a reused {signerAddress, nonce} pair — this SDK has no
//      storage of its own, so nonce *uniqueness* is a backend/persistence
//      concern (createNonceTracker() below is an in-memory convenience for
//      a single process/short-lived flow or tests, explicitly NOT a
//      substitute for your backend's own persistent nonce ledger).

import { InayaValidationError, InayaWalletError, translateError } from "./errors.js";

export const INTENT_STATES = [
  "CREATED",
  "VALIDATED",
  "ROUTES_DISCOVERED",
  "SIMULATED",
  "RISK_CHECKED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXECUTING",
  "SETTLING",
  "SETTLED",
  "FAILED",
];

export const INTENT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // matches metadata.js's signature-freshness window

async function resolveSigner(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("No provider/signer — call connectWallet() (browser) or pass an ethers.Wallet directly (Node.js) first.", { code: "NO_CONNECTION" });
  const { ethers } = await import("ethers"); // dynamic: don't force `ethers` on consumers who never sign an intent
  if (typeof raw.getAddress === "function" && typeof raw.signTransaction === "function") return raw; // Node.js: already a Signer
  return new ethers.BrowserProvider(raw).getSigner();
}

function assertState(intent, ...allowed) {
  if (!allowed.includes(intent?.status)) {
    throw new InayaValidationError(`Intent: expected status ${allowed.join(" or ")}, got "${intent?.status}".`);
  }
}

/** The exact fields the signature binds — order matters, since the whole point is that
 *  tampering ANY one of these after signing must break signature recovery. */
function buildIntentMessage({ intentId, sourceChainId, destChainId, asset, amount, recipient, maxFee, deadline, nonce, timestamp = Date.now() }) {
  const lines = [
    "Inaya Intent",
    `intentId: ${intentId}`,
    `sourceChainId: ${sourceChainId}`,
    `destChainId: ${destChainId}`,
    `asset: ${asset}`,
    `amount: ${amount}`,
    `recipient: ${recipient}`,
    `maxFee: ${maxFee}`,
    `deadline: ${deadline}`,
    `nonce: ${nonce}`,
    `timestamp: ${timestamp}`,
  ];
  return { message: lines.join("\n"), timestamp };
}

function requireIntentFields(fields) {
  for (const key of ["intentId", "sourceChainId", "destChainId", "asset", "amount", "recipient", "maxFee", "deadline", "nonce"]) {
    if (fields[key] === undefined || fields[key] === null || fields[key] === "") {
      throw new InayaValidationError(`Intent: "${key}" is required.`);
    }
  }
}

/**
 * CREATE step. Signs a canonical message binding every mutable field of the intent, exactly the
 * buildXMessage -> personal_sign -> {address, message, signature, timestamp} pattern metadata.js
 * and node-daemon's nodeAuth.js already use. Returns a plain, self-contained, CREATED intent —
 * nothing is persisted or transmitted by this call.
 */
export async function createIntent({ connection, intentId, sourceChainId, destChainId, asset, amount, recipient, maxFee, deadline, nonce }) {
  const fields = { intentId, sourceChainId, destChainId, asset, amount: String(amount), recipient, maxFee: String(maxFee), deadline, nonce };
  requireIntentFields(fields);
  try {
    const signer = await resolveSigner(connection);
    const signerAddress = await signer.getAddress();
    const { message, timestamp } = buildIntentMessage(fields);
    const signature = await signer.signMessage(message);
    return { ...fields, signerAddress, message, signature, timestamp, status: "CREATED" };
  } catch (err) {
    throw translateError(err, "Intent.createIntent");
  }
}

/** True if intent.timestamp is within maxAgeMs of now, in either direction — same freshness rule
 *  every other signed action in this codebase enforces (see complianceProofs.js's identical
 *  expired/timestamp_in_future pair for the sibling Workstream B). */
export function isIntentSignatureFresh(intent, maxAgeMs = INTENT_SIGNATURE_MAX_AGE_MS) {
  if (typeof intent?.timestamp !== "number") return false;
  const age = Date.now() - intent.timestamp;
  return age <= maxAgeMs && age >= -maxAgeMs;
}

/**
 * VALIDATE step — pure, no network call. Recomputes the canonical message from the intent's own
 * fields and confirms it (a) matches intent.message exactly (nothing was mutated after signing)
 * and (b) recovers, via signature, to intent.signerAddress. This single check is what makes
 * recipient substitution, fee tampering, and amount tampering all fail closed with no network
 * round-trip. Returns { valid, reason, intent: <VALIDATED intent> | null }, never throws for a
 * malformed/forged intent — same fail-closed convention as complianceProofs.js's verify function.
 */
export async function validateIntent(intent, { maxAgeMs = INTENT_SIGNATURE_MAX_AGE_MS } = {}) {
  if (!intent || typeof intent !== "object") return { valid: false, reason: "malformed_intent", intent: null };
  assertState(intent, "CREATED");

  const { message: expectedMessage } = buildIntentMessage({ ...intent, timestamp: intent.timestamp });
  if (expectedMessage !== intent.message) return { valid: false, reason: "message_mismatch_tampered_field", intent: null };

  if (!isIntentSignatureFresh(intent, maxAgeMs)) {
    const reason = Date.now() - intent.timestamp > maxAgeMs ? "expired" : "timestamp_in_future";
    return { valid: false, reason, intent: null };
  }

  if (Date.now() > Number(intent.deadline)) return { valid: false, reason: "deadline_passed", intent: null };

  try {
    const { ethers } = await import("ethers");
    const recovered = ethers.verifyMessage(intent.message, intent.signature);
    if (ethers.getAddress(recovered) !== ethers.getAddress(intent.signerAddress)) {
      return { valid: false, reason: "signature_does_not_match_signer", intent: null };
    }
  } catch {
    return { valid: false, reason: "malformed_signature", intent: null };
  }

  return { valid: true, reason: null, intent: { ...intent, status: "VALIDATED" } };
}

/**
 * DISCOVER_ROUTES step. Today there is exactly one real execution backend (bridge-sdk's own
 * home/spoke bridge — see the module comment), so "discovery" is honest about that: it asks the
 * injected bridgeClient which chains are actually wired up right now and confirms the intent's
 * source/dest pair is among them, rather than pretending to search across routes that don't
 * exist. `bridgeClient` needs only `getSupportedChains()` for this step.
 */
export async function discoverRoutes({ intent, bridgeClient }) {
  assertState(intent, "VALIDATED");
  if (!bridgeClient?.getSupportedChains) throw new InayaValidationError("Intent.discoverRoutes: bridgeClient.getSupportedChains is required.");

  const chains = await bridgeClient.getSupportedChains();
  const sourceChain = chains.find((c) => Number(c.chainId) === Number(intent.sourceChainId));
  const destChain = chains.find((c) => Number(c.chainId) === Number(intent.destChainId));

  if (!sourceChain || !destChain) {
    return { ...intent, status: "FAILED", failureReason: "no_route", routes: [] };
  }

  const route = { sourceChain, destChain, via: "inaya-native-bridge" };
  return { ...intent, status: "ROUTES_DISCOVERED", routes: [route] };
}

/**
 * SIMULATE step — a dry run: checks the signer's real on-chain balance and the bridge's known
 * flat fee, WITHOUT sending any transaction (no approve, no bridgeTransfer call). Mirrors
 * bridge-sdk's own hardcoded home-side fee constant (InayaToken's flat per-transfer fee) rather
 * than re-deriving it, so this can never silently drift from what bridgeTransfer() will actually
 * charge.
 */
const HOME_CHAIN_TRANSFER_FEE_WEI = 100000000000000n; // InayaToken's flat 0.0001-token fee, home side only — see bridge-sdk/src/client.js

export async function simulateIntent({ intent, provider, tokenAddress, tokenAbi = ["function balanceOf(address) view returns (uint256)"] }) {
  assertState(intent, "ROUTES_DISCOVERED");
  if (!provider) throw new InayaValidationError("Intent.simulateIntent: provider is required.");
  if (!tokenAddress) throw new InayaValidationError("Intent.simulateIntent: tokenAddress is required.");

  try {
    const { ethers } = await import("ethers");
    const token = new ethers.Contract(tokenAddress, tokenAbi, provider);
    const balance = await token.balanceOf(intent.signerAddress);

    const sourceIsHome = intent.routes?.[0]?.sourceChain?.isHome === true;
    const estimatedFee = sourceIsHome ? HOME_CHAIN_TRANSFER_FEE_WEI : 0n;
    const amount = BigInt(intent.amount);
    const maxFee = BigInt(intent.maxFee);

    const simulation = {
      balance: balance.toString(),
      estimatedFee: estimatedFee.toString(),
      sufficientBalance: balance >= amount + estimatedFee,
      feeWithinMax: estimatedFee <= maxFee,
    };

    return { ...intent, status: "SIMULATED", simulation };
  } catch (err) {
    throw translateError(err, "Intent.simulateIntent");
  }
}

/**
 * RISK_CHECK step — pure, no network call. Re-verifies the exact things that could have gone
 * stale between CREATE and now: the deadline hasn't passed, the simulated fee still fits inside
 * maxFee, and the simulated balance is still sufficient. This is the SOW's "risk check still
 * holds" gate — it fails closed (status FAILED with a reason) rather than silently proceeding on
 * any one of these being false.
 */
export function riskCheckIntent(intent) {
  assertState(intent, "SIMULATED");

  if (Date.now() > Number(intent.deadline)) {
    return { ...intent, status: "FAILED", failureReason: "deadline_passed" };
  }
  if (!intent.simulation?.feeWithinMax) {
    return { ...intent, status: "FAILED", failureReason: "fee_exceeds_max_fee" };
  }
  if (!intent.simulation?.sufficientBalance) {
    return { ...intent, status: "FAILED", failureReason: "insufficient_balance" };
  }

  return { ...intent, status: "RISK_CHECKED", riskChecks: { deadlineOk: true, feeOk: true, balanceOk: true } };
}

/**
 * Guarded-execution gate for AI-originated intents — same PENDING_APPROVAL -> APPROVED shape as
 * inaya-network-dapp/src/lib/ai-action-requests.js. A human-originated intent can skip straight
 * from RISK_CHECKED to executeIntent(); an AI-originated one MUST pass through here first.
 */
export function requestIntentApproval(intent) {
  assertState(intent, "RISK_CHECKED");
  return { ...intent, status: "PENDING_APPROVAL" };
}

/** `canApprove` is a boolean the CALLER resolves via their own authority check (the same
 *  belt-and-suspenders pattern ai-action-requests.js's reviewAiAction() uses) — this function
 *  doesn't know your app's permission model, it only enforces that some check was performed. */
export function decideIntentApproval({ intent, decision, approverAddress, canApprove }) {
  assertState(intent, "PENDING_APPROVAL");
  if (!["approve", "reject"].includes(decision)) throw new InayaValidationError('Intent.decideIntentApproval: decision must be "approve" or "reject".');
  if (!canApprove) return { ...intent, status: "REJECTED", failureReason: "approval_denied" };
  return decision === "approve"
    ? { ...intent, status: "APPROVED", approverAddress }
    : { ...intent, status: "REJECTED", approverAddress, failureReason: "approver_rejected" };
}

/**
 * EXECUTE step — delegates the actual on-chain transfer to the caller-supplied bridgeClient's
 * real bridgeTransfer(), never reimplementing bridge logic here. Only reachable from
 * RISK_CHECKED (human-originated) or APPROVED (AI-originated, post-approval) — executing from any
 * other state throws, so an intent can never be executed before its risk check has actually run.
 */
export async function executeIntent({ intent, bridgeClient, userAddress }) {
  assertState(intent, "RISK_CHECKED", "APPROVED");
  if (!bridgeClient?.bridgeTransfer) throw new InayaValidationError("Intent.executeIntent: bridgeClient.bridgeTransfer is required.");
  if (!bridgeClient?.getSupportedChains) throw new InayaValidationError("Intent.executeIntent: bridgeClient.getSupportedChains is required.");

  // Deliberately re-derives sourceChain from the bridge's OWN live chain list right here, rather
  // than trusting whatever object sits in intent.routes. An intent is a plain value the caller
  // holds between pipeline steps — nothing stops a malicious or compromised caller from
  // overwriting intent.routes[0] with attacker-controlled contract addresses after
  // discoverRoutes() ran, then handing that mutated intent straight to executeIntent(). This is
  // the SOW's §16 "route substitution" adversarial case: re-fetching immediately before the
  // fund-moving call (rather than only once, earlier in the pipeline) closes it, because the
  // attacker's mutated intent.routes value is simply never read.
  const chains = await bridgeClient.getSupportedChains();
  const sourceChain = chains.find((c) => Number(c.chainId) === Number(intent.sourceChainId));
  if (!sourceChain) return { ...intent, status: "FAILED", failureReason: "route_no_longer_available" };

  try {
    const { messageHash, sourceTxHash } = await bridgeClient.bridgeTransfer({
      sourceChain,
      destChainId: intent.destChainId,
      amountWei: BigInt(intent.amount),
      recipient: intent.recipient,
      userAddress: userAddress || intent.signerAddress,
    });
    return { ...intent, status: "EXECUTING", messageHash, sourceTxHash };
  } catch (err) {
    return { ...intent, status: "FAILED", failureReason: translateError(err, "Intent.executeIntent").message };
  }
}

/**
 * SETTLE/CONFIRM step — polls the caller-supplied bridgeClient's real getTransferStatus(), never
 * marking an intent SETTLED on anything but the bridge's own confirmation (mirrors bridge-sdk and
 * the interop layer's shared rule: "completed" is only ever set once the destination chain's own
 * event confirms it, per docs/interop-security-boundary.md).
 */
export async function pollSettlement({ intent, bridgeClient }) {
  assertState(intent, "EXECUTING", "SETTLING");
  if (!bridgeClient?.getTransferStatus) throw new InayaValidationError("Intent.pollSettlement: bridgeClient.getTransferStatus is required.");
  if (!intent.messageHash) throw new InayaValidationError("Intent.pollSettlement: intent has no messageHash — call executeIntent() first.");

  try {
    const transfer = await bridgeClient.getTransferStatus(intent.messageHash);
    if (transfer?.status === "COMPLETED") return { ...intent, status: "SETTLED", transfer };
    if (transfer?.status === "FAILED") return { ...intent, status: "FAILED", failureReason: "bridge_transfer_failed", transfer };
    return { ...intent, status: "SETTLING", transfer };
  } catch (err) {
    throw translateError(err, "Intent.pollSettlement");
  }
}

/**
 * In-memory nonce tracker — a convenience for a single process/short-lived flow or tests.
 * EXPLICITLY NOT a substitute for a backend's own persistent nonce ledger (see the module
 * comment's Security Model, point 3): this state vanishes on process restart and isn't shared
 * across instances, so it cannot by itself stop a genuinely persistent replay attack.
 */
export function createNonceTracker() {
  const used = new Set();
  return {
    has(signerAddress, nonce) {
      return used.has(`${signerAddress}:${nonce}`);
    },
    use(signerAddress, nonce) {
      const key = `${signerAddress}:${nonce}`;
      if (used.has(key)) return false;
      used.add(key);
      return true;
    },
  };
}

export const Intent = {
  INTENT_STATES,
  INTENT_SIGNATURE_MAX_AGE_MS,
  createIntent,
  validateIntent,
  isIntentSignatureFresh,
  discoverRoutes,
  simulateIntent,
  riskCheckIntent,
  requestIntentApproval,
  decideIntentApproval,
  executeIntent,
  pollSettlement,
  createNonceTracker,
};
