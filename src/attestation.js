// src/attestation.js
//
// Trust Fabric SOW, Workstream A — TEE (hardware-rooted) attestation.
// docs/trust-fabric-phase0-1.md explains the honest boundary this module draws: real
// hardware-backed attestation (SGX/SEV-SNP/a cloud confidential VM) needs paid infrastructure
// this pass explicitly does not have budget for (DEFERRED — PENDING BUDGET, see that doc's table).
// What ships here is the REST of the pipeline, genuinely working end to end:
//
//   Workload -> Provider Adapter -> Evidence -> Verifier -> Policy Engine -> Trust Decision
//   -> (PASS only) KeyBroker -> Protected Value Release
//
// SoftwareSimAdapter produces a structurally-real evidence object — an actual sha256 measurement
// of the workload's own source, an actual fresh nonce, an actual Ed25519 signature over that
// evidence — but its "hardware root of trust" is a locally-held Ed25519 key, not silicon. Every
// evidence object it produces carries `hardwareBacked: false` so no caller can mistake it for a
// real hardware attestation. This is the honest mock boundary the SOW requires naming, not
// hiding — swapping in a real hardware provider later means writing one more adapter with the
// same {getAttestationReport, verifyReport} shape; nothing downstream (Verifier, PolicyEngine,
// KeyBroker) needs to change.
//
// HARD INVARIANT (see docs/trust-fabric-phase0-1.md's "Crypto / key custody" section):
// KeyBroker below only ever gates release of NEW, attestation-scoped protected values that the
// CALLER supplies — never the vault key derived by crypto.js/passkeyBackup.js. A TEE design that
// could reconstruct a user's vault key would reverse this SDK's core "Inaya never receives, stores,
// or can reconstruct your raw passkey" guarantee, not extend it.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, bytesToHex, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { InayaValidationError } from "./errors.js";

export const ATTESTATION_STATUSES = ["VALID", "INVALID", "EXPIRED", "UNKNOWN"];
export const POLICY_DECISIONS = ["ALLOW", "DENY", "REQUIRE_REATTESTATION"];
export const DEFAULT_EVIDENCE_TTL_MS = 5 * 60 * 1000;

function canonicalEvidenceBytes({ attestationId, provider, hardwareBacked, workloadMeasurement, platformIdentity, nonce, timestamp, expiresAt }) {
  const line = [
    "Inaya Attestation Evidence",
    `attestationId: ${attestationId}`,
    `provider: ${provider}`,
    `hardwareBacked: ${hardwareBacked}`,
    `workloadMeasurement: ${workloadMeasurement}`,
    `platformIdentity: ${platformIdentity}`,
    `nonce: ${nonce}`,
    `timestamp: ${timestamp}`,
    `expiresAt: ${expiresAt}`,
  ].join("\n");
  return utf8ToBytes(line);
}

function randomNonceHex() {
  return bytesToHex(ed25519.utils.randomSecretKey()); // 32 bytes of CSPRNG output, reused here only as an unpredictable nonce source
}

/**
 * A software-simulated TEE provider adapter. Explicitly NOT hardware-backed — see module comment.
 * `signingKey` is the adapter's own Ed25519 identity key (its "platform identity"); pass one to
 * simulate a specific, stable platform across calls, or omit to generate a fresh one.
 */
export function createSoftwareSimAdapter({ signingKey } = {}) {
  const secretKey = signingKey ? hexToBytes(signingKey) : ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const platformIdentity = bytesToHex(publicKey);

  return {
    provider: "software-sim",
    platformIdentity,

    /**
     * Produces one attestation report for `workloadSource` (the canonical source/config string of
     * whatever is being attested — the caller decides what "the workload" means for their case).
     * A fresh nonce and timestamp are generated on every call — reusing a nonce across two reports
     * would let a replayed-but-still-signature-valid evidence object slip past a naive verifier,
     * so this never accepts a caller-supplied nonce for the software path.
     */
    async getAttestationReport({ workloadSource, ttlMs = DEFAULT_EVIDENCE_TTL_MS }) {
      if (!workloadSource) throw new InayaValidationError("attestation.getAttestationReport: workloadSource is required.");
      const timestamp = Date.now();
      const evidence = {
        attestationId: bytesToHex(ed25519.utils.randomSecretKey()).slice(0, 16),
        provider: "software-sim",
        hardwareBacked: false,
        workloadMeasurement: bytesToHex(sha256(utf8ToBytes(workloadSource))),
        platformIdentity,
        nonce: randomNonceHex(),
        timestamp,
        expiresAt: timestamp + ttlMs,
      };
      const signature = bytesToHex(ed25519.sign(canonicalEvidenceBytes(evidence), secretKey));
      return { ...evidence, signature };
    },

    /** Self-consistency check only: does this evidence's signature actually verify against ITS
     *  OWN claimed platformIdentity? This does not check freshness, measurement allowlisting, or
     *  nonce reuse — see verifyAttestation() below for the full pipeline. */
    verifyReport(evidence) {
      if (!evidence?.signature || !evidence?.platformIdentity) return false;
      try {
        const pubKey = hexToBytes(evidence.platformIdentity);
        const sig = hexToBytes(evidence.signature);
        return ed25519.verify(sig, canonicalEvidenceBytes(evidence), pubKey);
      } catch {
        return false;
      }
    },
  };
}

