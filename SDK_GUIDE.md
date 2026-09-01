# @inaya-network/custody-sdk — Developer Guide

**Version:** 1.0.5-beta · **Last updated:** August 24, 2026 · BNB Chain Testnet

A client-side cryptographic sovereignty SDK for Inaya Network — encrypt, shard, anchor, and reconstruct files against the live testnet, with full TypeScript support, robustness features, a client for the card-payment (no-wallet) flow, and an off-chain layer for rename/move/delete/share operations the on-chain contract itself doesn't support.

---

## 1. Installation

**Live on the public npm registry:**

```bash
npm install @inaya-network/custody-sdk ethers
```

`1.0.5-beta` is published under both the `beta` and `latest` dist-tags, so the plain install above resolves correctly — `npm install @inaya-network/custody-sdk@beta` also still works and points at the same version. The version string itself still says `-beta` (see the known limitations section for what a real stable release would mean here) even though it's what `latest` currently resolves to — don't read "installs without a tag" as "this has graduated out of beta."

`ethers` (v6) is a peer dependency, not bundled — install it alongside regardless.

**Still on GitHub too, if you'd rather track a specific commit:**
```bash
npm install github:Talhawaqas/custody-sdk ethers
```
This repo is private, so that path needs collaborator access (ask Talha) and git auth configured locally (SSH key or a GitHub PAT) — `npm install github:...` clones the repo under the hood, using the same auth npm uses for any private GitHub install.

## 2. What This SDK Actually Does

Five layers, each independently usable:

