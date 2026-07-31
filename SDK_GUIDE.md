# @inaya-network/custody-sdk — Developer Guide

**Version:** 1.0.4-beta · **Last updated:** July 31, 2026 · BNB Chain Testnet

A client-side cryptographic sovereignty SDK for Inaya Network — encrypt, shard, anchor, and reconstruct files against the live testnet, with full TypeScript support, robustness features, and a client for the card-payment (no-wallet) flow.

---

## 1. Installation

```bash
npm install @inaya-network/custody-sdk ethers
```

`ethers` (v6) is a peer dependency, not bundled — install it alongside.

## 2. What This SDK Actually Does

Three layers, each independently usable:

1. **Crypto** (`crypto.js`) — client-side AES-GCM-256 encryption and binary sharding. Works in browsers *and* plain Node.js (verified — `readFileAsDataURL` uses the portable `file.arrayBuffer()` API, not the browser-only `FileReader`).
2. **On-chain** (`index.js`) — wraps `InayaCustody`'s `batchRegisterAssets`/`assets` calls and `InayaStaking`. Supports **dual-mode connections**: a browser wallet (via `connectWallet()`) or a server-held `ethers.Wallet` passed directly — the same pattern the actual Inaya backend uses to sign on a card customer's behalf.
3. **Payments** (`payments.js`) — a typed client for the card-payment backend routes (Corporate Reserve, PAYG, egress checkouts). **Does not contain any secrets** — it only calls `fetch()` against routes you deploy yourself.

## 3. Quick Start — Browser, Wallet-Connected Upload

```js
import { InayaKernel } from "@inaya-network/custody-sdk";

const connection = await InayaKernel.connectWallet();

const salt = InayaKernel.generateSecureSalt(16);
const vaultKey = await InayaKernel.deriveVaultKey({ passkey: "user-supplied-passkey", salt });
const sharded = await InayaKernel.disperseAndSlice({ file, encryptionKey: vaultKey });

// Pin sharded.shardAlpha / sharded.shardBeta to IPFS yourself here —
// this SDK doesn't bundle IPFS credentials. Use the returned CIDs below.

await InayaKernel.approveFeeTokens({ connection, fileSizeBytes: file.size });

const receipt = await InayaKernel.anchorToLedger({
  connection,
  fileName: sharded.filename,
  fileSizeBytes: file.size,
  dataShardAlpha: cidAlpha, // real IPFS CID, not the raw shard string
  dataShardBeta: cidBeta,
});

console.log(receipt.transactionHash, receipt.fileHash);
```

**Retrieve it back later:**
```js
const restored = await InayaKernel.retrieveAndReconstruct({
  connection,
  fileHash: receipt.fileHash,
  passkey: "user-supplied-passkey",
});
// restored.dataUrl — a data: URL, ready to render or download
```

## 4. Quick Start — Server-Side (Dual-Mode Connection)

No browser, no wallet extension — sign with a server-held key instead:

```js
import { ethers } from "ethers";
import { InayaKernel } from "@inaya-network/custody-sdk";

const provider = new ethers.JsonRpcProvider("https://data-seed-prebsc-1-s1.binance.org:8545");
const wallet = new ethers.Wallet(process.env.TREASURY_WALLET_PRIVATE_KEY, provider);
const connection = { provider: wallet }; // dual-mode: pass a Wallet directly instead of connectWallet()

const receipt = await InayaKernel.anchorToLedger({
  connection,
  fileName: "server-uploaded.txt",
  fileSizeBytes: 1024,
  dataShardAlpha: cidAlpha,
  dataShardBeta: cidBeta,
});
```

This is exactly the pattern the real Inaya backend uses in `stripe-webhook.js` to settle card payments on a customer's behalf — see `examples/nextjs-api-route.js` and `examples/node-script.mjs` for complete, runnable versions.

## 5. Progress Tracking — Two Patterns, Use Either or Both

**Per-call callback:**
```js
await InayaKernel.anchorToLedger({
  connection, fileName, fileSizeBytes, dataShardAlpha, dataShardBeta,
  onProgress: (p) => console.log(p.stage), // "hashing" -> "submitting" -> "confirming"
});
```