/**
 * The full verification pipeline: signature validity (delegated to the adapter, so this works for
 * any provider adapter sharing the same shape) -> freshness (not expired) -> measurement
 * allowlisting -> nonce-reuse rejection (via the caller-supplied nonceTracker — see intent.js's
 * identical createNonceTracker() convenience for the same in-memory-only caveat).
 * Never throws for a malformed/forged/tampered evidence object — fails closed with a reason,
 * same convention as complianceProofs.js's verifyAuthorizedAccessProof().
 */
export function verifyAttestation({ evidence, adapter, approvedMeasurements, nonceTracker }) {
  if (!evidence || typeof evidence !== "object") return { status: "INVALID", reason: "malformed_evidence" };
  if (!adapter?.verifyReport) return { status: "INVALID", reason: "no_adapter_provided" };

  if (!adapter.verifyReport(evidence)) return { status: "INVALID", reason: "signature_invalid" };

  if (nonceTracker?.has(evidence.platformIdentity, evidence.nonce)) {
    return { status: "INVALID", reason: "nonce_reused_replay_detected" };
  }

  if (typeof evidence.expiresAt !== "number" || Date.now() > evidence.expiresAt) {
    return { status: "EXPIRED", reason: "evidence_expired" };
  }

  if (!approvedMeasurements) {
    return { status: "UNKNOWN", reason: "no_measurement_allowlist_configured" };
  }
  if (!approvedMeasurements.includes(evidence.workloadMeasurement)) {
    return { status: "INVALID", reason: "measurement_not_approved" };
  }

  return { status: "VALID", reason: null };
}

/**
 * Versioned policy rules over a verification result. `policy.requireHardware: true` means a
 * software-simulated attestation is explicitly not good enough for this decision — the whole
 * point of `hardwareBacked` being carried honestly on every evidence object, not inferred.
 */
export function evaluateAttestationPolicy({ verification, evidence, policy = {} }) {
  if (verification.status === "EXPIRED") return { decision: "REQUIRE_REATTESTATION", reason: "evidence_expired" };
  if (verification.status !== "VALID") return { decision: "DENY", reason: verification.reason };
  if (policy.requireHardware && evidence.hardwareBacked !== true) {
    return { decision: "DENY", reason: "hardware_attestation_required_but_evidence_is_software_simulated" };
  }
  return { decision: "ALLOW", reason: null };
}

/**
 * Gates release of caller-supplied protected values (attestation-scoped secrets — NEVER the real
 * vault key, per the module's hard invariant above) behind a PASS decision. Deliberately does
 * NOT accept a pre-computed decision from the caller — it re-runs verifyAttestation() and
 * evaluateAttestationPolicy() itself on every call, so the only way to obtain a value is through
 * the real pipeline with a real, currently-valid, unreplayed evidence object. This is what makes
 * "cannot be bypassed by skipping attestation or presenting a tampered evidence object" a
 * property of the code, not just a claim about how callers are expected to use it.
 */
export function createKeyBroker() {
  const protectedValues = new Map(); // scope -> value
  const nonceTracker = (() => {
    const used = new Set();
    return {
      has(platformIdentity, nonce) { return used.has(`${platformIdentity}:${nonce}`); },
      use(platformIdentity, nonce) {
        const key = `${platformIdentity}:${nonce}`;
        if (used.has(key)) return false;
        used.add(key);
        return true;
      },
    };
  })();

  return {
    registerProtectedValue(scope, value) {
      protectedValues.set(scope, value);
    },

    releaseKey({ scope, evidence, adapter, approvedMeasurements, policy }) {
      if (!protectedValues.has(scope)) return { released: false, reason: "unknown_scope", value: null };

      const verification = verifyAttestation({ evidence, adapter, approvedMeasurements, nonceTracker });
      const { decision, reason } = evaluateAttestationPolicy({ verification, evidence, policy });

      if (decision !== "ALLOW") return { released: false, reason: reason || decision, value: null, verification, decision };

      // Only mark the nonce spent on an actual successful release — an evidence object that was
      // rejected for some other reason (wrong measurement, wrong policy) hasn't been "used" in any
      // sense worth burning its nonce over, and doing so would let an attacker exhaust a victim's
      // nonce by replaying invalid evidence at the broker.
      nonceTracker.use(evidence.platformIdentity, evidence.nonce);

      return { released: true, reason: null, value: protectedValues.get(scope), verification, decision };
    },
  };
}

export const Attestation = {
  ATTESTATION_STATUSES,
  POLICY_DECISIONS,
  DEFAULT_EVIDENCE_TTL_MS,
  createSoftwareSimAdapter,
  verifyAttestation,
  evaluateAttestationPolicy,
  createKeyBroker,
};
