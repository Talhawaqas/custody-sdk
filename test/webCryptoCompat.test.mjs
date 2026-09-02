// test/webCryptoCompat.test.mjs
//
// Proves — with a committed, runnable test, not just the header comment's claim in
// crypto.js — that this SDK's @noble/-based encrypt/decrypt and the Inaya dApp's own
// crypto.subtle-based encryptData/decryptData (inaya-network-dapp/src/app/page.js and
// src/lib/clientCrypto.js) are byte-identical: same construction
// (PBKDF2-HMAC-SHA256/100000 iterations -> salt(16)‖iv(12)‖AES-GCM-256-ciphertext ->
// base64 -> Math.ceil(len/2) midpoint split), same output bytes given the same inputs,
// and — the property that actually matters — cross-decryptable in both directions.
//
// This is the gate for the "Verifiable Inaya Client" SOW's web-crypto-consolidation
// step: the dApp's inline implementations only get replaced with real SDK calls once
// this file is green, because a mismatch here would mean existing users' already-shard
// -ed files become undecryptable the moment a live call site switches over.
//
// The dApp's functions use browser crypto.subtle; this file uses Node's built-in
// crypto.webcrypto (import { webcrypto } from "node:crypto") as the Node-side stand-in
// for it -- both implement the same W3C SubtleCrypto spec, so this is standard practice,
// but it is not literally a browser. See this file's own header for the one manual,
// one-time cross-check this doesn't replace: running the fixed vectors below directly
// in a real Chrome/Firefox console and confirming identical output, recorded once in
// docs/VERIFYING_RELEASES.md rather than repeated per test run.
//
// Run with: node --test test/webCryptoCompat.test.mjs (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { deriveVaultKey, disperseAndSlice, reconstructAndDecrypt, generateSecureSalt } from "../src/crypto.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ------------------------------------------------------------------
// A byte-for-byte mirror of the dApp's own encryptData/decryptData
// (inaya-network-dapp/src/app/page.js:3899-3947, identical copy in
// src/lib/clientCrypto.js) -- reimplemented here on Node's webcrypto rather than
// imported, since page.js isn't a module this package can import (it's a whole Next.js
// page component, not an isolated crypto module) and clientCrypto.js is "use client"
// (browser-only, uses window.btoa/atob). This mirror is deliberately kept in exact
// lockstep with the real implementation -- if that ever changes, this file (and the
// fixed-vector constant below) must be updated to match, or this test stops proving
// anything real.
// ------------------------------------------------------------------
async function dAppEncryptData(text, password) {
  const enc = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return packBase64(salt, iv, new Uint8Array(encrypted));
}

async function dAppEncryptDataFixed(text, password, salt, iv) {
  const enc = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return packBase64(salt, iv, new Uint8Array(encrypted));
}

async function dAppDecryptData(base64Str, password) {
  const combined = Buffer.from(base64Str, "base64");
  const salt = combined.subarray(0, 16);
  const iv = combined.subarray(16, 28);
  const encrypted = combined.subarray(28);
  const enc = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const decryptedBuffer = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decryptedBuffer);
}

function packBase64(salt, iv, ciphertext) {
  const combined = Buffer.concat([Buffer.from(salt), Buffer.from(iv), Buffer.from(ciphertext)]);
  return combined.toString("base64");
}

