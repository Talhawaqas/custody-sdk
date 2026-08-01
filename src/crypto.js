// ============================================================
// crypto.js — PBKDF2 key derivation, AES-GCM-256 encryption,
// and binary midpoint sharding.
//
// Ported from the working implementation already live in the
// Inaya dApp (page.js: encryptData / decryptData / prepareShardedFile),
// refactored into the derive-once API documented in the SDK guide
// instead of re-deriving the key on every call.
//
// Uses @noble/hashes + @noble/ciphers instead of crypto.subtle:
// React Native has no native SubtleCrypto implementation (only
// crypto.getRandomValues, via react-native-get-random-values), so this
// SDK would otherwise work in browsers/Node but crash on mobile. noble's
// primitives are pure JS and produce byte-identical PBKDF2 keys and
// AES-GCM ciphertext to crypto.subtle (verified against Node's native
// WebCrypto), so existing shards stay decryptable either way.
// ============================================================

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { InayaValidationError } from "./errors.js";

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BYTES = 32; // 256-bit

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return typeof window !== "undefined" ? window.btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

function fromBase64(b64) {
  const binary = typeof window !== "undefined" ? window.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Built on file.arrayBuffer() rather than FileReader — the latter is a browser-only global with
// no Node.js equivalent, which would silently break disperseAndSlice() in exactly the plain-Node
// usage this SDK otherwise supports (see index.js's dual-mode connection story). Both browser
// File/Blob and Node 18+'s global File/Blob implement arrayBuffer(), so this works in either.
async function readFileAsDataURL(file) {
  const buffer = await file.arrayBuffer();
  const mimeType = file.type || "application/octet-stream";
  return `data:${mimeType};base64,${toBase64(new Uint8Array(buffer))}`;
}

/** Generates a cryptographically secure random salt of the given byte length. */
export function generateSecureSalt(bytes = SALT_BYTES) {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

/**
 * Derives the local PBKDF2 vault key wrapper once, so it can be reused
 * across multiple disperseAndSlice() calls without re-deriving each time.
 */
const HASH_FN_MAP = {
  "HMAC-SHA256": sha256,
  "HMAC-SHA384": sha384,
  "HMAC-SHA512": sha512,
};

export async function deriveVaultKey({ passkey, salt, iterations = PBKDF2_ITERATIONS, algo = "HMAC-SHA256" }) {
  if (!passkey) throw new InayaValidationError("InayaKernel.deriveVaultKey: passkey is required.");
  const hashFn = HASH_FN_MAP[algo];
  if (!hashFn) throw new InayaValidationError(`InayaKernel.deriveVaultKey: unsupported algo "${algo}". Use one of: ${Object.keys(HASH_FN_MAP).join(", ")}.`);
  const key = pbkdf2(hashFn, passkey, salt, { c: iterations, dkLen: AES_KEY_BYTES });
  return { key, salt, iterations, algo };
}

/**
 * Encrypts a file with AES-GCM-256 using an already-derived vault key,
 * then bisects the resulting ciphertext at its exact byte midpoint.
 * Neither shard alone contains contiguous bit structures.
 */
export async function disperseAndSlice({ file, encryptionKey }) {
  if (!file) throw new InayaValidationError("InayaKernel.disperseAndSlice: file is required.");
  if (!encryptionKey?.key) throw new InayaValidationError("InayaKernel.disperseAndSlice: a vault key from deriveVaultKey() is required.");

  const dataUrl = await readFileAsDataURL(file);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const enc = new TextEncoder();
  const encrypted = gcm(encryptionKey.key, iv).encrypt(enc.encode(dataUrl));

  // Pack salt + iv + ciphertext together so decryption only needs the passkey.
  const combined = new Uint8Array(encryptionKey.salt.length + iv.length + encrypted.byteLength);
  combined.set(encryptionKey.salt, 0);
  combined.set(iv, encryptionKey.salt.length);
  combined.set(encrypted, encryptionKey.salt.length + iv.length);

  const cipherTextString = toBase64(combined);
  const midpoint = Math.ceil(cipherTextString.length / 2);

  return {
    filename: file.name,
    shardAlpha: cipherTextString.slice(0, midpoint),
    shardBeta: cipherTextString.slice(midpoint),
  };
}

/**
 * Reassembles Shard Alpha + Shard Beta and decrypts back to the original
 * file using only the passkey — mirrors the dApp's existing reconstruct flow.
 */
export async function reconstructAndDecrypt({ shardAlpha, shardBeta, passkey }) {
  if (!passkey) throw new InayaValidationError("InayaKernel.reconstructAndDecrypt: passkey is required.");
  const fullCipherText = shardAlpha + shardBeta;
  const combined = fromBase64(fullCipherText);

  const salt = combined.slice(0, SALT_BYTES);
  const iv = combined.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const encrypted = combined.slice(SALT_BYTES + IV_BYTES);

  const key = pbkdf2(sha256, passkey, salt, { c: PBKDF2_ITERATIONS, dkLen: AES_KEY_BYTES });
  const decrypted = gcm(key, iv).decrypt(encrypted);
  const dataUrl = new TextDecoder().decode(decrypted);
  return dataUrl; // data: URL — same shape the dApp already renders/downloads from
}