1. **Crypto** (`crypto.js`) — client-side AES-GCM-256 encryption and binary sharding. Works in browsers *and* plain Node.js (verified — `readFileAsDataURL` uses the portable `file.arrayBuffer()` API, not the browser-only `FileReader`).
2. **On-chain** (`index.js`) — wraps `InayaCustody`'s `batchRegisterAssets`/`assets` calls and `InayaStaking` (see `InayaKernel.Staking` — `stake`/`unstake`/`claimReward`/`calculateReward`/`getStakedBalance`; `examples/StakingWidget.jsx` is a complete browser client). Supports **dual-mode connections**: a browser wallet (via `connectWallet()`) or a server-held `ethers.Wallet` passed directly — the same pattern the actual Inaya backend uses to sign on a card customer's behalf.
3. **Payments** (`payments.js`) — a typed client for the card-payment backend routes (Corporate Reserve, PAYG, egress checkouts). **Does not contain any secrets** — it only calls `fetch()` against routes you deploy yourself.
4. **Metadata** (`metadata.js`) — a typed client for rename/move/delete/virtual-folders/sharing, the same "zero secrets, bring-your-own-backend" shape as Payments. Exists because `InayaCustody.batchRegisterAssets()` is write-once on-chain (see §13's known limitations for how this was verified) — this module fills the gap with a server-backed layer authenticated by wallet signatures, not on-chain transactions.
5. **Analytics** (`analytics.js`) — per-wallet storage statistics (`InayaKernel.Analytics.getWalletStorageStats()`), built entirely on data the SDK can already read. No new on-chain calls, no new backend beyond Metadata's existing `list-files` route. See §10 for the real constraints this works within (no on-chain file enumeration, no on-chain file-size field) and how it stays honest about them rather than fabricating numbers.

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

**Why this exists:** `InayaCustody.batchRegisterAssets()` is a write-once operation. This was confirmed directly against the live deployed contract — six plausible mutation function names (`deleteAsset`, `removeAsset`, `updateAsset`, `renameAsset`, `setAsset`, `unregisterAsset`) all cleanly reverted with empty data (the "no such function selector, no fallback" signature) against a live `eth_call`, while the real `assets(bytes32)` call succeeded normally even for a nonexistent key — see §13's known-limitations entry for the full trail. There is no on-chain way to rename, move, or delete a registered asset, so `InayaKernel.Metadata` fills that gap the same way `Payments` fills the card-payment gap: **a typed `fetch()` client with zero secrets and zero storage of its own** — the actual database lives in routes you deploy yourself (see `examples/nextjs-metadata-api-routes.js` for a complete reference implementation).

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

// Sharing (built 2026-08-03 — see §13 for the full story on how this replaced
// MetaMask's deprecated eth_getEncryptionPublicKey/eth_decrypt):
// 1. The RECIPIENT registers a sharing key once, ever (idempotent after that):
await InayaKernel.Metadata.registerEncryptionKey({ connection: recipientConnection });

// 2. The OWNER shares — looks up the recipient's key, encrypts the passkey for them,
//    and stores the result, all inside this one call:
await InayaKernel.Metadata.shareFile({ connection, fileHash, granteeAddress: "0x...", passkey });

// 3. The RECIPIENT recovers the passkey, then decrypts the file exactly like the owner would:
const { passkey: recoveredPasskey } = await InayaKernel.Metadata.getSharedFileKey({ connection: recipientConnection, fileHash });
// ...then fetch shardAlpha/shardBeta (e.g. via retrieveAndReconstruct()) and call
// InayaKernel.reconstructAndDecrypt({ shardAlpha, shardBeta, passkey: recoveredPasskey }).

const { shares } = await InayaKernel.Metadata.listSharedWithMe({ owner: recipientAddress });
await InayaKernel.Metadata.revokeShare({ connection, fileHash, granteeAddress: "0x..." }); // see the caveat below
```

**Security model — read this before deploying a backend for this module.** Every mutating call is authenticated by a wallet signature (`personal_sign` over a canonical message), never a bare address in the request body. Your backend route must, before applying any mutation:

1. Recover the signer from `{ message, signature }` and confirm it equals the claimed `address`.
2. Recompute the expected message server-side from the request's other fields and confirm it matches exactly — stops a signature for one action/fileHash being replayed against a different one.
3. Reject stale signatures — a `timestamp` is embedded in the signed message; 5 minutes is a reasonable window.
4. **For file actions specifically:** read `InayaCustody.assets(fileHash)` on-chain (`InayaKernel` works server-side too — pass a dual-mode connection, same as `examples/nextjs-api-route.js`) and confirm `address` matches the real on-chain `owner`. This is the actual security anchor for the whole module. Folder/share actions have no on-chain equivalent to check against — ownership there is only ever whatever your own DB recorded at creation time.

Skipping step 4 in particular means anyone who learns a `fileHash` could rename, move, or delete someone else's file metadata — the fileHash alone proves nothing about who's allowed to mutate it.

**Sharing's key exchange — how it actually works, and its honest limits.** `shareFile()` no longer takes a pre-built `wrappedVaultKey` you had to construct yourself (there was never a way to actually do that correctly before this was built) — it does the whole exchange internally:

- The recipient's wallet deterministically derives an X25519 keypair by signing one fixed message via `personal_sign` (`Metadata.deriveShareKeypair()` / `registerEncryptionKey()`) — the same wallet always reproduces the same keypair, so nothing needs to be stored client-side beyond the wallet itself.
- `shareFile()` looks up the recipient's registered public key and encrypts the owner's passkey for it using an ephemeral-sender X25519 + HKDF-SHA256 + XChaCha20-Poly1305 "sealed box" (`crypto.js`'s `encryptForPublicKey()` — the same construction as libsodium's `crypto_box_seal`).
- **This deliberately does not use MetaMask's `eth_getEncryptionPublicKey`/`eth_decrypt`.** Verified via web search before building (2026-08-03): those methods have been deprecated since 2022, the underlying EIP-1024 was abandoned, MetaMask itself no longer recommends them, and there's no evidence they work over WalletConnect-style connections — which is exactly how this project's mobile app connects (MetaMask Connect Multichain). Relying on them would likely have made sharing silently broken on mobile. `personal_sign` works identically everywhere, so that's what the recipient's keypair is derived from instead.
- **Scoping honesty:** this works for any wallet that can produce a `personal_sign` signature — effectively universal, but a recipient must call `registerEncryptionKey()` at least once before anyone can share with them. `shareFile()` throws a clear `InayaValidationError` (code `GRANTEE_NOT_REGISTERED`) rather than failing silently or fabricating a key if they haven't.
- **Revocation honesty:** `revokeShare()` stops *future* `getSharedFileKey()` calls for that recipient. It cannot retroactively un-decrypt a passkey the recipient already fetched and cached locally before revocation — that's a fundamental property of any share-then-revoke scheme, not a gap in this implementation. Communicate "revoke" to end users as "stop future access," not "delete their copy."

**Full method list:** `registerFileMetadata`, `renameFile`, `moveFile`, `deleteFile`, `restoreFile`, `listFiles`, `createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`, `listFolders`, `deriveShareKeypair`, `registerEncryptionKey`, `getEncryptionKey`, `shareFile`, `revokeShare`, `listSharedWithMe`, `getSharedFileKey`.

See `examples/FileManagerWidget.jsx` for a complete browser-based client using all of the above against the reference backend in `examples/nextjs-metadata-api-routes.js` — note the REAL deployed backend for this project lives in `inaya-network-dapp/src/app/api/metadata/*` (built 2026-08-03 alongside this feature; the example file remains illustrative/reference-only, matching its original purpose).

## 10. The Analytics Client — Storage Statistics

Per-wallet storage statistics (`InayaKernel.Analytics.getWalletStorageStats()`), built 2026-08-03 as pure aggregation on top of data the SDK can already read — no new on-chain writes, no new backend beyond Metadata's `list-files` route.

```js
const stats = await InayaKernel.Analytics.getWalletStorageStats({
  connection, // any read-only-capable connection — a signer isn't required, just a provider
  address: walletAddress,
});

console.log(stats.totalFilesStored, stats.totalBytesStored, stats.mostRecentActivity);
console.log(stats.uploadFrequency.daily); // [{ date: "2026-08-03", count: 3 }, ...]
```

**Two hard constraints this works within — verified before building, not assumed:**

1. **`InayaCustody` has no on-chain enumeration function.** Its only file-related read is `assets(bytes32)` — a single-fileHash lookup, nothing that answers "list every file wallet X owns." Confirmed by inspecting the deployed ABI in `contracts.js` and by attempting to pull the contract's full verified ABI/event list from BscScan testnet, which came back "Contract source code not verified." **`Metadata.listFiles()` (the off-chain DB) is therefore the only enumeration source that exists at all** — not a design choice, a hard limit of the deployed contract. Every file it returns is still individually cross-checked against `assets(fileHash)` before being counted (see `unreconciled`/`unreconciledCount` in the response) — a stale or tampered-with off-chain record can't silently inflate a wallet's reported stats.
2. **`assets(bytes32)` doesn't return file size.** Its return tuple is `(owner, shardACID, shardBCID, timestamp)` — `batchRegisterAssets()` takes `fileSizes` as a write-time parameter, but nothing in the deployed contract's read interface exposes it back out. The only place a file's size is recoverable from is `Metadata`'s `fileSizeBytes` field, which you should pass to `registerFileMetadata()` right after anchoring (see §9). This means `totalBytesStored` is a **client-reported, not chain-verified**, figure.

**This module never fabricates a number.** If any reconciled file is missing a known size, `totalBytesStored` is `null` — not `0`, and not a partial sum presented as if it were complete — because either of those would misrepresent real usage. `bytesUnavailableCount` tells the caller how many files are missing one. Verified end-to-end against a real anchored file during Module 1's E2E test (2026-08-03): `totalBytesStored` matched the real file's byte count exactly, `unreconciledCount` was `0` for an all-real dataset, and two fabricated fileHashes fed in during isolated testing correctly landed in `unreconciled` rather than being silently counted.

## 11. TypeScript

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

## 12. Testing This SDK Yourself

- **`test_harness.html`** — a browser-based manual test harness. Imports the *real* SDK files directly (not a reimplementation), covering wallet connect → encrypt/shard → anchor → retrieve → Payments client, against the live testnet. Serve with `npx serve .` and open in a browser (must be `http://localhost`, not a raw IP — Web Crypto requires a secure context).
- **`test_crypto_roundtrip.mjs`** — pure Node.js, no wallet needed, verifies the encrypt/decrypt round trip.
- **`diagnostic_check.mjs`** — pure Node.js, no wallet, checks whether the live contract/RPC are reachable and correctly configured — useful for isolating "is this my network/wallet, or the contract itself" when something's not working.
- **`type_check_test.ts`** — validates the `.d.ts` files actually compile against realistic usage; run with the same `tsc --noEmit --strict` command shown above.
- **`e2e_sharing_test.mjs`** (added 2026-08-03) — genuine two-real-wallet end-to-end test of the Metadata sharing flow: real file, real IPFS pinning, real on-chain anchor, real HTTP calls against a locally running `inaya-network-dapp` dev server's real `/api/metadata/*` routes. Requires `TREASURY_WALLET_PRIVATE_KEY`, `PINATA_SECRET_API_KEY` (used as a Bearer JWT — see the Pinata dashboard for the current name Pinata gives this token type), and the dApp running locally on port 3000. Also exercises the Analytics client against the same real anchored file.
- **`stress_test_protocol.mjs`** (added 2026-08-03) — one-off protocol diligence script, not a permanent feature: sequential + concurrent `batchRegisterAssets` writes and a larger concurrent `assets()` read burst against live BNB Chain Testnet. See `STRESS_TEST_REPORT.md` for the real results from the last run.

## 13. Known Limitations — Read Before Reporting a Bug

1. **Egress has no on-chain enforcement.** Retrieval (`assets()`) is a public read; nothing in the deployed contract gates it. The `Payments.getEgressUnlockStatus`/`startEgressCheckout` pair is an *application-level* gate for card customers only — bypassable by anyone who already knows a `fileHash` and queries the chain/IPFS directly. Wallet-connected users currently have no egress gate of any kind.
2. **`InayaNetwork` (a second registry contract) is deployed but unused.** All reads/writes in this SDK go through `InayaCustody` exclusively — don't assume `INAYA_ADDRESSES.network` is part of the active data path.
3. **(Fixed 2026-08-01) The Payments module assumes you've already deployed the backend routes.** Installing this npm package alone does not give you working payments. This entry used to point at a `backend-demo/` folder that never actually existed anywhere in this repo — a dangling reference nobody had caught. Replaced with a real reference implementation: see `examples/nextjs-payments-api-routes.js` for what needs deploying alongside it.
4. **Webhook idempotency is not implemented** on the reference backend. A Stripe retry could theoretically re-run an on-chain settlement twice for the same payment — worth adding before any real (non-testnet) usage.
5. **(Fixed 2026-08-01) `INAYA_STAKING_ABI` didn't match the deployed `InayaStaking` contract.** The previous ABI (`stake(uint256)`, `unstake()`, `calculateReward()`, `stakedBalance()`) shared none of its function names with the real contract at `INAYA_ADDRESSES.staking` — every `Staking.*` call would have reverted. Found while wiring the mobile app's Staking screen against the same address and cross-checked directly against `contracts/InayaStaking.sol`. Replaced with the verified-correct ABI (`stake(amount, lockPeriodDays)`, `withdraw(amount)`, `claimReward()`, `earned()`, `userStakedBalance()`, `getUserTier()`, `totalStaked()`, `rewardRate()`, `lockExpiry()`, `enterpriseTierThreshold()`), and updated `Staking.stake/unstake/calculateReward/getStakedBalance` accordingly. Two behavior changes worth flagging for existing callers: `stake()` now takes an optional `lockPeriodDays` (0/30/90, default 0); `unstake()` now requires an `amount` (the real contract's `withdraw()` takes a partial amount, not an all-or-nothing exit) and no longer also pays out rewards — call the new `Staking.claimReward()` separately for that, matching the real contract's separate `withdraw()`/`claimReward()` functions. `INAYA_CUSTODY_ABI` and `INAYA_TOKEN_ABI` were checked against the same real contract sources (`InayaToken.sol`) and the web dApp's own contract calls and don't have this problem — both match exactly.
6. **(Confirmed 2026-08-01) `InayaCustody` has no on-chain mutation/delete/rename capability of any kind.** Went looking for this directly rather than assuming it from an absence of documentation: pulled the contract's live bytecode via `eth_getCode` and extracted its function selectors, then — because that same selector-extraction approach turned out to have a real blind spot on a larger 33-function contract (it missed `earned(address)` on `InayaStaking` due to compiler-generated binary-search dispatch instead of a linear if-chain, caught only by cross-checking with a live call) — re-verified Custody the more rigorous way: live `eth_call`s against six plausible mutation function names. All six reverted with empty data (`execution reverted: 0x`, no reason string — the signature of "no matching selector, no fallback"), while the real `assets(bytes32)` call on the same contract succeeded cleanly even with a dummy key. `batchRegisterAssets` is genuinely the only function that writes asset data, and it's write-once by design. This is the reason the new `Metadata` client (§9) exists as an off-chain layer rather than as additional on-chain contract calls.
7. **(Fixed 2026-08-01) `Payments`/`Metadata`'s GET reads weren't retried at all**, unlike every on-chain read in `index.js` — an audit of the retry mechanism found `postJSON`/`getJSON` in both modules called `fetch()` directly with no `withRetry()` wrapping. Fixed by wrapping `getJSON` in `withRetry()` in both files (POSTs are deliberately left un-retried — same rationale as not retrying transactions: a POST that "failed" client-side may have already applied server-side). Also hardened `defaultIsRetryable()` in `utils.js` to treat `HTTP_5xx` codes (your own backend's server errors) as retryable, while `HTTP_4xx` correctly still isn't.
8. **(Fixed 2026-08-01) No repository governance scaffolding existed** — Module 4 of the Phase 2 roadmap. Added `README.md` (the actual front door — this file was previously referenced in §14's package listing but didn't exist), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), and `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md` + `PULL_REQUEST_TEMPLATE.md`. Applying the actual `good first issue` label to specific issues still needs to happen in the GitHub UI/`gh` CLI — that's a live repo action, not a file this SDK ships.
9. **(Fixed 2026-08-01) `crypto.d.ts`'s `VaultKey.key` was still typed as `CryptoKey`**, a leftover from before the `crypto.subtle` → `@noble/hashes` rewrite (see limitation about React Native compatibility). `deriveVaultKey()` actually returns a raw `Uint8Array` digest — the old type would have made any strict-mode code touching `vaultKey.key` directly (e.g. checking `.algorithm`/`.extractable`) type-check against methods/properties that don't exist at runtime. Found during a full pass auditing every `.d.ts` against its matching `.js` for drift; fixed by correcting the type to `Uint8Array`.
10. **(Fixed 2026-08-01) `disperseAndSlice()` didn't actually work in plain Node.js**, despite §2 claiming it did — `readFileAsDataURL()` still called `new FileReader()`, a browser-only global with no Node equivalent, so any Node caller would crash before encryption even started. Caught by actually running `test_crypto_roundtrip.mjs` after fixing it to exercise the real `disperseAndSlice()`/`reconstructAndDecrypt()` functions instead of reimplementing encryption inline with the old `crypto.subtle` API (which is how it had been silently passing). Fixed by rebuilding `readFileAsDataURL()` on `file.arrayBuffer()`, which both browser File/Blob and Node 18+'s global File/Blob implement — the claim in §2 is now actually true. `crypto.js`'s validation throws were also switched from plain `Error` to `InayaValidationError`, closing the last gap in Module 2's standardized-error-handling work.
11. **(Fixed 2026-08-03) `shareFile()`'s key re-wrapping was never actually built** — the method accepted a `wrappedVaultKey` parameter, but nothing in this SDK could produce one correctly, so sharing was non-functional despite having a complete-looking API surface. Built as X25519 (ephemeral-sender ECIES "sealed box") + HKDF-SHA256 + XChaCha20-Poly1305, with each wallet's keypair deterministically derived from a `personal_sign` signature of a fixed message — deliberately NOT MetaMask's `eth_getEncryptionPublicKey`/`eth_decrypt`, which web search confirmed have been deprecated since 2022 (EIP-1024 abandoned, MetaMask itself no longer recommends them) with no evidence of support over WalletConnect-style connections, which is how this project's own mobile app connects. See §9 for the full API and its two honest scoping caveats (registration is required before receiving a share; revocation is not retroactive). Verified with a genuine two-real-wallet end-to-end test (real file, real IPFS pinning, real on-chain anchor, real HTTP calls against the real new `inaya-network-dapp/src/app/api/metadata/*` backend) rather than a mocked unit test — every check passed, including the wrong-recipient and post-revocation rejection cases.
12. **(Discovered 2026-08-03, real backend for Metadata never existed until now) `inaya-network-dapp` had no `api/metadata/*` routes at all** — `custody-sdk`'s `examples/nextjs-metadata-api-routes.js` was always illustrative-only (comments describing what a real DB call would look like), and no one had actually deployed a working backend for the Metadata module, sharing or otherwise. Building Module 1's genuine E2E test required a real, reachable backend to call, so the routes needed for the sharing flow (`register-encryption-key`, `get-encryption-key`, `share-file`, `revoke-share`, `get-shared-file-key`, `list-shared-with-me`) plus the two Analytics depends on (`register-file`, `list-files`) were built for real, MongoDB-backed, with the same four-step signature/ownership verification as the illustrative example. **The rest of Metadata's surface (`rename-file`, `move-file`, `delete-file`, `restore-file`, `create-folder`, `rename-folder`, `move-folder`, `delete-folder`, `list-folders`) still has no real backend** — out of scope for this SOW's Module 1 (sharing) and Module 2 (analytics), flagged honestly rather than silently left implied-working.
13. **(Confirmed 2026-08-03) Stress testing surfaced a real fee-token allowance gap, and a real public-RPC read-concurrency ceiling.** See `STRESS_TEST_REPORT.md` for the full write-up with real numbers from two live runs against BNB Chain Testnet. Short version: a burst of writes will silently start failing partway through if the caller's pre-approved fee-token allowance wasn't sized for the whole batch (not a contract bug — an operational gap in how the caller manages approval); and the free public RPC endpoint this SDK defaults to reliably handles ~100 concurrent reads but reliably fails at 150+, which any high-concurrency read workload should plan around (client-side throttling, retry-on-transient-failure — `withRetry()` already does the latter automatically — or a dedicated RPC endpoint).
14. **(Fixed 2026-08-24) The package had no `.npmignore`, so the very first npm publish (`1.0.4-beta`) accidentally bundled internal `.claude/` dev-tooling config (no secrets — just Claude Code permission allow-lists) and two disposable raw stress-test JSON dumps (~77KB) that were never meant to ship. Caught by inspecting the actual published tarball contents rather than assuming a clean publish. Fixed in `1.0.5-beta` with a real `.npmignore` — worth flagging for future maintainers: an `.npmignore` file *replaces* npm's gitignore-fallback entirely rather than adding to it, so it has to restate everything `.gitignore` already excluded (`node_modules/`, `.expo/`, `storybook-static/`) or those silently start shipping too. Verified via `npm publish --dry-run` before the real publish: file count and package size dropped by exactly the 5 removed files (~77KB), nothing else changed. `1.0.4-beta` was left published rather than unpublished (no secrets were in it, and npm discourages unpublishing) — `1.0.5-beta` supersedes it under the same `beta` dist-tag.
15. **(2026-08-24) `1.0.5-beta` is also tagged `latest`, at the maintainer's request** — `npm install @inaya-network/custody-sdk` (no tag) now resolves to it too, alongside `npm install @inaya-network/custody-sdk@beta`. The version string itself is unchanged (still `1.0.5-beta`) — tagging it `latest` is a distribution decision, not a claim that anything about the code's stability changed. Treat it accordingly: a plain install now gets a beta-labeled release by default.
16. **(Fixed 2026-08-24) Item 12's gap is closed — the rest of Metadata's backend now exists.** `rename-file`, `move-file`, `delete-file`, `restore-file`, `create-folder`, `rename-folder`, `move-folder`, `delete-folder`, and `list-folders` are all real, MongoDB-backed routes now in `inaya-network-dapp/src/app/api/metadata/`, following the exact same signature + on-chain-owner verification pattern `register-file`/`share-file` already used (folders have no on-chain anchor, so folder actions verify against this collection's own recorded `owner` instead — see `verifyDbFolderOwner()` in `metadata-auth.js`). `deleteFolder` orphans contained files AND child folders back to root (`folderId`/`parentFolderId`: `null`) rather than cascading, matching this file's own module comment. Verified: the 5 folder routes end-to-end for real (create → rename → move → list → delete, including the orphaning behavior and a wrong-signer rejection); the 4 file routes' auth/on-chain-ownership rejection paths for real (they correctly 403 rather than crash against a `fileHash` with no on-chain asset, and correctly reject a tampered signature) — full happy-path testing against a genuinely on-chain-anchored file wasn't done in this pass (would need a real testnet write), but the mutation logic is the same `findOneAndUpdate` shape already proven correct by `register-file` in production.

## 14. Package Contents Reference

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
│   ├── metadata.js / metadata.d.ts    — rename/move/delete/folders/sharing backend client
│   ├── analytics.js / analytics.d.ts  — per-wallet storage statistics
│   └── backup.js / backup.d.ts        — replica redundancy status/health/recovery backend client
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

## 15. The Backup Client — Replica Redundancy & Recovery

Added for the Backup & Recovery Mechanism SOW (`docs/backup-redundancy-architecture.md` in the
dApp repo) — appended here as its own section rather than renumbered into §§8–10 to avoid
disturbing every cross-reference elsewhere in this guide (several sections above reference each
other by number, e.g. §16 references §9 and §14).

**Not to be confused with `createPasskeyBackup`/`restorePasskeyBackup`** (flat top-level
`InayaKernel` methods, §2's crypto primitives) — those back up your *passkey*, entirely locally,
zero network calls. `InayaKernel.Backup` backs up *file shard data* across independent storage
providers (redundancy for the ciphertext itself) — a completely different, server-backed concern.

```js
// Read-only, unauthenticated
const status = await InayaKernel.Backup.getBackupStatus({ fileHash });
console.log(status.healthState); // "Protected" | "Rebuilding" | "Degraded" | "RecoveryRequired" | "RecoveryFailed"

const health = await InayaKernel.Backup.getBackupHealth({ fileHash }); // concise version of the above
const redundancy = await InayaKernel.Backup.getRedundancyStatus({ fileHash }); // replica count vs. target, per shard
const recovery = await InayaKernel.Backup.getRecoveryStatus({ fileHash }); // in-flight/last recovery job

// Mutating, wallet-signature authenticated (same signMetadataAction-style signing as Metadata)
const connection = await InayaKernel.connectWallet();
await InayaKernel.Backup.requestRecovery({ connection, fileHash }); // forces an immediate recovery attempt instead of waiting for the next automatic sweep
```

**Requires a real backend** — same story as Payments/Metadata: this client is a typed fetch
wrapper with no storage of its own. The reference implementation
(`inaya-network-dapp/src/app/api/backup/*`, `src/lib/backupEngine.js`) is real, deployed, and
MongoDB-backed, not illustrative-only.

**Honest scoping**: redundancy is provider-diversity (replicating each shard across independent
pinning providers), not erasure coding — it doesn't change the underlying 2-of-2 shard split, so
losing *both* shards' entire replica sets independently still loses the file, same as before this
existed. See the architecture doc's §2 for the full reasoning. As of this writing, only one
pinning provider (Pinata) has real credentials configured — a second (Filebase) is fully coded but
not yet live, so every asset's real, current status correctly reports `Degraded` (1 of 2 target
replicas) rather than a false `Protected`.

**Live repository:** github.com/Talhawaqas/custody-sdk
