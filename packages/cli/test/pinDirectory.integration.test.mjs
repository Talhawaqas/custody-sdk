// packages/cli/test/pinDirectory.integration.test.mjs
//
// pinDirectory.test.mjs stubs the Pinata call entirely (network boundary, not logic
// under test) -- which means the actual multi-file directory-CID behavior
// (pinFileToIPFS's filename-prefix trick producing ONE resolvable directory, per
// pinDirectory.js's own header comment) has never been verified against a real Pinata
// account anywhere in this codebase's history (see SDK_GUIDE.md's own caveat about this).
// This file closes that gap for real, but only runs when PINATA_JWT is actually set --
// same skip-when-unconfigured convention src/lib/pinningProviders already uses in the
// dApp, so this never blocks CI for contributors without Pinata credentials.
//
// Run with: node --test test/pinDirectory.integration.test.mjs
// (requires a real PINATA_JWT in the environment; silently skips otherwise)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkDirectory, pinDirectoryToIPFS } from "../src/pinDirectory.js";

const PINATA_JWT = process.env.PINATA_JWT;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inaya-cli-pin-integration-"));
}

test("pinDirectoryToIPFS: a real multi-file directory pin resolves back to identical content via a public gateway", { skip: !PINATA_JWT && "PINATA_JWT is not set -- skipping the real-network pin test." }, async () => {
  const dir = makeTempDir();
  try {
    const indexContent = `<!doctype html><title>pin test ${Date.now()}</title>`;
    const cssContent = `body { color: #00f2fe; }`;
    fs.writeFileSync(path.join(dir, "index.html"), indexContent);
    fs.mkdirSync(path.join(dir, "css"));
    fs.writeFileSync(path.join(dir, "css", "style.css"), cssContent);

    const { files } = walkDirectory(dir);
    const dirName = `inaya-sdk-pin-test-${Date.now()}`;
    const cid = await pinDirectoryToIPFS({ files, dirName, jwt: PINATA_JWT });
    assert.ok(cid && typeof cid === "string" && cid.length > 0, "pinDirectoryToIPFS must return a non-empty CID");

    // Fetch both files back from a public gateway and confirm byte-identical content --
    // this is the actual proof that Pinata's directory-wrap behaved as pinDirectory.js
    // assumes (a single CID containing both files at their relative paths), not just
    // that the API call succeeded.
    const fetchFromGateway = async (relPath) => {
      const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}/${relPath}`);
      if (!res.ok) throw new Error(`Gateway fetch failed for ${relPath}: HTTP ${res.status}`);
      return res.text();
    };

    // IPFS propagation to public gateways isn't instant -- retry briefly rather than
    // failing on the first miss.
    async function fetchWithRetry(relPath, attempts = 6, delayMs = 5000) {
      let lastErr;
      for (let i = 0; i < attempts; i++) {
        try {
          return await fetchFromGateway(relPath);
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      throw lastErr;
    }

    const fetchedIndex = await fetchWithRetry("index.html");
    const fetchedCss = await fetchWithRetry("css/style.css");
    assert.equal(fetchedIndex, indexContent, "index.html content must round-trip byte-for-byte through the pin");
    assert.equal(fetchedCss, cssContent, "css/style.css content must round-trip byte-for-byte through the pin");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
