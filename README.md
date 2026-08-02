# @inaya-network/custody-sdk

Client-side cryptographic sovereignty SDK for Inaya Network — encrypt, shard, anchor, and reconstruct files against BNB Chain Testnet, with full TypeScript support and a client for the card-payment (no-wallet) flow.

**Full documentation lives in [SDK_GUIDE.md](./SDK_GUIDE.md)** — quick starts, error handling, retry behavior, the Metadata (rename/move/delete/folders/sharing) client, TypeScript usage, testing, and known limitations. This file is just the front door.

## Install

```bash
npm install github:Talhawaqas/custody-sdk ethers
```

This is currently a private repository distributed via GitHub rather than npm's public registry — see [SDK_GUIDE.md §1](./SDK_GUIDE.md#1-installation) for access details. `ethers` (v6) is a peer dependency.

## 30-second example

```js
import { InayaKernel } from "@inaya-network/custody-sdk";

const connection = await InayaKernel.connectWallet();
const salt = InayaKernel.generateSecureSalt(16);
const vaultKey = await InayaKernel.deriveVaultKey({ passkey: "user-supplied-passkey", salt });
const sharded = await InayaKernel.disperseAndSlice({ file, encryptionKey: vaultKey });

// Pin sharded.shardAlpha / sharded.shardBeta to IPFS yourself, then:
await InayaKernel.approveFeeTokens({ connection, fileSizeBytes: file.size });
const receipt = await InayaKernel.anchorToLedger({
  connection,
  fileName: sharded.filename,
  fileSizeBytes: file.size,
  dataShardAlpha: cidAlpha,
  dataShardBeta: cidBeta,
});
```

See [SDK_GUIDE.md §3](./SDK_GUIDE.md#3-quick-start--browser-wallet-connected-upload) for the full walkthrough, including retrieval.

## What's in here

- **Crypto** (`src/crypto.js`) — client-side AES-GCM-256 encryption and binary sharding. Pure JS (`@noble/hashes` + `@noble/ciphers`), works in browsers, Node.js, and React Native alike.
- **On-chain** (`src/index.js`) — wraps the deployed `InayaCustody` and `InayaStaking` contracts. Dual-mode: browser wallet or a server-held `ethers.Wallet`.
- **Payments** (`src/payments.js`) — a typed client for the card-payment (no-wallet) backend routes.
- **Metadata** (`src/metadata.js`) — rename/move/delete, virtual folders, and sharing — an off-chain layer authenticated by wallet signatures, since the on-chain contract itself is write-once.

Runnable examples for React (upload, staking, file management), Next.js (all three backend clients), and plain Node.js are in [`examples/`](./examples).

## The wider ecosystem

This repo is also a monorepo for the tooling built on top of the SDK — see [`packages/`](./packages) for `@inaya-network/react` (drop-in UI components), `inaya-cli` (terminal/CI-CD tool), and `create-inaya-dapp` (project scaffolding).

## Contributing

Bug reports, feature requests, and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for how this repo is organized and what a good PR looks like. Please also read the [Code of Conduct](./CODE_OF_CONDUCT.md). Issues labeled [`good first issue`](https://github.com/Talhawaqas/custody-sdk/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are a good place to start.

## License

MIT
