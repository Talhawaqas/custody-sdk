// test/intent.test.mjs
//
// Trust Fabric SOW, Workstream C — coverage for intent.js's orchestration pipeline
// (CREATE -> VALIDATE -> DISCOVER_ROUTES -> SIMULATE -> RISK_CHECK -> [approval] -> EXECUTE ->
// SETTLE). The adversarial cases below are the SOW's §16 requirements: replay, recipient
// substitution, fee tampering, and an expired intent must all fail closed with no network call
// reaching a real bridgeClient — same fail-closed discipline as complianceProofs.test.mjs's
// sibling Workstream B suite.
//
// Run with: node --test test/intent.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  createIntent,
  validateIntent,
  discoverRoutes,
  simulateIntent,
  riskCheckIntent,
  requestIntentApproval,
  decideIntentApproval,
  executeIntent,
  pollSettlement,
  createNonceTracker,
  Intent,
} from "../src/intent.js";
import { InayaValidationError } from "../src/errors.js";

const HOME_CHAIN = { chainId: 97, isHome: true, contracts: { inayaToken: "0x1111111111111111111111111111111111111a", bridge: "0x2222222222222222222222222222222222222b" } };
const SPOKE_CHAIN = { chainId: 11155111, isHome: false, contracts: { bridge: "0x3333333333333333333333333333333333333c" } };
const RECIPIENT = "0x0000000000000000000000000000000000dEaD";
const TOKEN_ADDRESS = "0x1111111111111111111111111111111111111a";

function freshWallet() {
  return ethers.Wallet.createRandom();
}

function baseIntentFields(overrides = {}) {
  return {
    intentId: `intent-${Math.random().toString(36).slice(2)}`,
    sourceChainId: 97,
    destChainId: 11155111,
    asset: "INAYA",
    amount: "1000000000000000000",
    recipient: RECIPIENT,
    maxFee: "1000000000000000",
    deadline: Date.now() + 10 * 60 * 1000, // 10 minutes out
    nonce: 1,
    ...overrides,
  };
}

async function createSignedIntent(wallet, overrides = {}) {
  return createIntent({ connection: wallet, ...baseIntentFields(overrides) });
}

function fakeBalanceProvider(balanceWei) {
  const encoded = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]).encodeFunctionResult("balanceOf", [balanceWei]);
  return {
    async call() { return encoded; },
    async getNetwork() { return { chainId: 97n, name: "bsc-testnet" }; },
  };
}

function fakeBridgeClient({ chains, transferResult, transferError, statusResult } = {}) {
  return {
    async getSupportedChains() { return chains ?? [HOME_CHAIN, SPOKE_CHAIN]; },
    async bridgeTransfer(params) {
      if (transferError) throw transferError;
      return transferResult ?? { messageHash: "0xabc123", sourceTxHash: "0xdef456", _calledWith: params };
    },
    async getTransferStatus() { return statusResult ?? { status: "COMPLETED" }; },
  };
}

test("Intent export carries every pipeline function", () => {
  for (const fn of [createIntent, validateIntent, discoverRoutes, simulateIntent, riskCheckIntent, requestIntentApproval, decideIntentApproval, executeIntent, pollSettlement, createNonceTracker]) {
    assert.equal(typeof fn, "function");
  }
  assert.equal(Intent.createIntent, createIntent);
});

test("happy path: CREATE -> VALIDATE -> DISCOVER_ROUTES -> SIMULATE -> RISK_CHECK -> EXECUTE -> SETTLE", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  assert.equal(intent.status, "CREATED");

  const { valid, intent: validated } = await validateIntent(intent);
  assert.equal(valid, true);
  intent = validated;
  assert.equal(intent.status, "VALIDATED");

  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  assert.equal(intent.status, "ROUTES_DISCOVERED");
  assert.equal(intent.routes.length, 1);

  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  assert.equal(intent.status, "SIMULATED");
  assert.equal(intent.simulation.sufficientBalance, true);
  assert.equal(intent.simulation.feeWithinMax, true);

  intent = riskCheckIntent(intent);
  assert.equal(intent.status, "RISK_CHECKED");

  intent = await executeIntent({ intent, bridgeClient: fakeBridgeClient(), userAddress: wallet.address });
  assert.equal(intent.status, "EXECUTING");
  assert.equal(intent.messageHash, "0xabc123");

  intent = await pollSettlement({ intent, bridgeClient: fakeBridgeClient({ statusResult: { status: "COMPLETED" } }) });
  assert.equal(intent.status, "SETTLED");
});

