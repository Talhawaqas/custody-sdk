// ============================================================
// passkeyBackup.js — User-Controlled Master Node Passkey Backup
// & Recovery.
//
// Core principle (non-negotiable): Inaya never receives, stores, or is
// able to reconstruct the raw passkey, the backup password, or the
// derived encryption key. Every function in this file is pure and
// synchronous-under-the-hood local crypto — there is no fetch/XHR call
// anywhere in this module, on any code path, by design (see the
// network-call-inspection test in test/passkeyBackup.test.mjs, which
// enforces this as a real assertion rather than just a comment).
//
// Deliberately independent of the wallet-signature-derived sharing
// primitive in crypto.js (deriveEncryptionKeypairFromSignature /
// encryptForPublicKey / decryptWithSecretKey) — that flow requires a
// wallet signature and a server round-trip to exchange wrapped keys
// between two different wallets. This flow is a self-service backup:
// a user-chosen backup password (never the passkey itself, never a
// wallet signature) locally encrypts the passkey into a portable file
// the user controls entirely — no wallet needed to restore, and no
// server ever sees the file or the password.
//
// Uses the same @noble/hashes + @noble/ciphers primitives as the rest
// of this SDK (see crypto.js's header comment for why: pure JS, works
// identically in browser/Node/React Native, no crypto.subtle dependency).
// ============================================================

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { InayaValidationError, InayaDecryptionError } from "./errors.js";

export const PASSKEY_BACKUP_VERSION = 1;

// OWASP's current PBKDF2-HMAC-SHA256 minimum. Deliberately higher than
// crypto.js's PBKDF2_ITERATIONS (100,000, used for per-file vault keys) —
// this KDF runs once per backup create/restore, not once per file, and
// the backup password a user picks may well be weaker than their Master
// Node Passkey, so the extra iterations are a cheap, worthwhile trade.
export const PASSKEY_BACKUP_KDF_ITERATIONS = 600000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BYTES = 32; // 256-bit
const MIN_BACKUP_PASSWORD_LENGTH = 8;

// Included inside the AEAD-encrypted plaintext (not the outer envelope) so
// a successful decrypt can be cheaply re-validated as "this really was an
// Inaya passkey backup" on top of the GCM authentication tag itself —
// belt-and-suspenders, not a security boundary of its own.
const MAGIC = "INAYA-PASSKEY-BACKUP";

// The *outer* file format prefix — distinct from MAGIC above, which is
// inside the encrypted plaintext. This one is never encrypted (it has to
// be readable before decryption even starts, to sniff the file type), but
// it does mean the exported backup file is an opaque base64 blob with a
// short prefix rather than readable JSON — opening it in Notepad/Notepad++/
// Word shows an unreadable string, not field names like "version"/"salt"/
// "iterations". This is a presentation choice, not a security boundary:
// the actual secret (the passkey) is exactly as protected by AES-GCM
// either way; base64-wrapping the envelope just keeps a casual "let me
// peek at this file" from looking like anything meaningful.
const FILE_PREFIX = "INAYAKEY1:";

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

/**
 * Encrypts `passkey` under `backupPassword` entirely on-device — zero
 * network calls anywhere in this function. Returns an opaque string (not
 * readable JSON, not an object) starting with the FILE_PREFIX marker,
 * ready to write to a file — a browser Blob download, expo-file-system,
 * or any other local-storage API, without the caller needing to know the
 * envelope's internal shape. Deliberately NOT plain JSON text: opening
 * the resulting file in Notepad/Notepad++/Word shows an unreadable blob,
 * not field names — see FILE_PREFIX's comment for why that's a
 * presentation choice, not the thing actually protecting the passkey.
 *
 * The returned string never contains the plaintext passkey as a
 * substring — only PBKDF2/AES-GCM output (see the envelope-inspection
 * test in test/passkeyBackup.test.mjs).
 */
export async function createPasskeyBackup(passkey, backupPassword, opts = {}) {
  if (!passkey || typeof passkey !== "string") {
    throw new InayaValidationError("createPasskeyBackup: passkey is required.");
  }
  if (!backupPassword || typeof backupPassword !== "string") {
    throw new InayaValidationError("createPasskeyBackup: backupPassword is required.");
  }
  if (backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new InayaValidationError(`createPasskeyBackup: backupPassword must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`);
  }

  const iterations = opts.iterations ?? PASSKEY_BACKUP_KDF_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  let key;
  try {
    key = pbkdf2(sha256, backupPassword, salt, { c: iterations, dkLen: AES_KEY_BYTES });
    const plaintext = utf8ToBytes(JSON.stringify({ magic: MAGIC, passkey }));
    const ciphertext = gcm(key, iv).encrypt(plaintext);

    const envelope = JSON.stringify({
      version: PASSKEY_BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      kdf: "PBKDF2-SHA256",
      iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      cipher: "AES-256-GCM",
      ciphertext: toBase64(ciphertext),
    });
    return FILE_PREFIX + toBase64(utf8ToBytes(envelope));
  } finally {
    // Best-effort memory hygiene — see SOW §7 ("sensitive key material
    // cleared where practical"). Uint8Array.fill(0) zeroes the buffer in
    // place; this doesn't guarantee the GC hasn't already copied the
    // bytes elsewhere, but it's the practical ceiling for a JS engine
    // with no manual memory management, and costs nothing to do.
    if (key) key.fill(0);
  }
}

