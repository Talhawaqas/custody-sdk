// packages/bridge-sdk/test/chains-sync.test.mjs
//
// Multi-chain SOW, Phase 1 — chains.js's own header comment admits this
// file is a deliberate duplicate of inaya-network-dapp/src/lib/chains.js's
// CHAIN_IDS/SOLANA_DEVNET_CHAIN_ID (small-per-package-copy over shared
// coupling, matching this codebase's convention). A deliberate duplicate
// is only safe if drift is caught, not just hoped against — this test is
// that catch: it imports both copies and fails loudly if a chain ID gets
// added/changed in one file and not the other, instead of silently
// shipping an SDK that resolves the wrong chain.
//
// Run with: node --test test/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAIN_IDS as SDK_CHAIN_IDS, SOLANA_DEVNET_CHAIN_ID as SDK_SOLANA_DEVNET_CHAIN_ID } from "../src/chains.js";
import { CHAIN_IDS as DAPP_CHAIN_IDS, SOLANA_DEVNET_CHAIN_ID as DAPP_SOLANA_DEVNET_CHAIN_ID } from "../../../../src/lib/chains.js";

test("bridge-sdk's CHAIN_IDS matches the dApp's — every key and value", () => {
  assert.deepEqual(SDK_CHAIN_IDS, DAPP_CHAIN_IDS, "bridge-sdk/src/chains.js has drifted from inaya-network-dapp/src/lib/chains.js's CHAIN_IDS — update both together.");
});

test("bridge-sdk's SOLANA_DEVNET_CHAIN_ID matches the dApp's", () => {
  assert.equal(SDK_SOLANA_DEVNET_CHAIN_ID, DAPP_SOLANA_DEVNET_CHAIN_ID);
});

test("the dApp's chains.js hasn't added a chain bridge-sdk doesn't know about yet", () => {
  const dappKeys = Object.keys(DAPP_CHAIN_IDS).sort();
  const sdkKeys = Object.keys(SDK_CHAIN_IDS).sort();
  assert.deepEqual(sdkKeys, dappKeys, "A chain was added to one CHAIN_IDS but not the other.");
});
