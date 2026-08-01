# @inaya-network/custody-sdk — Developer Guide

**Version:** 1.0.4-beta · **Last updated:** August 1, 2026 · BNB Chain Testnet

A client-side cryptographic sovereignty SDK for Inaya Network — encrypt, shard, anchor, and reconstruct files against the live testnet, with full TypeScript support, robustness features, a client for the card-payment (no-wallet) flow, and an off-chain layer for rename/move/delete/share operations the on-chain contract itself doesn't support.

---

## 1. Installation

**Current alpha distribution — via GitHub, not npm's public registry yet:**

```bash
npm install github:Talhawaqas/custody-sdk ethers
```

This is a private repository. You'll need collaborator access granted (ask Talha) and git authentication configured on your machine (SSH key or a GitHub personal access token) — `npm install github:...` clones the repo under the hood, so the same auth npm uses for any private GitHub install applies here.

`ethers` (v6) is a peer dependency, not bundled — install it alongside regardless of which method above you used.

**Once this graduates to a public npm publish** (not yet — see the known limitations section for why), installation will simplify to:
```bash
npm install @inaya-network/custody-sdk ethers
```
Check back here or watch for an announcement before assuming that command works.

## 2. What This SDK Actually Does

Three layers, each independently usable:

1. **Crypto** (`crypto.js`) — client-side AES-GCM-256 encryption and binary sharding. Works in browsers *and* plain Node.js (verified — `readFileAsDataURL` uses the portable `file.arrayBuffer()` API, not the browser-only `FileReader`).
2. **On-chain** (`index.js`) — wraps `InayaCustody`'s `batchRegisterAssets`/`assets` calls and `InayaStaking` (see `InayaKernel.Staking` — `stake`/`unstake`/`claimReward`/`calculateReward`/`getStakedBalance`; `examples/StakingWidget.jsx` is a complete browser client). Supports **dual-mode connections**: a browser wallet (via `connectWallet()`) or a server-held `ethers.Wallet` passed directly — the same pattern the actual Inaya backend uses to sign on a card customer's behalf.
3. **Payments** (`payments.js`) — a typed client for the card-payment backend routes (Corporate Reserve, PAYG, egress checkouts). **Does not contain any secrets** — it only calls `fetch()` against routes you deploy yourself.
4. **Metadata** (`metadata.js`) — a typed client for rename/move/delete/virtual-folders/sharing, the same "zero secrets, bring-your-own-backend" shape as Payments. Exists because `InayaCustody.batchRegisterAssets()` is write-once on-chain (see §12's known limitations for how this was verified) — this module fills the gap with a server-backed layer authenticated by wallet signatures, not on-chain transactions.

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
| `Payments.*`/`Metadata.*` GET reads (`listFiles`, `whoAmI`, `getPaygAssets`, etc.) | ✅ Yes — same policy, including HTTP 5xx responses from your own backend |
| Submitting a transaction (`anchorToLedger`, `approveFeeTokens`'s approvals, `Staking.stake`) | ❌ Never |
| `Payments.*`/`Metadata.*` POSTs (checkouts, rename/move/delete/share) | ❌ Never — same rationale as transactions below: a POST that "failed" client-side may have already applied server-side |
| Contract reverts (`CALL_EXCEPTION`) or wallet rejections (`ACTION_REJECTED`) | ❌ Never, on purpose |
| HTTP 4xx responses (bad request, unauthorized, not found) | ❌ Never — client-side problem, retrying can't fix it |

**Why transactions are never auto-retried:** resubmitting a transaction that may have already succeeded risks double-spending; resubmitting one that reverted just wastes gas on the same failure. Both categories need a human (or your own application logic) to decide what happened, not a blind retry.

Customize retry behavior directly if needed:
```js
import { withRetry } from "@inaya-network/custody-sdk/src/utils.js";
await withRetry(() => someOperation(), { retries: 5, baseDelayMs: 1000 });
```

## 7. Error Handling

Every InayaKernel operation throws one of five typed errors instead of a raw ethers/JSON-RPC/wallet error, so you can branch on `instanceof` and a stable `.code` instead of pattern-matching message strings:

```js
import { InayaKernel, InayaWalletError, InayaContractError } from "@inaya-network/custody-sdk";

try {
  await InayaKernel.anchorToLedger({ connection, fileName, fileSizeBytes, dataShardAlpha, dataShardBeta });
} catch (err) {
  if (err instanceof InayaWalletError) {
    // user rejected in their wallet, insufficient funds, or a malformed connection object
  } else if (err instanceof InayaContractError) {
    // reverted, or gas estimation failed because it would have — err.code tells you which
  }
  console.error(err.message, err.code, err.cause); // .cause is always the original ethers/RPC error
}
```

| Class | `.code` examples | Meaning |
|---|---|---|
| `InayaValidationError` | `VALIDATION_ERROR` | Bad/missing arguments — caught before anything touched a wallet or the network. |
| `InayaWalletError` | `USER_REJECTED`, `INSUFFICIENT_FUNDS`, `NO_CONNECTION`, `INVALID_CONNECTION` | The connected wallet rejected, is missing, or can't cover the transaction. |
| `InayaContractError` | `CONTRACT_REVERTED`, `GAS_ERROR`, `ASSET_NOT_FOUND` | The contract reverted, or gas estimation failed because it would have. |
| `InayaNetworkError` | `NETWORK_ERROR`, `SHARD_FETCH_FAILED`, `HTTP_5xx` | Transient RPC/network/IPFS-gateway failure — the same class `withRetry()` already retries automatically before ever surfacing one of these. |
| `InayaError` | — | Base class every one of the above extends; catch this alone if you don't need to distinguish which kind. |

All five are also available via `InayaKernel.errors.*` if you'd rather not add named imports. `translateError()` (exported from `src/errors.js` for advanced use) is idempotent — safe to call on anything, including an error that's already one of these.

## 8. The Payments Client — Card Payments, No Wallet

**Critical to understand before using this:** `InayaKernel.Payments` is a client for backend routes **you deploy yourself**. It contains zero payment logic, zero secrets — every function just calls `fetch()` against routes like `/api/create-payg-checkout-session`. The actual Stripe/treasury-wallet/database logic lives server-side in your own Next.js API routes — see `examples/nextjs-payments-api-routes.js` for a reference implementation.

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

## 9. The Metadata Client — Rename/Move/Delete, Virtual Folders, Sharing

**Why this exists:** `InayaCustody.batchRegisterAssets()` is a write-once operation. This was confirmed directly against the live deployed contract — six plausible mutation function names (`deleteAsset`, `removeAsset`, `updateAsset`, `renameAsset`, `setAsset`, `unregisterAsset`) all cleanly reverted with empty data (the "no such function selector, no fallback" signature) against a live `eth_call`, while the real `assets(bytes32)` call succeeded normally even for a nonexistent key — see §12's known-limitations entry for the full trail. There is no on-chain way to rename, move, or delete a registered asset, so `InayaKernel.Metadata` fills that gap the same way `Payments` fills the card-payment gap: **a typed `fetch()` client with zero secrets and zero storage of its own** — the actual database lives in routes you deploy yourself (see `examples/nextjs-metadata-api-routes.js` for a complete reference implementation).

The fileHash and the encrypted shards themselves are **never** mutated by this module — only display name, folder placement, soft-delete state, and share grants live off-chain.

```js
import { InayaKernel } from "@inaya-network/custody-sdk";

// Right after anchorToLedger() succeeds, give the immutable fileHash a mutable name/folder:
await InayaKernel.Metadata.registerFileMetadata({ connection, fileHash: receipt.fileHash, filename: "Q3-report.pdf" });

// Rename, move, (soft-)delete — none of these touch the chain:
await InayaKernel.Metadata.renameFile({ connection, fileHash, newName: "Q3-report-final.pdf" });
const folder = await InayaKernel.Metadata.createFolder({ connection, name: "Reports" });
await InayaKernel.Metadata.moveFile({ connection, fileHash, folderId: folder.folderId });
await InayaKernel.Metadata.deleteFile({ connection, fileHash }); // soft delete — restoreFile() undoes it

// List a wallet's files/folders:
const { files } = await InayaKernel.Metadata.listFiles({ owner: address, folderId: folder.folderId });
const { folders } = await InayaKernel.Metadata.listFolders({ owner: address });

// Share a file with another wallet (you re-wrap the vault key yourself — this module just stores the grant):
await InayaKernel.Metadata.shareFile({ connection, fileHash, granteeAddress: "0x...", wrappedVaultKey });
const { shares } = await InayaKernel.Metadata.listSharedWithMe({ owner: address });
```

**Security model — read this before deploying a backend for this module.** Every mutating call is authenticated by a wallet signature (`personal_sign` over a canonical message), never a bare address in the request body. Your backend route must, before applying any mutation:

1. Recover the signer from `{ message, signature }` and confirm it equals the claimed `address`.
2. Recompute the expected message server-side from the request's other fields and confirm it matches exactly — stops a signature for one action/fileHash being replayed against a different one.
3. Reject stale signatures — a `timestamp` is embedded in the signed message; 5 minutes is a reasonable window.
4. **For file actions specifically:** read `InayaCustody.assets(fileHash)` on-chain (`InayaKernel` works server-side too — pass a dual-mode connection, same as `examples/nextjs-api-route.js`) and confirm `address` matches the real on-chain `owner`. This is the actual security anchor for the whole module. Folder/share actions have no on-chain equivalent to check against — ownership there is only ever whatever your own DB recorded at creation time.

Skipping step 4 in particular means anyone who learns a `fileHash` could rename, move, or delete someone else's file metadata — the fileHash alone proves nothing about who's allowed to mutate it.

**Full method list:** `registerFileMetadata`, `renameFile`, `moveFile`, `deleteFile`, `restoreFile`, `listFiles`, `createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`, `listFolders`, `shareFile`, `revokeShare`, `listSharedWithMe`.

See `examples/FileManagerWidget.jsx` for a complete browser-based client using all of the above against the reference backend in `examples/nextjs-metadata-api-routes.js`.

## 10. TypeScript

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

## 11. Testing This SDK Yourself

- **`test_harness.html`** — a browser-based manual test harness. Imports the *real* SDK files directly (not a reimplementation), covering wallet connect → encrypt/shard → anchor → retrieve → Payments client, against the live testnet. Serve with `npx serve .` and open in a browser (must be `http://localhost`, not a raw IP — Web Crypto requires a secure context).
- **`test_crypto_roundtrip.mjs`** — pure Node.js, no wallet needed, verifies the encrypt/decrypt round trip.
- **`diagnostic_check.mjs`** — pure Node.js, no wallet, checks whether the live contract/RPC are reachable and correctly configured — useful for isolating "is this my network/wallet, or the contract itself" when something's not working.
- **`type_check_test.ts`** — validates the `.d.ts` files actually compile against realistic usage; run with the same `tsc --noEmit --strict` command shown above.

## 12. Known Limitations — Read Before Reporting a Bug

1. **Egress has no on-chain enforcement.** Retrieval (`assets()`) is a public read; nothing in the deployed contract gates it. The `Payments.getEgressUnlockStatus`/`startEgressCheckout` pair is an *application-level* gate for card customers only — bypassable by anyone who already knows a `fileHash` and queries the chain/IPFS directly. Wallet-connected users currently have no egress gate of any kind.
2. **`InayaNetwork` (a second registry contract) is deployed but unused.** All reads/writes in this SDK go through `InayaCustody` exclusively — don't assume `INAYA_ADDRESSES.network` is part of the active data path.
3. **(Fixed 2026-08-01) The Payments module assumes you've already deployed the backend routes.** Installing this npm package alone does not give you working payments. This entry used to point at a `backend-demo/` folder that never actually existed anywhere in this repo — a dangling reference nobody had caught. Replaced with a real reference implementation: see `examples/nextjs-payments-api-routes.js` for what needs deploying alongside it.
4. **Webhook idempotency is not implemented** on the reference backend. A Stripe retry could theoretically re-run an on-chain settlement twice for the same payment — worth adding before any real (non-testnet) usage.
5. **(Fixed 2026-08-01) `INAYA_STAKING_ABI` didn't match the deployed `InayaStaking` contract.** The previous ABI (`stake(uint256)`, `unstake()`, `calculateReward()`, `stakedBalance()`) shared none of its function names with the real contract at `INAYA_ADDRESSES.staking` — every `Staking.*` call would have reverted. Found while wiring the mobile app's Staking screen against the same address and cross-checked directly against `contracts/InayaStaking.sol`. Replaced with the verified-correct ABI (`stake(amount, lockPeriodDays)`, `withdraw(amount)`, `claimReward()`, `earned()`, `userStakedBalance()`, `getUserTier()`, `totalStaked()`, `rewardRate()`, `lockExpiry()`, `enterpriseTierThreshold()`), and updated `Staking.stake/unstake/calculateReward/getStakedBalance` accordingly. Two behavior changes worth flagging for existing callers: `stake()` now takes an optional `lockPeriodDays` (0/30/90, default 0); `unstake()` now requires an `amount` (the real contract's `withdraw()` takes a partial amount, not an all-or-nothing exit) and no longer also pays out rewards — call the new `Staking.claimReward()` separately for that, matching the real contract's separate `withdraw()`/`claimReward()` functions. `INAYA_CUSTODY_ABI` and `INAYA_TOKEN_ABI` were checked against the same real contract sources (`InayaToken.sol`) and the web dApp's own contract calls and don't have this problem — both match exactly.
6. **(Confirmed 2026-08-01) `InayaCustody` has no on-chain mutation/delete/rename capability of any kind.** Went looking for this directly rather than assuming it from an absence of documentation: pulled the contract's live bytecode via `eth_getCode` and extracted its function selectors, then — because that same selector-extraction approach turned out to have a real blind spot on a larger 33-function contract (it missed `earned(address)` on `InayaStaking` due to compiler-generated binary-search dispatch instead of a linear if-chain, caught only by cross-checking with a live call) — re-verified Custody the more rigorous way: live `eth_call`s against six plausible mutation function names. All six reverted with empty data (`execution reverted: 0x`, no reason string — the signature of "no matching selector, no fallback"), while the real `assets(bytes32)` call on the same contract succeeded cleanly even with a dummy key. `batchRegisterAssets` is genuinely the only function that writes asset data, and it's write-once by design. This is the reason the new `Metadata` client (§9) exists as an off-chain layer rather than as additional on-chain contract calls.
7. **(Fixed 2026-08-01) `Payments`/`Metadata`'s GET reads weren't retried at all**, unlike every on-chain read in `index.js` — an audit of the retry mechanism found `postJSON`/`getJSON` in both modules called `fetch()` directly with no `withRetry()` wrapping. Fixed by wrapping `getJSON` in `withRetry()` in both files (POSTs are deliberately left un-retried — same rationale as not retrying transactions: a POST that "failed" client-side may have already applied server-side). Also hardened `defaultIsRetryable()` in `utils.js` to treat `HTTP_5xx` codes (your own backend's server errors) as retryable, while `HTTP_4xx` correctly still isn't.
8. **(Fixed 2026-08-01) No repository governance scaffolding existed** — Module 4 of the Phase 2 roadmap. Added `README.md` (the actual front door — this file was previously referenced in §13's package listing but didn't exist), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), and `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md` + `PULL_REQUEST_TEMPLATE.md`. Applying the actual `good first issue` label to specific issues still needs to happen in the GitHub UI/`gh` CLI — that's a live repo action, not a file this SDK ships.
9. **(Fixed 2026-08-01) `crypto.d.ts`'s `VaultKey.key` was still typed as `CryptoKey`**, a leftover from before the `crypto.subtle` → `@noble/hashes` rewrite (see limitation about React Native compatibility). `deriveVaultKey()` actually returns a raw `Uint8Array` digest — the old type would have made any strict-mode code touching `vaultKey.key` directly (e.g. checking `.algorithm`/`.extractable`) type-check against methods/properties that don't exist at runtime. Found during a full pass auditing every `.d.ts` against its matching `.js` for drift; fixed by correcting the type to `Uint8Array`.
10. **(Fixed 2026-08-01) `disperseAndSlice()` didn't actually work in plain Node.js**, despite §2 claiming it did — `readFileAsDataURL()` still called `new FileReader()`, a browser-only global with no Node equivalent, so any Node caller would crash before encryption even started. Caught by actually running `test_crypto_roundtrip.mjs` after fixing it to exercise the real `disperseAndSlice()`/`reconstructAndDecrypt()` functions instead of reimplementing encryption inline with the old `crypto.subtle` API (which is how it had been silently passing). Fixed by rebuilding `readFileAsDataURL()` on `file.arrayBuffer()`, which both browser File/Blob and Node 18+'s global File/Blob implement — the claim in §2 is now actually true. `crypto.js`'s validation throws were also switched from plain `Error` to `InayaValidationError`, closing the last gap in Module 2's standardized-error-handling work.

## 13. Package Contents Reference

```
custody-sdk/
├── package.json
├── package-lock.json
├── README.md                           — front door: install, 30-second example, links out
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SDK_GUIDE.md                        — the real documentation (this file)
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   ├── feature_request.md
│   │   └── config.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── src/
│   ├── crypto.js / crypto.d.ts        — encryption, sharding
│   ├── contracts.js / contracts.d.ts  — ABIs + deployed addresses
│   ├── index.js / index.d.ts          — InayaKernel (main export)
│   ├── utils.js / utils.d.ts          — retry logic, event emitter
│   ├── payments.js / payments.d.ts    — card-payment backend client
│   └── metadata.js / metadata.d.ts    — rename/move/delete/folders/sharing backend client
├── examples/
│   ├── ReactUploadWidget.jsx              — browser, wallet-connected upload
│   ├── StakingWidget.jsx                  — browser, stake/withdraw/claimReward + typed-error handling
│   ├── FileManagerWidget.jsx              — browser, the Metadata client (rename/move/delete/folders/sharing)
│   ├── nextjs-api-route.js                — server-side, dual-mode connection (upload)
│   ├── nextjs-payments-api-routes.js      — reference backend for the Payments client
│   ├── nextjs-metadata-api-routes.js      — reference backend for the Metadata client
│   └── node-script.mjs                    — plain Node.js, full pipeline
├── test_harness.html                  — manual browser test, real SDK + live testnet
├── test_crypto_roundtrip.mjs
├── diagnostic_check.mjs
└── type_check_test.ts
```

**Live repository:** github.com/Talhawaqas/custody-sdk
