# Release checksums

A git tree hash plus an npm-tarball SHA-256 per release, plus an IPFS content-addressed
CID for the release tarball. See `docs/VERIFYING_RELEASES.md` for what each one proves
and exactly how to reproduce them yourself. Appended to automatically by
`.github/workflows/release.yml` on every tagged release — never hand-edited for a real
release entry.

- **git-tree-hash** — `git rev-parse <tag>^{tree}`, git's own content-addressed tree
  object id. Proves the tag matches an unaltered source tree. Deliberately *not*
  `git archive | sha256sum` (used through v1.0.9-beta below) — that hashes a tar
  serialization of the tree, which is not guaranteed byte-identical across git versions,
  so two honest verifiers on different git installs could get different hashes for
  identical content. The tree object id is git's own hash and is version-independent by
  construction.
- **npm-tarball-sha256** — `sha256sum` of the exact `.tgz` this release published and
  attached to its GitHub Release. Verify by downloading that attached file and hashing
  it, not by re-running `npm pack` locally — different npm versions are not guaranteed to
  produce byte-identical tarballs from identical source (gzip/tar metadata varies), even
  though the *contents* are identical. See `docs/VERIFYING_RELEASES.md` for a
  content-level check that sidesteps this.
- **ipfs-cid** — the directory CID the release tarball's contents are pinned under.
  Independently re-derivable by re-pinning the same tarball bytes with any IPFS tool.

<!-- New entries are appended below this line by the release workflow. -->

## v1.0.9-beta (2026-09-02)
- git-tree-sha256 (superseded method, see above): `b71520f9ee3611619c6f8f5df6462dca28d4f917ae74d00e7385c6ca7a6537eb`
- npm-tarball-sha256: `20d0bbdd967b676882cc92aea375057cc789dcc3a58877151c75cff75061e098`
- ipfs-cid: (pinning failed for this release -- see the workflow run's "Pin release to IPFS" step; git-tree/npm-tarball hashes above are unaffected and remain the primary verification path)
- Note: this entry's git-tree-sha256 was computed via `git archive HEAD | sha256sum`,
  the method retired in v1.0.10-beta for the cross-git-version reproducibility bug
  described above. It's still valid as a record of what CI actually built and published
  (the same commit's git-tree-hash is `git rev-parse v1.0.9-beta^{tree}`), just not
  reproducible via `git archive` on a different git version than CI's.

## v1.0.10-beta (2026-09-02)
- git-tree-hash: `61c6eebdc414989a7db49923ad3162efbd7d174d`
- npm-tarball-sha256: `5cdfbc768faa12de62b1c17478f4b2f8cd343821a2cea6ddd2168e916050bf29`
- ipfs-cid: (pinning failed for this release -- see the workflow run's "Pin release to IPFS" step; git-tree/npm-tarball hashes above are unaffected and remain the primary verification path)
