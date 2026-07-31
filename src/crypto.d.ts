// src/crypto.d.ts
// Type definitions matching crypto.js exactly — see that file for implementation.

export type HashAlgo = "HMAC-SHA256" | "HMAC-SHA384" | "HMAC-SHA512";

/** Result of deriveVaultKey() — pass this whole object into disperseAndSlice(). */
export interface VaultKey {
  key: CryptoKey;
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

/** Generates a cryptographically secure random salt of the given byte length. */
export function generateSecureSalt(bytes?: number): Uint8Array;

/** Derives the local PBKDF2 vault key wrapper once, for reuse across multiple disperseAndSlice() calls. */
export function deriveVaultKey(params: DeriveVaultKeyParams): Promise<VaultKey>;

/** Encrypts a file with AES-GCM-256, then bisects the ciphertext at its exact byte midpoint. */
export function disperseAndSlice(params: DisperseAndSliceParams): Promise<DisperseAndSliceResult>;

/** Reassembles Shard Alpha + Shard Beta and decrypts back to the original data: URL, using only the passkey. */
export function reconstructAndDecrypt(params: ReconstructAndDecryptParams): Promise<string>;