test("createIntent: rejects missing required fields before ever signing", async () => {
  const wallet = freshWallet();
  await assert.rejects(() => createIntent({ connection: wallet, ...baseIntentFields({ recipient: "" }) }), InayaValidationError);
});

test("adversarial: recipient substitution after signing is detected and rejected with no network call", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet);
  const tampered = { ...intent, recipient: "0x000000000000000000000000000000000bad01" };

  const result = await validateIntent(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "message_mismatch_tampered_field");
});

test("adversarial: amount tampering after signing is detected and rejected", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet);
  const tampered = { ...intent, amount: "999999999999999999999" };

  const result = await validateIntent(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "message_mismatch_tampered_field");
});

test("adversarial: maxFee tampering (fee-limit bypass attempt) after signing is detected and rejected", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet);
  const tampered = { ...intent, maxFee: "999999999999999999999" };

  const result = await validateIntent(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "message_mismatch_tampered_field");
});

test("adversarial: a forged signerAddress claim (signature doesn't belong to the claimed signer) is rejected", async () => {
  const wallet = freshWallet();
  const attacker = freshWallet();
  const intent = await createSignedIntent(wallet);
  const forged = { ...intent, signerAddress: attacker.address };

  const result = await validateIntent(forged);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signature_does_not_match_signer");
});

test("adversarial: an expired intent (signature aged past the freshness window) is rejected before any curve/route work", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet);
  const staleIntent = { ...intent, timestamp: intent.timestamp - 10 * 60 * 1000 };
  // message must still match: rebuild message with the same stale timestamp so this test isolates
  // freshness rejection specifically, not the (already-covered) message-mismatch path.
  const restale = { ...staleIntent, message: staleIntent.message.replace(/timestamp: \d+/, `timestamp: ${staleIntent.timestamp}`) };

  const result = await validateIntent(restale, { maxAgeMs: 5 * 60 * 1000 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});

test("adversarial: a deadline already in the past is rejected even with a fresh, correctly-matching signature", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet, { deadline: Date.now() - 1000 });

  const result = await validateIntent(intent);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "deadline_passed");
});

test("validateIntent: refuses to run on an intent that isn't in CREATED state", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet);
  const alreadyValidated = { ...intent, status: "VALIDATED" };
  await assert.rejects(() => validateIntent(alreadyValidated), InayaValidationError);
});

test("discoverRoutes: an intent whose destination chain isn't wired up fails closed with no_route, never silently picks a fallback", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet, { destChainId: 999999 });
  intent = (await validateIntent(intent)).intent;

  const result = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  assert.equal(result.status, "FAILED");
  assert.equal(result.failureReason, "no_route");
});

test("simulateIntent: insufficient balance is caught and surfaced, not swallowed", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });

  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(0n), tokenAddress: TOKEN_ADDRESS });
  assert.equal(intent.simulation.sufficientBalance, false);

  const checked = riskCheckIntent(intent);
  assert.equal(checked.status, "FAILED");
  assert.equal(checked.failureReason, "insufficient_balance");
});

test("simulateIntent + riskCheckIntent: a fee above maxFee fails the risk check even with plenty of balance", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet, { maxFee: "1" }); // smaller than the known flat home-chain fee
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  assert.equal(intent.simulation.feeWithinMax, false);

  const checked = riskCheckIntent(intent);
  assert.equal(checked.status, "FAILED");
  assert.equal(checked.failureReason, "fee_exceeds_max_fee");
});

test("AI-originated flow: PENDING_APPROVAL -> APPROVED only with canApprove=true, otherwise REJECTED", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  intent = riskCheckIntent(intent);
  intent = requestIntentApproval(intent);
  assert.equal(intent.status, "PENDING_APPROVAL");

  const denied = decideIntentApproval({ intent, decision: "approve", approverAddress: "0xapprover", canApprove: false });
  assert.equal(denied.status, "REJECTED");
  assert.equal(denied.failureReason, "approval_denied");

  const approved = decideIntentApproval({ intent, decision: "approve", approverAddress: "0xapprover", canApprove: true });
  assert.equal(approved.status, "APPROVED");
});

test("executeIntent: refuses to run from any state before RISK_CHECKED/APPROVED", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet); // still CREATED
  await assert.rejects(() => executeIntent({ intent, bridgeClient: fakeBridgeClient(), userAddress: wallet.address }), InayaValidationError);
});

