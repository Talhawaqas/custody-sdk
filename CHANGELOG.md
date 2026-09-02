# Changelog

All notable changes to `@inaya-network/custody-sdk` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts with the SOW that introduced release-verification infrastructure
(reproducible builds, published checksums, content-addressed delivery — see
`docs/VERIFYING_RELEASES.md`). Earlier history lives in `git log` — publishing before this
point was manual, undocumented per-release, so it isn't reconstructed here beyond a
summary. Going forward, `.github/workflows/release.yml` fails a tag push that doesn't
also update this file, so every released version has a real entry.

## [1.0.8-beta]

### Added
- `reconstructAndDecrypt` is now exposed on `InayaKernel` and as a named export (was
  previously implemented internally and used by `retrieveAndReconstruct()`, but not
  reachable directly — needed so consumers with their own shard-fetch logic, like
  inaya-network-dapp's dual-gateway fallback, can decrypt without going through the
  full on-chain-lookup-plus-fetch flow).
- `test/webCryptoCompat.test.mjs` — a committed, automated proof that this package's
  `@noble/`-based crypto and the browser `crypto.subtle`-based implementation it was
  ported from (and that inaya-network-dapp used to run independently) are byte-identical
  and cross-decryptable, not just claimed-compatible in a comment.
- `package.json`'s `files` allowlist (`src`, `README.md`, `LICENSE`) — the published npm
  tarball previously shipped the entire monorepo (~125 files, every `packages/*`
  workspace, tests, examples); now it ships only what `@inaya-network/custody-sdk` is.
- `CHECKSUMS.md`, `docs/VERIFYING_RELEASES.md`, `.github/workflows/release.yml` — release
  verification infrastructure (see that workflow/doc for what publishing a release now
  does and how a third party independently verifies one).

### Changed
- `inaya-network-dapp`'s own client-side encryption (previously two independent,
  duplicated `crypto.subtle` implementations — `src/lib/clientCrypto.js` and
  `src/app/page.js`'s inline copy, neither importing this SDK) now runs through this
  package's `deriveVaultKey`/`disperseAndSlice`/`reconstructAndDecrypt` directly. This
  package's crypto was originally *ported from* that dApp code; now the dApp imports it
  back, so verifying this package's source actually verifies what protects a web upload,
  not just what protects a mobile one.

## [1.0.7-beta]
Version bump; see `git log` around `1780ee6` for the underlying changes.

## [1.0.6-beta]
Added User-Controlled Master Node Passkey Backup & Recovery (`passkeyBackup.js`,
`createPasskeyBackup`/`restorePasskeyBackup`/`isPasskeyBackupEnvelope`).

## [1.0.4-beta] – [1.0.5-beta]
First public npm publish. The very first publish accidentally shipped `.claude/` dev
tooling and stress-test data dumps (no `.npmignore` existed yet) — fixed by hand-writing
`.npmignore` (superseded by the `files` allowlist above). Replaced `crypto.subtle` with
`@noble/hashes`/`@noble/ciphers` for React Native compatibility. Added the open-source
ecosystem packages: `@inaya-network/react`, `inaya-cli`, `create-inaya-dapp`.
