// src/pqc/envelope.js
//
// Versioned hybrid key-wrapping envelope (Internxt-inspired SOW, Workstream A).
// See docs/architecture/pqc-architecture-adr.md §3 for the exact schema this
// implements. Wraps/unwraps a short-lived content/file key -- NOT file bytes:
// per the ADR's §2.13, file content stays on the existing AES-256-GCM path in
// crypto.js unchanged; this module only protects key *establishment*.
//
// LEGACY_CLASSICAL mode wraps the same way sharing already works today
// (X25519 + HKDF + XChaCha20-Poly1305, crypto.js's existing "sealed box"
// construction) -- this file does not reimplement that path, it calls it.

import { gcm } from "@noble/ciphers/aes.js";
import { InayaValidationError, InayaDecryptionError } from "../errors.js";
import { ALGORITHM_ID, encapsulate, decapsulate } from "./provider.js";

export const ENVELOPE_VERSION = 1;
const WRAP_NONCE_BYTES = 12;

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
 * Wraps a content/file key for one recipient device, under the hybrid PQC
 * algorithm. `aad` (additional authenticated data -- e.g. a stable reference
 * to which file/conversation/meeting this wrap is for) is bound into the
 * AEAD tag so a wrapped key cannot be silently replayed against a different
 * object than the one it was issued for.
 */
export function wrapContentKeyHybrid({ contentKey, recipientPublicKey, aad = new Uint8Array(0) }) {
  if (!contentKey || contentKey.length !== 32) {
    throw new InayaValidationError("wrapContentKeyHybrid: contentKey must be a 32-byte AES-256 key.");
  }
  const { cipherText: kemCiphertext, sharedSecret } = encapsulate(recipientPublicKey);

  const nonce = crypto.getRandomValues(new Uint8Array(WRAP_NONCE_BYTES));
  const wrappedKey = gcm(sharedSecret, nonce, aad).encrypt(contentKey);
  sharedSecret.fill(0); // zero the derived wrapping key once it's done its one job

  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM_ID,
    kemCiphertext: toBase64(kemCiphertext),
    nonce: toBase64(nonce),
    wrappedKey: toBase64(wrappedKey),
    aad: toBase64(aad),
  };
}

/**
 * Recovers the content/file key from a hybrid envelope using the recipient's
 * own PQC secret key. Throws InayaDecryptionError (never silently returns
 * garbage) if the envelope was corrupted, forged, re-targeted at different
 * AAD, or encrypted to a different recipient -- ML-KEM's implicit rejection
 * means a wrong-recipient attempt fails at the AES-GCM auth-tag check here,
 * not at decapsulation itself (see provider.js's decapsulate() comment).
 */
export function unwrapContentKeyHybrid({ envelope, recipientSecretKey }) {
  if (!envelope || typeof envelope !== "object") throw new InayaValidationError("unwrapContentKeyHybrid: envelope is required.");
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new InayaValidationError(`unwrapContentKeyHybrid: unsupported envelope version ${envelope.version}. Refusing to guess.`);
  }
  if (envelope.algorithm !== ALGORITHM_ID) {
    throw new InayaValidationError(`unwrapContentKeyHybrid: unsupported algorithm "${envelope.algorithm}". Refusing to downgrade or guess.`);
  }

  const kemCiphertext = fromBase64(envelope.kemCiphertext);
  const nonce = fromBase64(envelope.nonce);
  const wrappedKey = fromBase64(envelope.wrappedKey);
  const aad = fromBase64(envelope.aad);

  const { sharedSecret } = decapsulate(kemCiphertext, recipientSecretKey);
  try {
    const contentKey = gcm(sharedSecret, nonce, aad).decrypt(wrappedKey);
    return contentKey;
  } catch (err) {
    throw new InayaDecryptionError("unwrapContentKeyHybrid: envelope failed to decrypt -- wrong recipient, corrupted data, or tampered AAD.", { cause: err });
  } finally {
    sharedSecret.fill(0);
  }
}

/** True when an envelope-shaped object declares the hybrid PQC algorithm this module understands. */
export function isHybridEnvelope(envelope) {
  return !!envelope && typeof envelope === "object" && envelope.version === ENVELOPE_VERSION && envelope.algorithm === ALGORITHM_ID;
}