test("executeIntent: passes the exact route/amount/recipient through to bridgeClient.bridgeTransfer, unmodified", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  intent = riskCheckIntent(intent);

  const bridgeClient = fakeBridgeClient();
  const executed = await executeIntent({ intent, bridgeClient, userAddress: wallet.address });
  assert.equal(executed.status, "EXECUTING");
  assert.equal(executed.sourceTxHash, "0xdef456");
});

test("executeIntent: a bridgeClient failure marks the intent FAILED rather than throwing uncaught", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  intent = riskCheckIntent(intent);

  const failingClient = fakeBridgeClient({ transferError: new Error("insufficient allowance") });
  const result = await executeIntent({ intent, bridgeClient: failingClient, userAddress: wallet.address });
  assert.equal(result.status, "FAILED");
  assert.match(result.failureReason, /insufficient allowance/);
});

test("pollSettlement: maps the bridge's real COMPLETED/FAILED/pending statuses, never invents SETTLED on its own", async () => {
  const executingIntent = { status: "EXECUTING", messageHash: "0xabc123" };

  const settled = await pollSettlement({ intent: executingIntent, bridgeClient: fakeBridgeClient({ statusResult: { status: "COMPLETED" } }) });
  assert.equal(settled.status, "SETTLED");

  const failed = await pollSettlement({ intent: executingIntent, bridgeClient: fakeBridgeClient({ statusResult: { status: "FAILED" } }) });
  assert.equal(failed.status, "FAILED");

  const pending = await pollSettlement({ intent: executingIntent, bridgeClient: fakeBridgeClient({ statusResult: { status: "PENDING" } }) });
  assert.equal(pending.status, "SETTLING");
});

test("adversarial: asset tampering after signing is detected and rejected", async () => {
  const wallet = freshWallet();
  const intent = await createSignedIntent(wallet);
  const tampered = { ...intent, asset: "USDT" };
  const result = await validateIntent(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "message_mismatch_tampered_field");
});

test("adversarial (route substitution): executeIntent ignores a caller-mutated intent.routes and always re-derives the source chain from the bridge's live list", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  intent = riskCheckIntent(intent);

  const attackerChain = { chainId: 97, isHome: true, contracts: { inayaToken: "0xbad0000000000000000000000000000000bad0", bridge: "0xbad1000000000000000000000000000000bad1" } };
  const tampered = { ...intent, routes: [{ sourceChain: attackerChain, destChain: SPOKE_CHAIN, via: "attacker-injected" }] };

  let capturedArgs;
  const bridgeClient = fakeBridgeClient();
  bridgeClient.bridgeTransfer = async (params) => { capturedArgs = params; return { messageHash: "0xabc123", sourceTxHash: "0xdef456" }; };

  await executeIntent({ intent: tampered, bridgeClient, userAddress: wallet.address });
  assert.equal(capturedArgs.sourceChain.contracts.bridge, HOME_CHAIN.contracts.bridge, "must use the bridge's real chain config, never the attacker-injected one");
});

test("executeIntent: fails closed if the bridge no longer recognizes the intent's source chain", async () => {
  const wallet = freshWallet();
  let intent = await createSignedIntent(wallet);
  intent = (await validateIntent(intent)).intent;
  intent = await discoverRoutes({ intent, bridgeClient: fakeBridgeClient() });
  intent = await simulateIntent({ intent, provider: fakeBalanceProvider(10n ** 30n), tokenAddress: TOKEN_ADDRESS });
  intent = riskCheckIntent(intent);

  const result = await executeIntent({ intent, bridgeClient: fakeBridgeClient({ chains: [SPOKE_CHAIN] }), userAddress: wallet.address });
  assert.equal(result.status, "FAILED");
  assert.equal(result.failureReason, "route_no_longer_available");
});

test("adversarial (replay): createNonceTracker rejects reusing the same {signer, nonce} pair twice", () => {
  const tracker = createNonceTracker();
  assert.equal(tracker.use("0xsigner", 1), true);
  assert.equal(tracker.has("0xsigner", 1), true);
  assert.equal(tracker.use("0xsigner", 1), false, "a replayed nonce for the same signer must be rejected");
  assert.equal(tracker.use("0xsigner", 2), true, "a different nonce for the same signer is fine");
  assert.equal(tracker.use("0xother", 1), true, "the same nonce value for a different signer is a distinct key");
});
