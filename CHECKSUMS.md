# Release checksums

Two SHA-256 hashes per release, plus an IPFS content-addressed CID for the release
tarball. See `docs/VERIFYING_RELEASES.md` for what each one proves and exactly how to
reproduce them yourself. Appended to automatically by `.github/workflows/release.yml` on
every tagged release — never hand-edited for a real release entry.

- **git-tree-sha256** — `git archive <tag> | sha256sum`. Proves the tag matches an
  unaltered source tree.
- **npm-tarball-sha256** — `npm pack` then `sha256sum` the resulting `.tgz`. Proves what
  `npm install` delivers matches what was published.
- **ipfs-cid** — the directory CID the release tarball's contents are pinned under.
  Independently re-derivable by re-pinning the same tarball bytes with any IPFS tool.

<!-- New entries are appended below this line by the release workflow. -->

## v1.0.9-beta (2026-09-02)
- git-tree-sha256: `e3e59ae832016f8ce3da83c7ac93a1b36fcae1a6e702d5c04b35492bef4632c3`
- npm-tarball-sha256: `47c45eca60e895dce69d45e4c752f1cce55f7e6b81092cc3b61cfd4d81309b4a`
- ipfs-cid: (pinning failed for this release -- see the workflow run's "Pin release to IPFS" step; git-tree/npm-tarball hashes above are unaffected and remain the primary verification path)