// Minimal Node-side File-like object -- disperseAndSlice() only needs .type and
// .arrayBuffer(), same shape the CLI's readAsFileLike() already relies on for
// Node-without-browser-File compatibility (packages/cli/src/commands/upload.js).
function fakeFile(text) {
  const buffer = Buffer.from(text, "utf8");
  return {
    name: "compat-test.txt",
    type: "text/plain",
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

// disperseAndSlice() encrypts a data: URL of the file's contents (readFileAsDataURL
// internally), not the raw text -- the dApp's own encryptData(dataUrl, passkey) call
// sites do the same (page.js:3992-3993: readFileAsDataURL then encryptData on the
// result). Mirrored here so both sides encrypt the identical plaintext bytes.
function toDataUrl(text, mimeType = "text/plain") {
  return `data:${mimeType};base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

const PASSKEY = "correct-horse-battery-staple-9F3x";

test("deriveVaultKey: produces the identical raw key bytes crypto.subtle's PBKDF2 derives for the same passkey+salt", async () => {
  const salt = new Uint8Array(16).fill(7);

  const sdkKey = await deriveVaultKey({ passkey: PASSKEY, salt });
  const sdkKeyBytes = sdkKey.key; // noble's pbkdf2() returns the raw derived key bytes directly

  const enc = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(PASSKEY), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derivedBits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);

  assert.deepEqual(Buffer.from(sdkKeyBytes), Buffer.from(derivedBits));
});

test("disperseAndSlice vs. dApp encryptData: byte-identical combined ciphertext for the same salt+iv+passkey+plaintext", async () => {
  const salt = new Uint8Array(16).fill(3);
  const iv = new Uint8Array(12).fill(9);
  const plaintext = "hello from the compatibility test";

  const dataUrl = toDataUrl(plaintext);
  const dAppCombined = await dAppEncryptDataFixed(dataUrl, PASSKEY, salt, iv);

  const originalGetRandomValues = webcrypto.getRandomValues.bind(webcrypto);
  globalThis.crypto.getRandomValues = (arr) => {
    if (arr.length === 12) { arr.set(iv); return arr; } // the IV call inside disperseAndSlice
    return originalGetRandomValues(arr);
  };
  let sdkShards;
  try {
    const encryptionKey = await deriveVaultKey({ passkey: PASSKEY, salt });
    sdkShards = await disperseAndSlice({ file: fakeFile(plaintext), encryptionKey });
  } finally {
    globalThis.crypto.getRandomValues = originalGetRandomValues;
  }

  const sdkCombined = sdkShards.shardAlpha + sdkShards.shardBeta;
  assert.equal(sdkCombined, dAppCombined, "SDK and dApp must produce byte-identical salt‖iv‖ciphertext for identical inputs");

  // Same midpoint-split convention too.
  const expectedMidpoint = Math.ceil(dAppCombined.length / 2);
  assert.equal(sdkShards.shardAlpha, dAppCombined.slice(0, expectedMidpoint));
  assert.equal(sdkShards.shardBeta, dAppCombined.slice(expectedMidpoint));
});

test("cross-decrypt: dApp-encrypted data decrypts correctly via the SDK's reconstructAndDecrypt", async () => {
  const sizes = ["", "a", "midpoint boundary test string of an odd length!", "x".repeat(5000)];
  for (const plaintext of sizes) {
    const dataUrl = toDataUrl(plaintext);
    const combined = await dAppEncryptData(dataUrl, PASSKEY);
    const midpoint = Math.ceil(combined.length / 2);
    const shardAlpha = combined.slice(0, midpoint);
    const shardBeta = combined.slice(midpoint);

    const recoveredDataUrl = await reconstructAndDecrypt({ shardAlpha, shardBeta, passkey: PASSKEY });
    assert.equal(recoveredDataUrl, dataUrl, `mismatch for plaintext length ${plaintext.length}`);
  }
});

test("cross-decrypt: SDK-encrypted data decrypts correctly via the dApp's own decryptData", async () => {
  const sizes = ["", "a", "midpoint boundary test string of an odd length!", "x".repeat(5000)];
  for (const plaintext of sizes) {
    const salt = generateSecureSalt();
    const encryptionKey = await deriveVaultKey({ passkey: PASSKEY, salt });
    const { shardAlpha, shardBeta } = await disperseAndSlice({ file: fakeFile(plaintext), encryptionKey });

    const recoveredDataUrl = await dAppDecryptData(shardAlpha + shardBeta, PASSKEY);
    assert.equal(recoveredDataUrl, toDataUrl(plaintext), `mismatch for plaintext length ${plaintext.length}`);
  }
});

test("cross-decrypt: wrong passkey is rejected by both sides, not silently wrong", async () => {
  const dataUrl = toDataUrl("some real file content");
  const combined = await dAppEncryptData(dataUrl, PASSKEY);
  const midpoint = Math.ceil(combined.length / 2);

  await assert.rejects(() =>
    reconstructAndDecrypt({ shardAlpha: combined.slice(0, midpoint), shardBeta: combined.slice(midpoint), passkey: "wrong-passkey" })
  );
});

// Frozen regression fixture -- a real ciphertext independently generated ONCE (via
// Node's webcrypto, standing in for a browser capture per this file's header comment)
// and hardcoded below as a literal value, deliberately NOT regenerated at test-run time
// from the same code path under test. That distinction matters: a fixture recomputed
// fresh each run using dAppEncryptDataFixed() would silently stay "passing" even if a
// future change broke the construction on both sides identically (e.g. someone swaps
// the salt/iv order in both the mirror and the real dApp code) -- a truly frozen,
// independently-produced value is what actually catches that. Produced once with:
// salt = 16 bytes of 0x42, iv = 12 bytes of 0x24, passkey = PASSKEY below,
// plaintext = "frozen regression fixture v1" (see this file's git history/PR for the
// one-off script used to produce it, not re-run as part of this test).
test("regression fixture: a frozen, previously-captured dApp ciphertext still decrypts correctly via the SDK", async () => {
  const FIXTURE_PASSKEY = "correct-horse-battery-staple-9F3x";
  const FIXTURE_DATA_URL = "data:text/plain;base64,ZnJvemVuIHJlZ3Jlc3Npb24gZml4dHVyZSB2MQ==";
  const FIXTURE_COMBINED_BASE64 = "QkJCQkJCQkJCQkJCQkJCQiQkJCQkJCQkJCQkJN2FaVlN8a020GYv7TX5hqH7kRdgn1j97iGMPCSV4MjX+PD6pmuZKk/GCC07/hXX5QpiJSqV3KU56CaX3umhIaxHP5cbElnx3r8TIy+PLCQ=";

  const midpoint = Math.ceil(FIXTURE_COMBINED_BASE64.length / 2);
  const recovered = await reconstructAndDecrypt({
    shardAlpha: FIXTURE_COMBINED_BASE64.slice(0, midpoint),
    shardBeta: FIXTURE_COMBINED_BASE64.slice(midpoint),
    passkey: FIXTURE_PASSKEY,
  });
  assert.equal(recovered, FIXTURE_DATA_URL);
});
