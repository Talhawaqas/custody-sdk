// src/pqc/agileSharing.js
//
// Algorithm-agile sharing layer (Internxt-inspired SOW, Workstream A, PQC-A05). Extends -- does
// NOT fork or replace -- the existing X25519/XChaCha20-Poly1305 "sealed box" sharing primitive
// (crypto.js's encryptForPublicKey/decryptWithSecretKey, in production use today for wrapping a
// file owner's passkey to a share recipient). That function is called here unchanged for the
// LEGACY_CLASSICAL path; HYBRID_PQC/PQC_REQUIRED route through this file's own hybrid envelope
// (envelope.js) instead. Three modes, per SOW §4.15:
//
//   LEGACY_CLASSICAL -- X25519 only (today's existing scheme, byte-for-byte unchanged)
//   HYBRID_PQC       -- hybrid if the recipient has a registered PQC key, else falls back to classical
//   PQC_REQUIRED     -- hybrid only; refuses outright (never silently downgrades) if the recipient
//                       has no PQC key
//
// This module does not know how to look up "does this recipient have a PQC key" -- that's a
// server-side org-scoped question (src/lib/pqc/deviceKeys.js in the dApp repo). Callers pass
// recipientPqcPublicKey themselves, already resolved (or null/undefined if none exists).

import { encryptForPublicKey, decryptWithSecretKey } from "../crypto.js";
import { wrapContentKeyHybrid, unwrapContentKeyHybrid, isHybridEnvelope } from "./envelope.js";
import { InayaValidationError } from "../errors.js";

export const SHARING_MODE = {
  LEGACY_CLASSICAL: "LEGACY_CLASSICAL",
  HYBRID_PQC: "HYBRID_PQC",
  PQC_REQUIRED: "PQC_REQUIRED",
};

/**
 * Wraps a secret (a file owner's passkey, or any other short secret the existing sharing flow
 * already wraps) for one recipient, per the requested policy mode. Returns either a plain base64
 * string (LEGACY_CLASSICAL -- identical shape to what encryptForPublicKey() has always returned)
 * or a hybrid envelope object -- callers that persist this must be able to store either shape, or
 * should check isAgileHybridEnvelope() themselves before assuming one.
 */
export function wrapForRecipient({ plaintext, recipientClassicalPublicKey, recipientPqcPublicKey, mode = SHARING_MODE.LEGACY_CLASSICAL }) {
  if (!Object.values(SHARING_MODE).includes(mode)) {
    throw new InayaValidationError(`wrapForRecipient: unsupported mode "${mode}". Use one of: ${Object.values(SHARING_MODE).join(", ")}.`);
  }

  if (mode === SHARING_MODE.PQC_REQUIRED) {
    if (!recipientPqcPublicKey) {
      throw new InayaValidationError(
        "wrapForRecipient: this share requires a PQC-capable recipient device, but the recipient has no registered PQC key. " +
          "Refusing to silently downgrade to classical-only encryption."
      );
    }
    return wrapContentKeyHybrid({ contentKey: new TextEncoder().encode(plaintext), recipientPublicKey: recipientPqcPublicKey });
  }

  if (mode === SHARING_MODE.HYBRID_PQC && recipientPqcPublicKey) {
    return wrapContentKeyHybrid({ contentKey: new TextEncoder().encode(plaintext), recipientPublicKey: recipientPqcPublicKey });
  }

  // LEGACY_CLASSICAL, or HYBRID_PQC with no PQC key on file for this recipient (honest fallback,
  // not a required-policy violation since the caller only asked to prefer PQC, not require it).
  if (!recipientClassicalPublicKey) {
    throw new InayaValidationError("wrapForRecipient: recipientClassicalPublicKey is required when no PQC key is available or requested.");
  }
  return encryptForPublicKey({ plaintext, recipientPublicKey: recipientClassicalPublicKey });
}

/**
 * Reverses wrapForRecipient(). Detects which path the wrapped value came from by shape -- a
 * hybrid envelope is always a versioned/algorithm-tagged object (isHybridEnvelope), a legacy
 * wrap is always a plain base64 string -- and calls the matching unwrap. The recipient must
 * supply whichever secret key(s) they actually hold; a mismatch (e.g. only a classical key for
 * a hybrid-wrapped envelope) fails closed via the underlying function's own error, never a
 * silent wrong result.
 */
export function unwrapFromSender({ wrapped, classicalSecretKey, pqcSecretKey }) {
  if (isHybridEnvelope(wrapped)) {
    if (!pqcSecretKey) throw new InayaValidationError("unwrapFromSender: this was wrapped with a hybrid PQC envelope, but no pqcSecretKey was supplied.");
    const bytes = unwrapContentKeyHybrid({ envelope: wrapped, recipientSecretKey: pqcSecretKey });
    return new TextDecoder().decode(bytes);
  }
  if (!classicalSecretKey) throw new InayaValidationError("unwrapFromSender: this was wrapped with the classical scheme, but no classicalSecretKey was supplied.");
  return decryptWithSecretKey({ wrapped, secretKey: classicalSecretKey });
}

/** True for a hybrid envelope object (as opposed to a legacy base64-string wrap). Thin re-export so callers don't need to import envelope.js directly just to branch on shape. */
export const isAgileHybridEnvelope = isHybridEnvelope;
