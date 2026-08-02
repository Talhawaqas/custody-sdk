# Inaya Media Viewer Template

A minimal dApp showing how to fetch and decrypt an Inaya-anchored asset for viewing — the read counterpart to the [Vault Template](../vault/README.md)'s write/upload flow. Pairs naturally with it: anchor a file with the Vault template, then view it back here using the resulting `fileHash`.

## Get started

```bash
npm install
npm run dev
```

No `PINATA_JWT` needed — this template only reads, via `InayaKernel.retrieveAndReconstruct()`, which fetches both encrypted shards from IPFS and decrypts them locally.

## Why this doesn't use `@inaya-network/react`'s `<InayaConnect/>`

`InayaConnect` derives a full `VaultKey` object — the right shape for the SDK's *encryption* functions (`disperseAndSlice`). `retrieveAndReconstruct()` only needs the raw passkey string directly, not a derived vault key, so pulling in `InayaConnect` here would mean deriving something this page never actually uses. `InayaKernel.connectWallet()` is simpler and matches exactly what this page needs.

## What it shows

- Connect a wallet (no wagmi needed — this template does no transactions, only reads).
- Enter a `fileHash` and the passkey it was encrypted with.
- `retrieveAndReconstruct()` reads the on-chain record, fetches both shards, and decrypts locally — with live progress via `onProgress`.
- The decrypted `dataUrl` is rendered with a type-appropriate preview (image, video, audio, PDF, or a plain download link as a fallback).
