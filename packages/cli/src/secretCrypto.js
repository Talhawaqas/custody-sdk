// packages/cli/src/secretCrypto.js
//
// Encrypts the private key this CLI stores locally (~/.inaya/config.json)
// at rest, so a leaked/backed-up config file isn't a leaked plaintext
// private key — it's ciphertext gated behind the CLI password chosen at
// `inaya login`. Deliberately a separate, minimal implementation from the
// SDK's own crypto.js: that module is shaped around encrypting a whole
// File into a data: URL for sharding, not a short raw secret string —
// reusing it here would be forcing a mismatched abstraction rather than
// three similar lines.

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";

const ITERATIONS = 200_000; // higher than the SDK's file-encryption default (100k) — this key protects a real wallet secret, not disposable file shards.

export function encryptSecret(plaintext, cliPassword) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2(sha256, cliPassword, salt, { c: ITERATIONS, dkLen: 32 });
  const ciphertext = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext));
  return {
    salt: Buffer.from(salt).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

export function decryptSecret({ salt, iv, ciphertext }, cliPassword) {
  const saltBytes = Buffer.from(salt, "base64");
  const ivBytes = Buffer.from(iv, "base64");
  const ciphertextBytes = Buffer.from(ciphertext, "base64");
  const key = pbkdf2(sha256, cliPassword, saltBytes, { c: ITERATIONS, dkLen: 32 });
  try {
    const plaintextBytes = gcm(key, ivBytes).decrypt(ciphertextBytes);
    return new TextDecoder().decode(plaintextBytes);
  } catch {
    throw new Error("Wrong CLI password, or corrupted config file.");
  }
}
