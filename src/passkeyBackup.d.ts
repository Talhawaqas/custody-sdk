// src/passkeyBackup.d.ts
// Type definitions matching passkeyBackup.js exactly — see that file for implementation.

/** The v1 backup envelope shape, wrapped inside the opaque file text
 *  createPasskeyBackup() returns (see that function's doc comment) —
 *  not the file format itself, just its decoded internal structure.
 *  Contains no plaintext passkey anywhere. */
export interface PasskeyBackupEnvelope {
  version: 1;
  createdAt: string;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** base64, 16 random bytes */
  salt: string;
  /** base64, 12 random bytes */
  iv: string;
  cipher: "AES-256-GCM";
  /** base64, AES-GCM output (auth tag included) */
  ciphertext: string;
}

export interface CreatePasskeyBackupOptions {
  /** @default 600000 */
  iterations?: number;
}

/** Encrypts `passkey` under `backupPassword` entirely on-device — zero network calls.
 *  Returns an opaque string (not readable JSON) ready to write to a file — e.g. a browser
 *  Blob download with a `.inayakey` extension, or expo-file-system on mobile.
 *  `backupPassword` must be at least 8 characters. */
export function createPasskeyBackup(passkey: string, backupPassword: string, opts?: CreatePasskeyBackupOptions): Promise<string>;

/** Reverses createPasskeyBackup() — entirely on-device, zero network calls. Throws
 *  InayaDecryptionError (message: "Unable to decrypt backup. Your recovery password may be
 *  incorrect.") on a wrong password or a corrupted/tampered backup file. Throws
 *  InayaValidationError if `backupFileText` isn't a recognized Inaya passkey backup file. */
export function restorePasskeyBackup(backupFileText: string, backupPassword: string): Promise<string>;

/** Structural sniff only, no decryption/password needed — true if `input` (the raw file text,
 *  or an already-decoded envelope object) looks like a recognized v1 passkey backup file. Never throws. */
export function isPasskeyBackupEnvelope(input: string | unknown): input is PasskeyBackupEnvelope;

export const PASSKEY_BACKUP_VERSION: 1;
export const PASSKEY_BACKUP_KDF_ITERATIONS: number;
