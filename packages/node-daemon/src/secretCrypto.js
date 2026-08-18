// packages/node-daemon/src/secretCrypto.js
//
// Identical pattern to packages/cli/src/secretCrypto.js -- duplicated rather than imported
// since the two packages are independently published/installed and this is a small,
// self-contained module, not a shared abstraction worth a cross-package dependency.

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";

const ITERATIONS = 200_000;

export function encryptSecret(plaintext, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2(sha256, password, salt, { c: ITERATIONS, dkLen: 32 });
  const ciphertext = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext));
  return {
    salt: Buffer.from(salt).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

export function decryptSecret({ salt, iv, ciphertext }, password) {
  const saltBytes = Buffer.from(salt, "base64");
  const ivBytes = Buffer.from(iv, "base64");
  const ciphertextBytes = Buffer.from(ciphertext, "base64");
  const key = pbkdf2(sha256, password, saltBytes, { c: ITERATIONS, dkLen: 32 });
  try {
    const plaintextBytes = gcm(key, ivBytes).decrypt(ciphertextBytes);
    return new TextDecoder().decode(plaintextBytes);
  } catch {
    throw new Error("Wrong daemon password, or corrupted config file.");
  }
}
