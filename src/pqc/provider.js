// src/pqc/provider.js
//
// PqcProvider -- the algorithm-agile post-quantum key-establishment abstraction
// (Internxt-inspired SOW, Workstream A). See docs/architecture/pqc-architecture-adr.md
// in the inaya-network-dapp repo for the full design rationale.
//
// Hybrid construction: a classical X25519 ECDH shared secret combined with a standardized
// ML-KEM-768 (FIPS 203) shared secret, through a domain-separated HKDF-SHA256. Both halves come
// from the same audited "noble" family already used everywhere else in this SDK (crypto.js:
// @noble/hashes, @noble/ciphers, @noble/curves) -- x25519 is imported from this SDK's own
// existing @noble/curves dependency (already used by crypto.js's sharing primitive), and
// ml_kem768 from @noble/post-quantum, which depends on @noble/hashes ONLY (confirmed via its own
// package.json) -- not @noble/curves.
//
// REAL DEPENDENCY CONSTRAINT DISCOVERED DURING IMPLEMENTATION, DOCUMENTED HONESTLY: an earlier
// version of this file used @noble/post-quantum's own hybrid.js preset (KitchenSink_ml_kem768_
// x25519), a library-maintained combiner. That module hard-requires @noble/curves 2.x (confirmed:
// it imports `afunction` from "@noble/curves/utils.js", an export that does not exist in 1.x).
// This SDK's existing @noble/curves dependency -- and every wallet/signing code elsewhere in the
// dApp that depends on it -- is pinned to 1.9.7, and upgrading that major version across the whole
// app for this one feature was judged far riskier than the alternative: perform the hybrid
// combination ourselves, using only the parts of @noble/post-quantum that have no curves
// dependency at all (ml-kem.js), combined with the x25519 implementation already present. This is
// exactly the hand-rolled construction the SOW's own §4.12 anticipates and permits, PROVIDED it
// uses a defined KDF with real domain separation rather than naive concatenation -- which is what
// the HKDF call below does.
//
// No custom lattice/KEM implementation exists anywhere in this file, per the SOW's absolute
// prohibition (SOW §4.7, §19.19) -- every cryptographic primitive below (ml_kem768, x25519, HKDF)
// is a direct call into an audited library; only the combination step is this file's own code.

import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { InayaValidationError } from "../errors.js";

// Standardized identifier (FIPS 203 terminology), never the "Kyber" marketing name -- see the
// ADR's §4.2 rationale. "HKDF" names this specific combination construction, since a future
// different combiner would need its own distinct ID: an envelope must never be processed under an
// algorithm it wasn't actually produced with.
export const ALGORITHM_ID = "HYBRID-MLKEM768-X25519-HKDF-SHA256";

const HYBRID_INFO = utf8ToBytes("inaya-pqc-hybrid-v1");
const SHARED_SECRET_LENGTH = 32;

function resolveAlgorithm(algorithmId) {
  if (algorithmId !== ALGORITHM_ID) {
    throw new InayaValidationError(
      `PqcProvider: unsupported algorithm "${algorithmId}". Supported: ${ALGORITHM_ID}. ` +
        `An envelope naming an unrecognized algorithm must be rejected by the caller, never guessed at.`
    );
  }
}

/** Non-secret capability info a client can advertise/compare before issuing a PQC-requiring envelope to it. */
export function capabilityInfo(algorithmId = ALGORITHM_ID) {
  resolveAlgorithm(algorithmId);
  return {
    algorithmId,
    mlKemPublicKeyLength: ml_kem768.lengths.publicKey,
    mlKemSecretKeyLength: ml_kem768.lengths.secretKey,
    mlKemCipherTextLength: ml_kem768.lengths.cipherText,
    x25519PublicKeyLength: 32,
    x25519SecretKeyLength: 32,
    sharedSecretLength: SHARED_SECRET_LENGTH,
  };
}

/**
 * Generates one device's full hybrid key pair -- an ML-KEM-768 pair AND an X25519 pair. Must be
 * called on the device itself -- both secret keys this returns must never be sent to a server,
 * logged, put in a URL, or serialized into analytics/crash telemetry (ADR §4, SOW §4.8).
 */
export function generateKeyPair(algorithmId = ALGORITHM_ID) {
  resolveAlgorithm(algorithmId);
  const mlKem = ml_kem768.keygen();
  const x25519SecretKey = x25519.utils.randomSecretKey();
  const x25519PublicKey = x25519.getPublicKey(x25519SecretKey);
  return {
    algorithmId,
    publicKey: concatBytes(mlKem.publicKey, x25519PublicKey), // fixed-length concat: ml_kem768 pubkey is always 1184 bytes
    secretKey: concatBytes(mlKem.secretKey, x25519SecretKey), // ml_kem768 secretkey is always 2400 bytes
  };
}

