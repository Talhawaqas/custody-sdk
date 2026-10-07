// src/pqc/provider.js
//
// PqcProvider — the algorithm-agile post-quantum key-establishment abstraction
// (Internxt-inspired SOW, Workstream A). See docs/architecture/pqc-architecture-adr.md
// in the inaya-network-dapp repo for the full design rationale.
//
// Backed by @noble/post-quantum's KitchenSink_ml_kem768_x25519 — a hybrid KEM
// combining classical X25519 and standardized ML-KEM-768 (FIPS 203), from the
// same audited "noble" family already used everywhere else in this SDK
// (crypto.js: @noble/hashes, @noble/ciphers, @noble/curves). We deliberately do
// NOT hand-roll the hybrid combination (the SOW explicitly forbids a bare
// SHA256(classicalSecret + pqcSecret) without domain separation and review) —
// the library's own combiner already does that correctly, smoke-verified in
// this repo (2026-10-07): encapsulate/decapsulate round-trips, and a corrupted
// ciphertext deterministically yields a DIFFERENT shared secret rather than
// silently succeeding.
//
// No custom lattice/KEM implementation exists anywhere in this file, per the
// SOW's absolute prohibition (§4.7, §19.19) -- every cryptographic operation
// below is a direct call into the library.
//
// Algorithm agility: every export below is keyed off ALGORITHM_ID so a future
// parameter set (ML-KEM-512/1024, or a different hybrid combiner) can be added
// as a new branch without touching any call site -- callers never import the
// noble hybrid module directly.

import { KitchenSink_ml_kem768_x25519 } from "@noble/post-quantum/hybrid.js";
import { InayaValidationError } from "../errors.js";

// Standardized identifier (FIPS 203 terminology), never the "Kyber" marketing
// name -- see the ADR's §4.2 rationale. "KITCHENSINK" names the specific
// library-provided combiner construction, since a future different combiner
// (e.g. a plain ml_kem768_x25519 preset) would need its own distinct ID: an
// envelope must never be processed under an algorithm it wasn't actually
// produced with.
export const ALGORITHM_ID = "HYBRID-MLKEM768-X25519-KITCHENSINK";

const KEMS = {
  [ALGORITHM_ID]: KitchenSink_ml_kem768_x25519,
};

function resolveKem(algorithmId) {
  const kem = KEMS[algorithmId];
  if (!kem) {
    throw new InayaValidationError(
      `PqcProvider: unsupported algorithm "${algorithmId}". Supported: ${Object.keys(KEMS).join(", ")}. ` +
        `An envelope naming an unrecognized algorithm must be rejected by the caller, never guessed at.`
    );
  }
  return kem;
}

/** Non-secret capability info a client can advertise/compare before issuing a PQC-requiring envelope to it. */
export function capabilityInfo(algorithmId = ALGORITHM_ID) {
  const kem = resolveKem(algorithmId);
  return {
    algorithmId,
    publicKeyLength: kem.lengths.publicKey,
    secretKeyLength: kem.lengths.secretKey,
    cipherTextLength: kem.lengths.cipherText,
    sharedSecretLength: 32, // KitchenSink's combiner always derives a fixed 32-byte output regardless of component sizes
  };
}

/**
 * Generates one device PQC key pair. Must be called on the device itself --
 * the secret key this returns must never be sent to a server, logged, put in
 * a URL, or serialized into analytics/crash telemetry (ADR §4, SOW §4.8).
 */
export function generateKeyPair(algorithmId = ALGORITHM_ID) {
  const kem = resolveKem(algorithmId);
  const { secretKey, publicKey } = kem.keygen();
  return { algorithmId, secretKey, publicKey };
}

/**
 * Encapsulates a fresh shared secret to a recipient's public key. Used by the
 * sender: produces a ciphertext safe to transmit/store (it is NOT secret --
 * only the holder of the matching secretKey can recover the shared secret
 * from it) plus the 32-byte shared secret the sender uses locally to wrap a
 * content/file key.
 */
export function encapsulate(recipientPublicKey, algorithmId = ALGORITHM_ID) {
  if (!recipientPublicKey || !recipientPublicKey.length) {
    throw new InayaValidationError("PqcProvider.encapsulate: recipientPublicKey is required.");
  }
  const kem = resolveKem(algorithmId);
  const { cipherText, sharedSecret } = kem.encapsulate(recipientPublicKey);
  return { algorithmId, cipherText, sharedSecret };
}

/**
 * Recovers the shared secret from a ciphertext using the recipient's own
 * secret key. ML-KEM's implicit-rejection property means a corrupted/forged
 * ciphertext does not throw here -- it deterministically returns a DIFFERENT
 * (wrong) shared secret, so the caller's subsequent AEAD decrypt of the
 * wrapped key is what actually fails. This is standard ML-KEM behavior, not
 * a bug: see docs/security/pqc-threat-model.md T7.
 */
export function decapsulate(cipherText, secretKey, algorithmId = ALGORITHM_ID) {
  if (!cipherText || !cipherText.length) throw new InayaValidationError("PqcProvider.decapsulate: cipherText is required.");
  if (!secretKey || !secretKey.length) throw new InayaValidationError("PqcProvider.decapsulate: secretKey is required.");
  const kem = resolveKem(algorithmId);
  const sharedSecret = kem.decapsulate(cipherText, secretKey);
  return { algorithmId, sharedSecret };
}

export const PqcProvider = {
  ALGORITHM_ID,
  capabilityInfo,
  generateKeyPair,
  encapsulate,
  decapsulate,
};

export default PqcProvider;