**Global event subscription** (useful for a status indicator elsewhere in your app that doesn't have direct access to the call site):
```js
InayaKernel.events.on("anchor:progress", (p) => console.log(p.stage));
InayaKernel.events.on("error", (p) => console.error(`${p.operation} failed:`, p.error));
```

TypeScript users get full payload-shape inference per event name — `events.on("anchor:progress", (p) => ...)` correctly types `p` as `AnchorProgress`, not `unknown`.

**Full event list:** `anchor:progress`, `anchor:complete`, `approve:progress`, `approve:complete`, `retrieve:progress`, `retrieve:complete`, `stake:progress`, `stake:complete`, `error`.

## 6. Retry Behavior — What's Automatic, What Isn't

| Operation type | Retried automatically? |
|---|---|
| Reading live fees, checking balances (read-only RPC calls) | ✅ Yes — up to 3 attempts, exponential backoff |
| Fetching shards from IPFS gateways | ✅ Yes — same policy |
| Submitting a transaction (`anchorToLedger`, `approveFeeTokens`'s approvals, `Staking.stake`) | ❌ Never |
| Contract reverts (`CALL_EXCEPTION`) or wallet rejections (`ACTION_REJECTED`) | ❌ Never, on purpose |

**Why transactions are never auto-retried:** resubmitting a transaction that may have already succeeded risks double-spending; resubmitting one that reverted just wastes gas on the same failure. Both categories need a human (or your own application logic) to decide what happened, not a blind retry.

Customize retry behavior directly if needed:
```js
import { withRetry } from "@inaya-network/custody-sdk/src/utils.js";
await withRetry(() => someOperation(), { retries: 5, baseDelayMs: 1000 });
```

## 7. The Payments Client — Card Payments, No Wallet

**Critical to understand before using this:** `InayaKernel.Payments` is a client for backend routes **you deploy yourself**. It contains zero payment logic, zero secrets — every function just calls `fetch()` against routes like `/api/create-payg-checkout-session`. The actual Stripe/treasury-wallet/database logic lives server-side in your own Next.js API routes (see the `backend-demo` folder in this repo for the reference implementation).

```js
import { InayaKernel } from "@inaya-network/custody-sdk";

// Start a PAYG upload checkout (after encrypting/sharding/pinning client-side)
const { checkoutUrl } = await InayaKernel.Payments.startPaygCheckout({
  filename: sharded.filename,
  sizeBytes: file.size,
  cidAlpha, cidBeta, fileHash,
});
window.location.href = checkoutUrl; // hand off to Stripe

// After the redirect back, resolve the session and recognize the customer
const { email } = await InayaKernel.Payments.resolveCheckoutSession({ sessionId });

// On every subsequent page load, recognize returning customers via cookie
const { email } = await InayaKernel.Payments.whoAmI();
```

**Same-origin vs. cross-origin:** if your frontend and backend share a domain (the normal case — a Next.js app calling its own `/api/*` routes), this works with zero configuration. If you're building a genuinely separate frontend calling someone else's deployed Inaya backend, the backend needs to send `Access-Control-Allow-Origin` headers, or the browser will block the request with a CORS error. Pass `apiBaseUrl` to point at a different origin:
```js
await InayaKernel.Payments.whoAmI({ apiBaseUrl: "https://inayanetwork.com" });
```

**Full method list:** `startCorporateReserveCheckout`, `startPaygCheckout`, `startEgressCheckout`, `resolveCheckoutSession`, `whoAmI`, `getCorporatePlanStatus`, `getPaygAssets`, `getEgressUnlockStatus`.

## 8. TypeScript

Fully typed — every function, every event payload. No `@types` package needed; the `.d.ts` files ship alongside the source.

```ts
import { InayaKernel, type WalletConnection, type AnchorToLedgerResult } from "@inaya-network/custody-sdk";

const connection: WalletConnection = await InayaKernel.connectWallet();
const receipt: AnchorToLedgerResult = await InayaKernel.anchorToLedger({ /* ... */ });
```

Verify your own integration compiles correctly against these types:
```bash
npx tsc --noEmit --strict your-file.ts
```

## 9. Testing This SDK Yourself

- **`test_harness.html`** — a browser-based manual test harness. Imports the *real* SDK files directly (not a reimplementation), covering wallet connect → encrypt/shard → anchor → retrieve → Payments client, against the live testnet. Serve with `npx serve .` and open in a browser (must be `http://localhost`, not a raw IP — Web Crypto requires a secure context).
- **`test_crypto_roundtrip.mjs`** — pure Node.js, no wallet needed, verifies the encrypt/decrypt round trip.
- **`diagnostic_check.mjs`** — pure Node.js, no wallet, checks whether the live contract/RPC are reachable and correctly configured — useful for isolating "is this my network/wallet, or the contract itself" when something's not working.
- **`type_check_test.ts`** — validates the `.d.ts` files actually compile against realistic usage; run with the same `tsc --noEmit --strict` command shown above.

## 10. Known Limitations — Read Before Reporting a Bug

1. **Egress has no on-chain enforcement.** Retrieval (`assets()`) is a public read; nothing in the deployed contract gates it. The `Payments.getEgressUnlockStatus`/`startEgressCheckout` pair is an *application-level* gate for card customers only — bypassable by anyone who already knows a `fileHash` and queries the chain/IPFS directly. Wallet-connected users currently have no egress gate of any kind.
2. **`InayaNetwork` (a second registry contract) is deployed but unused.** All reads/writes in this SDK go through `InayaCustody` exclusively — don't assume `INAYA_ADDRESSES.network` is part of the active data path.
3. **The Payments module assumes you've already deployed the backend routes.** Installing this npm package alone does not give you working payments — see `backend-demo/` for what needs deploying alongside it.
4. **Webhook idempotency is not implemented** on the reference backend. A Stripe retry could theoretically re-run an on-chain settlement twice for the same payment — worth adding before any real (non-testnet) usage.

## 11. Package Contents Reference

```
custody-sdk/
├── package.json
├── README.md
├── src/
│   ├── crypto.js / crypto.d.ts        — encryption, sharding
│   ├── contracts.js / contracts.d.ts  — ABIs + deployed addresses
│   ├── index.js / index.d.ts          — InayaKernel (main export)
│   ├── utils.js / utils.d.ts          — retry logic, event emitter
│   └── payments.js / payments.d.ts    — card-payment backend client
├── examples/
│   ├── ReactUploadWidget.jsx          — browser, wallet-connected
│   ├── nextjs-api-route.js            — server-side, dual-mode connection
│   └── node-script.mjs                — plain Node.js, full pipeline
├── test_harness.html                  — manual browser test, real SDK + live testnet
├── test_crypto_roundtrip.mjs
├── diagnostic_check.mjs
└── type_check_test.ts
```