function splitPublicKey(publicKey) {
  const mlKemLen = ml_kem768.lengths.publicKey;
  if (!publicKey || publicKey.length !== mlKemLen + 32) {
    throw new InayaValidationError(`PqcProvider: malformed hybrid public key (expected ${mlKemLen + 32} bytes).`);
  }
  return { mlKemPublicKey: publicKey.subarray(0, mlKemLen), x25519PublicKey: publicKey.subarray(mlKemLen) };
}

function splitSecretKey(secretKey) {
  const mlKemLen = ml_kem768.lengths.secretKey;
  if (!secretKey || secretKey.length !== mlKemLen + 32) {
    throw new InayaValidationError(`PqcProvider: malformed hybrid secret key (expected ${mlKemLen + 32} bytes).`);
  }
  return { mlKemSecretKey: secretKey.subarray(0, mlKemLen), x25519SecretKey: secretKey.subarray(mlKemLen) };
}

/**
 * Encapsulates a fresh hybrid shared secret to a recipient's public key (sender side). Combines a
 * fresh X25519 ECDH shared secret with a fresh ML-KEM-768 encapsulated shared secret through
 * HKDF-SHA256, with domain separation (a fixed info label plus both ciphertexts and both public
 * keys bound into the HKDF input) -- never a bare concatenation of the two raw secrets (SOW
 * §4.12's explicit requirement). Returns a single combined cipherText safe to transmit/store (not
 * secret on its own) plus the 32-byte combined shared secret the sender uses locally to wrap a
 * content/file key.
 */
export function encapsulate(recipientPublicKey, algorithmId = ALGORITHM_ID) {
  resolveAlgorithm(algorithmId);
  if (!recipientPublicKey || !recipientPublicKey.length) {
    throw new InayaValidationError("PqcProvider.encapsulate: recipientPublicKey is required.");
  }
  const { mlKemPublicKey, x25519PublicKey } = splitPublicKey(recipientPublicKey);

  const { cipherText: mlKemCipherText, sharedSecret: mlKemSecret } = ml_kem768.encapsulate(mlKemPublicKey);
  const ephemeralSecretKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey);
  const x25519Secret = x25519.getSharedSecret(ephemeralSecretKey, x25519PublicKey);

  const sharedSecret = hkdf(
    sha256,
    concatBytes(x25519Secret, mlKemSecret),
    undefined,
    concatBytes(HYBRID_INFO, mlKemCipherText, ephemeralPublicKey, mlKemPublicKey, x25519PublicKey),
    SHARED_SECRET_LENGTH
  );
  mlKemSecret.fill(0);
  x25519Secret.fill(0);

  return {
    algorithmId,
    cipherText: concatBytes(mlKemCipherText, ephemeralPublicKey), // fixed-length concat: ml_kem768 ciphertext is always 1088 bytes
    sharedSecret,
  };
}

/**
 * Recovers the hybrid shared secret from a ciphertext using the recipient's own hybrid secret key
 * (recipient side). Reconstructs the identical HKDF input the sender used, so this returns the
 * identical 32-byte shared secret only when the ciphertext and keys are genuine. ML-KEM's implicit-
 * rejection property means a corrupted/forged ML-KEM ciphertext does not throw here -- it
 * deterministically yields a different ML-KEM shared secret, so the final combined output differs
 * too; the caller's subsequent AEAD decrypt of the wrapped key is what actually fails (see
 * docs/security/pqc-threat-model.md T7).
 */
export function decapsulate(cipherText, secretKey, algorithmId = ALGORITHM_ID) {
  resolveAlgorithm(algorithmId);
  if (!cipherText || !cipherText.length) throw new InayaValidationError("PqcProvider.decapsulate: cipherText is required.");
  if (!secretKey || !secretKey.length) throw new InayaValidationError("PqcProvider.decapsulate: secretKey is required.");

  const mlKemCtLen = ml_kem768.lengths.cipherText;
  if (cipherText.length !== mlKemCtLen + 32) {
    throw new InayaValidationError(`PqcProvider.decapsulate: malformed hybrid ciphertext (expected ${mlKemCtLen + 32} bytes).`);
  }
  const mlKemCipherText = cipherText.subarray(0, mlKemCtLen);
  const ephemeralPublicKey = cipherText.subarray(mlKemCtLen);
  const { mlKemSecretKey, x25519SecretKey } = splitSecretKey(secretKey);
  const mlKemPublicKey = ml_kem768.getPublicKey(mlKemSecretKey);
  const x25519PublicKey = x25519.getPublicKey(x25519SecretKey);

  const mlKemSecret = ml_kem768.decapsulate(mlKemCipherText, mlKemSecretKey);
  const x25519Secret = x25519.getSharedSecret(x25519SecretKey, ephemeralPublicKey);

  const sharedSecret = hkdf(
    sha256,
    concatBytes(x25519Secret, mlKemSecret),
    undefined,
    concatBytes(HYBRID_INFO, mlKemCipherText, ephemeralPublicKey, mlKemPublicKey, x25519PublicKey),
    SHARED_SECRET_LENGTH
  );
  mlKemSecret.fill(0);
  x25519Secret.fill(0);

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
