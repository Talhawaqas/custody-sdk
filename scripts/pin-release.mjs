// scripts/pin-release.mjs
//
// Content-addressed delivery for a custody-sdk release (Verifiable Inaya Client SOW,
// Phase 3). Run by .github/workflows/release.yml after `npm pack` produces the release
// tarball: extracts it into a temp directory and pins that directory to IPFS via the
// CLI's own pinDirectoryToIPFS() (packages/cli/src/pinDirectory.js) — reused directly
// rather than routed through inaya-network-dapp's src/lib/pinningProviders/, since that
// module is a dependency OF the dApp; custody-sdk shouldn't depend back on its own
// consumer for something this package can do standalone.
//
// Needs INAYA_RELEASE_PINATA_JWT — Inaya's own Pinata account credential for pinning
// OFFICIAL releases, deliberately a different secret from the PINATA_JWT an end
// developer sets locally to run `inaya deploy` against their own account (see
// pinDirectory.js's own security comment on that separation).
//
// Usage: node scripts/pin-release.mjs <path-to-tarball> <version>
// Prints the resulting CID to stdout on success (nothing else — the workflow captures it).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { walkDirectory, pinDirectoryToIPFS } from "../packages/cli/src/pinDirectory.js";

async function main() {
  const [tarballPath, version] = process.argv.slice(2);
  if (!tarballPath || !version) {
    console.error("Usage: node scripts/pin-release.mjs <path-to-tarball> <version>");
    process.exit(1);
  }
  const jwt = process.env.INAYA_RELEASE_PINATA_JWT;
  if (!jwt) {
    console.error("INAYA_RELEASE_PINATA_JWT is not set — cannot pin this release.");
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "custody-sdk-release-"));
  try {
    // tar ships with every GitHub Actions runner (Linux/macOS/Windows) and every
    // developer machine this would realistically run on — no new dependency needed.
    execFileSync("tar", ["-xzf", path.resolve(tarballPath), "-C", tmpDir], { stdio: "inherit" });

    // `npm pack` always extracts into a top-level "package/" directory.
    const extractedRoot = path.join(tmpDir, "package");
    if (!fs.existsSync(extractedRoot)) {
      throw new Error(`Expected a "package/" directory inside the tarball, found none in ${tmpDir}.`);
    }

    const { files } = walkDirectory(extractedRoot);
    const dirName = `custody-sdk-${version}`;
    const cid = await pinDirectoryToIPFS({ files, dirName, jwt });
    console.log(cid);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