/** Reverses the FILE_PREFIX + base64 wrapping createPasskeyBackup() applies —
 *  strips the marker, base64-decodes, UTF8-decodes, JSON.parses. Returns
 *  null (never throws) for anything that isn't a recognizable wrapped
 *  file, so callers can distinguish "not one of our files at all" from a
 *  later decryption failure. */
function decodeFileEnvelope(fileText) {
  if (typeof fileText !== "string" || !fileText.startsWith(FILE_PREFIX)) return null;
  try {
    const envelopeJson = new TextDecoder().decode(fromBase64(fileText.slice(FILE_PREFIX.length)));
    return JSON.parse(envelopeJson);
  } catch {
    return null;
  }
}

/**
 * Reverses createPasskeyBackup() — decrypts entirely on-device, zero
 * network calls anywhere in this function. Returns the original passkey
 * string on success.
 *
 * Throws InayaDecryptionError, with exactly the message
 * "Unable to decrypt backup. Your recovery password may be incorrect."
 * on a wrong password OR a corrupted/tampered backup file — AES-GCM's
 * authentication tag makes those two cases indistinguishable by design,
 * and this function doesn't try to guess which one happened.
 *
 * Throws InayaValidationError if `backupFileText` isn't a recognizable
 * Inaya passkey backup file at all (missing FILE_PREFIX, malformed
 * base64/JSON, wrong version, missing fields) — a distinct failure mode
 * from "wrong password," surfaced separately so the UI can show a more
 * specific "this isn't a backup file" message before ever asking the
 * user for a password.
 */
export async function restorePasskeyBackup(backupFileText, backupPassword) {
  if (!backupPassword || typeof backupPassword !== "string") {
    throw new InayaValidationError("restorePasskeyBackup: backupPassword is required.");
  }

  const envelope = decodeFileEnvelope(backupFileText);
  if (!envelope) {
    throw new InayaValidationError("restorePasskeyBackup: not a valid backup file.");
  }
  if (!isPasskeyBackupEnvelope(envelope)) {
    throw new InayaValidationError("restorePasskeyBackup: not a recognized Inaya passkey backup file.");
  }

  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);

  let key;
  let plaintext;
  try {
    key = pbkdf2(sha256, backupPassword, salt, { c: envelope.iterations, dkLen: AES_KEY_BYTES });
    try {
      plaintext = gcm(key, iv).decrypt(ciphertext);
    } catch (err) {
      throw new InayaDecryptionError("Unable to decrypt backup. Your recovery password may be incorrect.", { cause: err });
    }
  } finally {
    if (key) key.fill(0);
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new InayaDecryptionError("Unable to decrypt backup. Your recovery password may be incorrect.");
  }

  if (parsed?.magic !== MAGIC || typeof parsed.passkey !== "string" || parsed.passkey.length === 0) {
    throw new InayaDecryptionError("Unable to decrypt backup. Your recovery password may be incorrect.");
  }

  return parsed.passkey;
}

/**
 * Structural sniff only — no decryption, no password needed. Lets a UI
 * reject an obviously-wrong file (a random file someone picked by
 * mistake, plain text, an image) immediately, before ever prompting for
 * the backup password. Never throws — returns false for anything that
 * isn't a recognizable v1 backup file.
 *
 * Accepts either the raw file contents (a string starting with the
 * FILE_PREFIX marker — the normal case, e.g. straight from FileReader)
 * or an already-decoded envelope object (used internally by
 * restorePasskeyBackup, which has already decoded it by this point).
 */
export function isPasskeyBackupEnvelope(input) {
  const envelope = typeof input === "string" ? decodeFileEnvelope(input) : input;
  return (
    envelope?.version === PASSKEY_BACKUP_VERSION &&
    envelope?.cipher === "AES-256-GCM" &&
    typeof envelope?.iterations === "number" &&
    typeof envelope?.salt === "string" &&
    typeof envelope?.iv === "string" &&
    typeof envelope?.ciphertext === "string"
  );
}
