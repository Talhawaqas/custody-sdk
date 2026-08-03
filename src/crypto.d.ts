// src/crypto.d.ts
// Type definitions matching crypto.js exactly — see that file for implementation.

export type HashAlgo = "HMAC-SHA256" | "HMAC-SHA384" | "HMAC-SHA512";

/** Result of deriveVaultKey() — pass this whole object into disperseAndSlice(). `key` is a raw
 *  derived byte array (from @noble/hashes' pbkdf2), not a Web Crypto CryptoKey — this SDK doesn't
 *  use crypto.subtle at all, so it works in React Native, which has no SubtleCrypto implementation. */
export interface VaultKey {
  key: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  algo: HashAlgo;
}

export interface DeriveVaultKeyParams {
  passkey: string;
  salt: Uint8Array;
  /** @default 100000 */
  iterations?: number;
  /** @default "HMAC-SHA256" */
  algo?: HashAlgo;
}

export interface DisperseAndSliceParams {
  file: File;
  /** Must come from deriveVaultKey() — a raw passkey string will not work here. */
  encryptionKey: VaultKey;
}

export interface DisperseAndSliceResult {
  filename: string;
  shardAlpha: string;
  shardBeta: string;
}

export interface ReconstructAndDecryptParams {
  shardAlpha: string;
  shardBeta: string;
  passkey: string;
}

/** Result of deriveEncryptionKeypairFromSignature() — deterministic per signature, never needs
 *  to be stored. `secretKey` must never leave the device it was derived on; `publicKey` is safe
 *  to register with a backend (see Metadata.registerEncryptionKey()). */
export interface EncryptionKeypair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface EncryptForPublicKeyParams {
  plaintext: string;
  /** Uint8Array or hex string (with or without "0x") — from EncryptionKeypair.publicKey. */
  recipientPublicKey: Uint8Array | string;
}

export interface DecryptWithSecretKeyParams {
  /** The base64 blob returned by encryptForPublicKey(). */
  wrapped: string;
  secretKey: Uint8Array;
}

/** Generates a cryptographically secure random salt of the given byte length. */
export function generateSecureSalt(bytes?: number): Uint8Array;

/** Derives the local PBKDF2 vault key wrapper once, for reuse across multiple disperseAndSlice() calls. */
export function deriveVaultKey(params: DeriveVaultKeyParams): Promise<VaultKey>;

/** Encrypts a file with AES-GCM-256, then bisects the ciphertext at its exact byte midpoint. */
export function disperseAndSlice(params: DisperseAndSliceParams): Promise<DisperseAndSliceResult>;

/** Reassembles Shard Alpha + Shard Beta and decrypts back to the original data: URL, using only the passkey. */
export function reconstructAndDecrypt(params: ReconstructAndDecryptParams): Promise<string>;

/** Deterministically derives an X25519 keypair from a wallet signature (see Metadata's
 *  fixed-message signing for how the signature itself is obtained) — the same wallet signing
 *  the same message always reproduces the same keypair, so it never needs to be persisted. */
export function deriveEncryptionKeypairFromSignature(signature: string): EncryptionKeypair;

/** Encrypts `plaintext` so only the holder of the matching secretKey can decrypt it (ephemeral-sender
 *  X25519 + HKDF-SHA256 + XChaCha20-Poly1305 "sealed box"). Returns one opaque base64 string. */
export function encryptForPublicKey(params: EncryptForPublicKeyParams): string;

/** Reverses encryptForPublicKey(). Throws if `wrapped` was tampered with or wasn't encrypted for this secretKey. */
export function decryptWithSecretKey(params: DecryptWithSecretKeyParams): string;