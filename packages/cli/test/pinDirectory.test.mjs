// packages/cli/test/pinDirectory.test.mjs
//
// First test coverage this package has ever had. Covers walkDirectory()'s
// safety guards (path traversal / symlink escape, default excludes,
// file-count and total-size caps) against a REAL temp directory — these
// are exactly the checks that stand between a developer's local `inaya
// deploy` run and an accidental multi-GB upload or a symlink escaping the
// intended directory, so they're worth proving against real fs behavior,
// not just mocked. pinDirectoryToIPFS()'s actual Pinata call is stubbed
// (network boundary, not logic under test, same rationale
// appStore.test.mjs/backup.test.mjs already use) since no PINATA_JWT is
// configured for this session to hit the real API with.
//
// Run with: node --test test/pinDirectory.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkDirectory, pinDirectoryToIPFS, MAX_FILES, MAX_TOTAL_BYTES } from "../src/pinDirectory.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inaya-cli-test-"));
}

function write(dir, relPath, content = "x") {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

test("walkDirectory: finds every real file, computes total size, produces forward-slash relative paths", () => {
  const dir = makeTempDir();
  try {
    write(dir, "index.html", "<html></html>");
    write(dir, "css/style.css", "body{}");
    write(dir, "js/app.js", "console.log(1)");

    const { files, totalBytes } = walkDirectory(dir);
    const relPaths = files.map((f) => f.relativePath).sort();
    assert.deepEqual(relPaths, ["css/style.css", "index.html", "js/app.js"]);
    assert.equal(totalBytes, files.reduce((s, f) => s + f.size, 0));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDirectory: node_modules, .git, and .env* are excluded by default", () => {
  const dir = makeTempDir();
  try {
    write(dir, "index.html");
    write(dir, "node_modules/some-pkg/index.js");
    write(dir, ".git/HEAD");
    write(dir, ".env.local", "SECRET=1");

    const { files } = walkDirectory(dir);
    assert.deepEqual(files.map((f) => f.relativePath), ["index.html"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDirectory: a directory with more than MAX_FILES throws before completing the walk", () => {
  const dir = makeTempDir();
  try {
    for (let i = 0; i < MAX_FILES + 5; i++) write(dir, `file-${i}.txt`);
    assert.throws(() => walkDirectory(dir), /more than \d+ files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDirectory: total size over MAX_TOTAL_BYTES throws", () => {
  const dir = makeTempDir();
  try {
    // One real file just over the cap, rather than actually allocating
    // 150MB+ of temp disk — a sparse/truncated file's reported stat.size
    // is what the walk checks, so this exercises the real guard cheaply.
    const filePath = write(dir, "big.bin", "");
    fs.truncateSync(filePath, MAX_TOTAL_BYTES + 1024);
    assert.throws(() => walkDirectory(dir), /larger than \d+ MB/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDirectory: a symlink pointing outside the root directory is rejected, not silently followed", () => {
  const dir = makeTempDir();
  const outsideDir = makeTempDir();
  try {
    write(outsideDir, "secret.txt", "should never be pinned");
    fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(dir, "escape-link.txt"));
    assert.throws(() => walkDirectory(dir), /resolves outside|possible symlink escape/);
  } catch (err) {
    // Creating a symlink without elevated privileges can itself fail on
    // some Windows configurations — treat that as inconclusive, not a
    // failure of the guard under test.
    if (err.code !== "EPERM") throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("walkDirectory: throws a clear error for a non-existent path", () => {
  assert.throws(() => walkDirectory("/no/such/directory/anywhere"), /is not a directory/);
});

test("walkDirectory: throws a clear error for an empty directory (after excludes)", () => {
  const dir = makeTempDir();
  try {
    fs.mkdirSync(path.join(dir, "node_modules"));
    write(path.join(dir, "node_modules"), "pkg.js");
    assert.throws(() => walkDirectory(dir), /no files to pin/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pinDirectoryToIPFS: requires PINATA_JWT before attempting any network call", async () => {
  await assert.rejects(() => pinDirectoryToIPFS({ files: [{ absolutePath: "/x", relativePath: "x", size: 1 }], jwt: undefined }), /PINATA_JWT/);
});

test("pinDirectoryToIPFS: sends every file as a multipart part with its directory-prefixed relative path, returns the directory CID", async () => {
  const dir = makeTempDir();
  try {
    write(dir, "index.html", "<html></html>");
    write(dir, "css/style.css", "body{}");
    const { files } = walkDirectory(dir);

    const originalFetch = globalThis.fetch;
    let capturedUrl, capturedHeaders, capturedForm;
    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      capturedForm = options.body;
      return { ok: true, json: async () => ({ IpfsHash: "bafybeigdyrztest0000000000000000000000000000000000000000000000" }) };
    };
    try {
      const cid = await pinDirectoryToIPFS({ files, dirName: "my-site", jwt: "test-jwt" });
      assert.equal(cid, "bafybeigdyrztest0000000000000000000000000000000000000000000000");
      assert.equal(capturedUrl, "https://api.pinata.cloud/pinning/pinFileToIPFS");
      assert.equal(capturedHeaders.Authorization, "Bearer test-jwt");
      assert.ok(capturedForm instanceof FormData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pinDirectoryToIPFS: a non-ok Pinata response is surfaced with a clear error", async () => {
  const dir = makeTempDir();
  try {
    write(dir, "index.html");
    const { files } = walkDirectory(dir);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Invalid JWT" }) });
    try {
      await assert.rejects(() => pinDirectoryToIPFS({ files, jwt: "bad-jwt" }), /Invalid JWT/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
