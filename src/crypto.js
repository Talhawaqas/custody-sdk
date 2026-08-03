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
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { InayaValidationError } from "./errors.js";

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BYTES = 32; // 256-bit

// Shared-storage key re-wrapping (Module 1, Phase 3 Tier 1) — X25519 + HKDF-SHA256 +
// XChaCha20-Poly1305, i.e. the same "sealed box" construction as libsodium's
// crypto_box_seal: an ephemeral sender keypair + ECDH + a symmetric AEAD cipher.
// Deliberately NOT built on MetaMask's eth_getEncryptionPublicKey/eth_decrypt —
// verified via web search (2026) that those are deprecated since 2022 (the
// underlying EIP-1024 was abandoned), MetaMask itself no longer recommends them,
// and there's no evidence they're supported over WalletConnect-style connections
// at all (this app's mobile side connects via MetaMask Connect Multichain, which
// almost certainly doesn't expose them). Using @noble/curves instead — same
// audited "noble" family already trusted here for AES-GCM/PBKDF2 — keeps this
// working identically across browser-extension, WalletConnect, and mobile.
const ENCRYPTION_KEYPAIR_INFO = utf8ToBytes("inaya-share-v1");
const XCHACHA_NONCE_BYTES = 24;

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

/**
 * Deterministically derives an X25519 encryption keypair from a wallet
 * signature — signing the same fixed message with the same wallet always
 * produces the same signature (personal_sign is deterministic per RFC 6979),
 * so this keypair is reproducible on demand and never needs to be stored.
 * The secretKey must never leave the device it was derived on; only
 * publicKey is safe to register with a backend.
 */
export function deriveEncryptionKeypairFromSignature(signature) {
  if (!signature) throw new InayaValidationError("InayaKernel.deriveEncryptionKeypairFromSignature: signature is required.");
  const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
  const secretKey = sha256(hexToBytes(sigHex)); // uniform 32-byte seed; x25519 clamps internally
  const publicKey = x25519.getPublicKey(secretKey);
  return { secretKey, publicKey };
}

/**
 * Encrypts `plaintext` (the file owner's passkey, in the sharing flow) so
 * that only the holder of recipientPublicKey's matching secretKey can
 * decrypt it — an anonymous "sealed box": a fresh ephemeral keypair per
 * call, ECDH against the recipient's public key, HKDF-SHA256 to derive a
 * symmetric key, then XChaCha20-Poly1305 (authenticated — tampering with
 * the returned blob makes decryptWithSecretKey() throw, it never silently
 * returns corrupted plaintext). Returns one opaque base64 string, the same
 * shape shareFile()'s wrappedVaultKey has always documented itself as.
 */
export function encryptForPublicKey({ plaintext, recipientPublicKey }) {
  if (!plaintext) throw new InayaValidationError("InayaKernel.encryptForPublicKey: plaintext is required.");
  if (!recipientPublicKey) throw new InayaValidationError("InayaKernel.encryptForPublicKey: recipientPublicKey is required.");
  const recipientKeyBytes = typeof recipientPublicKey === "string" ? hexToBytes(recipientPublicKey.replace(/^0x/, "")) : recipientPublicKey;

  const ephemeralSecretKey = crypto.getRandomValues(new Uint8Array(32));
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralSecretKey, recipientKeyBytes);
  const symmetricKey = hkdf(sha256, sharedSecret, undefined, ENCRYPTION_KEYPAIR_INFO, AES_KEY_BYTES);

  const nonce = crypto.getRandomValues(new Uint8Array(XCHACHA_NONCE_BYTES));
  const ciphertext = xchacha20poly1305(symmetricKey, nonce).encrypt(utf8ToBytes(plaintext));

  // Pack ephemeralPublicKey + nonce + ciphertext together so decryption only needs the recipient's secretKey.
  const combined = new Uint8Array(ephemeralPublicKey.length + nonce.length + ciphertext.length);
  combined.set(ephemeralPublicKey, 0);
  combined.set(nonce, ephemeralPublicKey.length);
  combined.set(ciphertext, ephemeralPublicKey.length + nonce.length);
  return toBase64(combined);
}

/**
 * Reverses encryptForPublicKey() — recovers the original plaintext using
 * only the recipient's secretKey (from deriveEncryptionKeypairFromSignature()).
 * Throws (via Poly1305's authentication tag check) rather than returning
 * garbage if `wrapped` was tampered with or wasn't actually encrypted for
 * this secretKey.
 */
export function decryptWithSecretKey({ wrapped, secretKey }) {
  if (!wrapped) throw new InayaValidationError("InayaKernel.decryptWithSecretKey: wrapped is required.");
  if (!secretKey) throw new InayaValidationError("InayaKernel.decryptWithSecretKey: secretKey is required.");
  const combined = fromBase64(wrapped);

  const ephemeralPublicKey = combined.slice(0, 32);
  const nonce = combined.slice(32, 32 + XCHACHA_NONCE_BYTES);
  const ciphertext = combined.slice(32 + XCHACHA_NONCE_BYTES);

  const sharedSecret = x25519.getSharedSecret(secretKey, ephemeralPublicKey);
  const symmetricKey = hkdf(sha256, sharedSecret, undefined, ENCRYPTION_KEYPAIR_INFO, AES_KEY_BYTES);
  const plaintext = xchacha20poly1305(symmetricKey, nonce).decrypt(ciphertext);
  return new TextDecoder().decode(plaintext);
}
