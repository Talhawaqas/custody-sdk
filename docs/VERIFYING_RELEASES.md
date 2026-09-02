# Verifying a `@inaya-network/custody-sdk` release

This package has no build step — `src/*.js` ships exactly as it sits in git (ESM,
explicit `.js` import extensions, hand-written `.d.ts`). That makes "reproducible build"
a much simpler bar than it usually is: there is nothing to *rebuild*, only to *prove the
published tarball is exactly the tagged source, byte for byte*.

## What gets published, and where

Every tagged release (`.github/workflows/release.yml`, triggered on `v*` tags) publishes:

- The package to npm, with [provenance](https://docs.npmjs.com/generating-provenance-statements)
  attached (`npm publish --provenance`) — visible on the npm package page and checkable
  with `npm audit signatures`. Provenance proves *which CI run* published a given version;
  it doesn't by itself prove *what's inside* the tarball matches the tagged source, which
  is what the rest of this doc is for.
- `CHECKSUMS.md` (this repo, committed at the release commit) — two SHA-256 hashes per
  release: one over the git tree at the tag, one over the actual npm tarball.
- The same two hashes, plus the tarball itself, attached to the GitHub Release for that
  tag.
- An IPFS content-addressed pin of the release tarball's contents (see the CID in
  `CHECKSUMS.md`/the GitHub Release) — see "Content-addressed delivery" below.

## Verifying a release yourself

```sh
git clone https://github.com/Talhawaqas/custody-sdk.git
cd custody-sdk
git checkout v1.0.8-beta   # the version you want to verify

# 1. Does the tag match a real, unaltered source tree?
git archive HEAD | sha256sum
# compare this output to "git-tree-sha256" in CHECKSUMS.md for this version

# 2. Does what npm actually delivers match what's tagged?
npm pack --dry-run=false
sha256sum inaya-network-custody-sdk-*.tgz
# compare this output to "npm-tarball-sha256" in CHECKSUMS.md

# 3. Optional: confirm the tagged source passes its own test suite,
#    including the cross-implementation compatibility proof.
npm ci
npm test
```

If both hashes match, you have independently confirmed: the git tag hasn't been
force-pushed or altered since release, and the code `npm install` actually delivers to a
consumer is exactly that tagged source — not something injected at publish time.

## Content-addressed delivery

The release tarball's contents are also pinned to IPFS (via Pinata) at publish time; the
resulting directory CID is recorded in `CHECKSUMS.md` and the GitHub Release body. A CID
is derived from the content itself, so it's independently re-checkable two ways: fetch by
CID from any IPFS gateway (not from a server Inaya controls) and hash what you get, or
re-pin the same tarball bytes yourself with any pinning tool and confirm you get the
identical CID back. Either way proves the address really does identify this exact
artifact, not just whatever Inaya's own infrastructure currently happens to be serving.

Single-provider (Pinata), not redundantly pinned across multiple providers the way user
file backups are (see `src/backup.js`) — a deliberate, documented choice: this is a small,
low-volume release artifact, not user data, so the redundancy story that matters for
uptime-sensitive file storage isn't proportionate here.

## What this does and does not guarantee

**Guarantees**: the code that produced a given release is exactly the tagged source in
this public repository; the published hashes are independently re-derivable by anyone,
not just trusted because Inaya says so; as of the web-crypto-consolidation change (see
`CHANGELOG.md`), this package's crypto is the same code path running for both web
(`inaya-network-dapp`) and mobile (`inaya-mobile`) uploads, not a separate, unverified
implementation.

**Does not guarantee**: that the live `inayanetwork.com` deployment is running this exact
build at this exact moment — see `inaya-network-dapp/docs/reproducible-builds-and-verification.md`
for how that app's own build ID is meant to help with (not fully solve) that gap; that the
desktop apps' remotely-loaded content matches what was verified here (they load the web
app at runtime — see that same doc); an implementation-bug-free audit of the underlying
cryptographic primitives beyond the cross-implementation compatibility testing in
`test/webCryptoCompat.test.mjs`; anything about mainnet security, since this SDK and the
network it talks to are testnet-stage today.
