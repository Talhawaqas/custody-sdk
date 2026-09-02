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
- `CHECKSUMS.md` (this repo, committed at the release commit) — a git tree hash and a
  SHA-256 over the actual npm tarball, per release.
- The same two hashes, plus the tarball itself, attached to the GitHub Release for that
  tag.
- An IPFS content-addressed pin of the release tarball's contents (see the CID in
  `CHECKSUMS.md`/the GitHub Release) — see "Content-addressed delivery" below.

## Verifying a release yourself

```sh
git clone https://github.com/Talhawaqas/custody-sdk.git
cd custody-sdk
git checkout v1.0.10-beta   # the version you want to verify

# 1. Does the tag match a real, unaltered source tree?
git rev-parse HEAD^{tree}
# compare this output to "git-tree-hash" in CHECKSUMS.md for this version.
# (Deliberately not `git archive | sha256sum` -- that hashes a tar serialization which
# isn't guaranteed byte-identical across git versions. The tree object id is git's own
# content hash and is the same on every git install, which is the actual point of a
# reproducibility check: two people on two different machines get the same answer.)

# 2. Does the published npm tarball's *content* match the tagged source?
#    Byte-for-byte re-packing (`npm pack` locally, then comparing sha256sum) isn't
#    reliable across npm versions -- gzip/tar metadata can differ even when every file's
#    content is identical. So verify content directly instead:
curl -LO https://github.com/Talhawaqas/custody-sdk/releases/download/v1.0.10-beta/inaya-network-custody-sdk-1.0.10-beta.tgz
sha256sum inaya-network-custody-sdk-1.0.10-beta.tgz
# compare to "npm-tarball-sha256" in CHECKSUMS.md -- this always matches, since you're
# hashing the literal file CI attached, not re-deriving it yourself.
mkdir /tmp/verify && tar -xzf inaya-network-custody-sdk-*.tgz -C /tmp/verify
for f in $(cd /tmp/verify/package && find . -type f); do
  diff <(git show "HEAD:${f#./}") "/tmp/verify/package/$f" || echo "MISMATCH: $f"
done
# no output (besides the loop itself) means every shipped file is byte-identical to the
# tagged source -- the actual proof that npm didn't inject or alter anything, independent
# of how the tarball itself was serialized.

# 3. Optional: confirm the tagged source passes its own test suite,
#    including the cross-implementation compatibility proof.
npm ci
npm test
```

If step 1 matches and step 2's file-by-file diff is clean, you have independently
confirmed: the git tag hasn't been force-pushed or altered since release, and the code
`npm install` actually delivers to a consumer is exactly that tagged source — not
something injected at publish time.

## Content-addressed delivery

The release tarball's contents are also pinned to IPFS (via Pinata) at publish time; the
resulting directory CID is recorded in `CHECKSUMS.md` and the GitHub Release body. A CID
is derived from the content itself, so it's independently re-checkable: fetch by CID from
any IPFS gateway (not from a server Inaya controls) and hash what you get, confirming it
matches `npm-tarball-sha256` in `CHECKSUMS.md`. (Re-pinning the *exact same tarball file*
you downloaded from the GitHub Release yourself will also reproduce the identical CID;
re-running `npm pack` locally and pinning that generally will not, for the same
tarball-byte-reproducibility reason described above.) Either check proves the address
really does identify this exact artifact, not just whatever Inaya's own infrastructure
currently happens to be serving.

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
network it talks to are testnet-stage today; that a freshly-run `npm pack` on your own
machine will produce byte-identical tarball bytes to the one CI published (npm doesn't
guarantee this across npm versions) — use the file-content diff in the previous section
for a verification method that doesn't depend on that.
