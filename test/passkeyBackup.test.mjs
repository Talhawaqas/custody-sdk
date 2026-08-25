// test/passkeyBackup.test.mjs
//
// First real automated test suite this package has ever had (previously
// only ad-hoc smoke scripts at the repo root, no assertion framework) —
// introduced here specifically to cover the User-Controlled Master Node
// Passkey Backup & Recovery SOW's testing requirements: backup creation,
// backup encryption, successful recovery, wrong-password rejection,
// corrupted-backup rejection, cross-device restoration, passkey
// integrity, and a real assertion (not just a code comment) that neither
// function in passkeyBackup.js ever makes a network call.
//
// Run with: node --test test/passkeyBackup.test.mjs (or `npm test`).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPasskeyBackup,
  restorePasskeyBackup,
  isPasskeyBackupEnvelope,
  PASSKEY_BACKUP_VERSION,
} from "../src/passkeyBackup.js";
import { InayaDecryptionError, InayaValidationError } from "../src/errors.js";

const PASSKEY = "correct-horse-battery-staple-9F3x";
const PASSWORD = "a-strong-backup-password-123";
const FILE_PREFIX = "INAYAKEY1:";

// Test-only mirror of passkeyBackup.js's private decode/encode so tests can
// inspect and deliberately tamper with the envelope inside a backup file
// (the file itself is a FILE_PREFIX + base64(JSON) blob — see that file's
// FILE_PREFIX comment for why it's not plain readable JSON).
function decodeBlob(fileText) {
  return JSON.parse(Buffer.from(fileText.slice(FILE_PREFIX.length), "base64").toString("utf8"));
}
function encodeBlob(envelope) {
  return FILE_PREFIX + Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

test("createPasskeyBackup: produces an opaque, versioned backup file (not readable JSON)", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  assert.ok(blob.startsWith(FILE_PREFIX));
  // The raw file text itself must never contain readable field names —
  // that's the whole point of wrapping it (see FILE_PREFIX's comment).
  assert.ok(!blob.includes("version"));
  assert.ok(!blob.includes("ciphertext"));

  const env = decodeBlob(blob);
  assert.equal(env.version, PASSKEY_BACKUP_VERSION);
  assert.equal(env.cipher, "AES-256-GCM");
  assert.equal(env.kdf, "PBKDF2-SHA256");
  assert.ok(env.salt && env.iv && env.ciphertext);
  assert.ok(isPasskeyBackupEnvelope(blob));
  assert.ok(isPasskeyBackupEnvelope(env));
});

test("createPasskeyBackup: rejects an empty passkey or missing backup password", async () => {
  await assert.rejects(() => createPasskeyBackup("", PASSWORD), InayaValidationError);
  await assert.rejects(() => createPasskeyBackup(PASSKEY, ""), InayaValidationError);
  await assert.rejects(() => createPasskeyBackup(PASSKEY, "short"), InayaValidationError);
});

test("createPasskeyBackup: the backup file never contains the plaintext passkey as a substring", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  assert.ok(!blob.includes(PASSKEY));
});

test("restorePasskeyBackup: correct password recovers the exact original passkey", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  const recovered = await restorePasskeyBackup(blob, PASSWORD);
  assert.equal(recovered, PASSKEY);
});

test("restorePasskeyBackup: wrong password throws InayaDecryptionError with the exact SOW-mandated message", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  await assert.rejects(
    () => restorePasskeyBackup(blob, "wrong-password-entirely"),
    (err) => err instanceof InayaDecryptionError && err.message === "Unable to decrypt backup. Your recovery password may be incorrect."
  );
});

test("restorePasskeyBackup: a flipped ciphertext byte (tampered backup) is rejected, not silently wrong", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  const env = decodeBlob(blob);
  const bytes = Buffer.from(env.ciphertext, "base64");
  bytes[0] ^= 0xff;
  env.ciphertext = bytes.toString("base64");
  await assert.rejects(() => restorePasskeyBackup(encodeBlob(env), PASSWORD), InayaDecryptionError);
});

test("restorePasskeyBackup: truncated ciphertext (corrupted backup) is rejected", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  const env = decodeBlob(blob);
  env.ciphertext = env.ciphertext.slice(0, -8);
  await assert.rejects(() => restorePasskeyBackup(encodeBlob(env), PASSWORD));
});

test("restorePasskeyBackup: not a backup file at all -> InayaValidationError, not InayaDecryptionError", async () => {
  await assert.rejects(() => restorePasskeyBackup(JSON.stringify({ hello: "world" }), PASSWORD), InayaValidationError);
  await assert.rejects(() => restorePasskeyBackup("not even a backup file", PASSWORD), InayaValidationError);
  await assert.rejects(() => restorePasskeyBackup(encodeBlob({ hello: "world" }), PASSWORD), InayaValidationError);
});

test("two backups of the same passkey+password produce different salt/iv/ciphertext (randomized, not reused)", async () => {
  const blobA = await createPasskeyBackup(PASSKEY, PASSWORD);
  const blobB = await createPasskeyBackup(PASSKEY, PASSWORD);
  const envA = decodeBlob(blobA);
  const envB = decodeBlob(blobB);
  assert.notEqual(envA.salt, envB.salt);
  assert.notEqual(envA.iv, envB.iv);
  assert.notEqual(envA.ciphertext, envB.ciphertext);
  assert.notEqual(blobA, blobB); // the whole file differs too, not just the inner envelope
  // ...but both still restore to the identical passkey.
  assert.equal(await restorePasskeyBackup(blobA, PASSWORD), PASSKEY);
  assert.equal(await restorePasskeyBackup(blobB, PASSWORD), PASSKEY);
});

test("cross-device simulation: backup file text round-tripped with no shared object identity, as if written on device A and read back on device B", async () => {
  const blobOnDeviceA = await createPasskeyBackup(PASSKEY, PASSWORD);
  const asIfReadFromFileOnDeviceB = String(blobOnDeviceA); // fresh string instance, same content
  const recovered = await restorePasskeyBackup(asIfReadFromFileOnDeviceB, PASSWORD);
  assert.equal(recovered, PASSKEY);
});

test("isPasskeyBackupEnvelope: true for a real backup file, false for anything else, never throws", async () => {
  const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
  assert.equal(isPasskeyBackupEnvelope(blob), true);
  assert.equal(isPasskeyBackupEnvelope("{}"), false);
  assert.equal(isPasskeyBackupEnvelope("not a backup file"), false);
  assert.equal(isPasskeyBackupEnvelope(JSON.stringify({ version: 1 })), false); // missing FILE_PREFIX entirely
  assert.equal(isPasskeyBackupEnvelope(null), false);
  assert.equal(isPasskeyBackupEnvelope(undefined), false);
  assert.equal(isPasskeyBackupEnvelope(42), false);
});

test("network-call inspection: neither createPasskeyBackup nor restorePasskeyBackup ever calls fetch", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error("fetch should never be called by passkeyBackup.js"); };
  try {
    const blob = await createPasskeyBackup(PASSKEY, PASSWORD);
    await restorePasskeyBackup(blob, PASSWORD);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(called, false);
});
