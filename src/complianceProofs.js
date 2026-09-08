// src/complianceProofs.js
//
// Trust Fabric SOW, Workstream B — Zero-Knowledge Compliance Proofs.
// docs/trust-fabric-phase0-1.md explains why this is a hand-built Schnorr/Fiat-Shamir
// non-interactive proof of knowledge on secp256k1 rather than a circom/snarkjs circuit: no
// native toolchain, no trusted-setup ceremony, no new dependency (@noble/curves is already used
// by crypto.js) — appropriate for this one narrowly-scoped statement per the SOW's own "don't
// introduce ZK complexity where conventional mechanisms suffice" principle.
//
// STATEMENT PROVEN: "I control the private key behind this public commitment" — without
// revealing the private key — bound to a specific {policy, action, timestamp} so a valid proof
// can never be replayed for a different policy/action/time. This is real, sound cryptography
// (a sigma-protocol identification scheme, the same primitive family underlying production ZK
// systems), not a demo: zero-knowledge (the response is statistically indistinguishable from
// random without the secret), and sound (forging a valid proof without the secret is exactly as
// hard as the discrete-log problem on secp256k1 — the same hardness assumption Ethereum's own
// signatures rely on).
//
// WHAT THIS DOES NOT DO: prove membership in an anonymous SET (i.e. "I am one of these N
// approved members, but you can't tell which one") — that needs a ring/group signature or a real
// circuit, deliberately out of scope for this pass (see docs/trust-fabric-phase0-1.md's deferred
// list). This proves "I am THIS specific, already-known public key" without revealing the
// matching private key — useful for policy-bound authorization, not anonymity.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, bytesToHex, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { InayaValidationError } from "./errors.js";

const { Point } = secp256k1;
const { Fn } = Point;
const G = Point.BASE;

function normalizePrivateKeyBytes(privateKey) {
  if (privateKey instanceof Uint8Array) return privateKey;
  if (typeof privateKey === "string") return hexToBytes(privateKey.replace(/^0x/, ""));
  throw new InayaValidationError("ComplianceProofs: privateKey must be a hex string or Uint8Array.");
}

function scalarFromBytes(bytes) {
  return Fn.create(BigInt("0x" + bytesToHex(bytes)));
}

/** The Fiat-Shamir transform: replaces the verifier's random challenge (which would make this
 *  an interactive protocol) with a hash of everything the challenge should bind to. Anyone can
 *  recompute this deterministically — that's what makes the proof self-contained and
 *  non-interactive, and what makes it impossible to reuse a proof for a different
 *  policy/action/timestamp (§7.5's "policy-to-proof binding" requirement). */
function fiatShamirChallenge({ RBytes, PBytes, policy, action, timestamp }) {
  const buf = concatBytes(RBytes, PBytes, utf8ToBytes(String(policy)), utf8ToBytes(String(action)), utf8ToBytes(String(timestamp)));
  return scalarFromBytes(sha256(buf));
}

/** The public commitment a verifier already has on file (e.g. registered once at org-membership
 *  time) — derived from a private key without ever transmitting it. Same secp256k1 curve
 *  Ethereum wallets already use, so this can commit to a real wallet's own keypair if desired,
 *  or a purpose-generated one — caller's choice, this function doesn't care which. */
export function deriveAccessCommitment(privateKey) {
  const sk = scalarFromBytes(normalizePrivateKeyBytes(privateKey));
  if (Fn.is0(sk)) throw new InayaValidationError("ComplianceProofs: private key scalar is zero — invalid key.");
  return bytesToHex(G.multiply(sk).toBytes(true));
}

/** Generates the proof. Requires the raw private key in-process (same trust boundary as every
 *  other signing operation in this SDK — see crypto.js's own key-custody discipline) — this
 *  function itself makes zero network calls and returns nothing an eavesdropper could use to
 *  recover the key, but the caller's own process must legitimately hold it to call this at all. */
export function proveAuthorizedAccess({ privateKey, policy, action, timestamp = Date.now() }) {
  if (!policy || !action) throw new InayaValidationError("ComplianceProofs.proveAuthorizedAccess: policy and action are required.");
  const sk = scalarFromBytes(normalizePrivateKeyBytes(privateKey));
  if (Fn.is0(sk)) throw new InayaValidationError("ComplianceProofs: private key scalar is zero — invalid key.");

  const P = G.multiply(sk);
  // Fresh, unpredictable per proof — reusing a nonce across two proofs from the same key would
  // let an observer solve for sk algebraically (the classic ECDSA/Schnorr nonce-reuse attack),
  // so this is drawn fresh from the CSPRNG every call, never derived deterministically from sk.
  const r = scalarFromBytes(secp256k1.utils.randomSecretKey());
  const R = G.multiply(r);

  const c = fiatShamirChallenge({ RBytes: R.toBytes(true), PBytes: P.toBytes(true), policy, action, timestamp });
  const s = Fn.add(r, Fn.mul(c, sk));

  return {
    proof: { R: bytesToHex(R.toBytes(true)), s: s.toString(16).padStart(64, "0") },
    publicKey: bytesToHex(P.toBytes(true)),
    policy, action, timestamp,
  };
}

/** Verifies without ever seeing (or needing) the private key — only the public commitment and
 *  the proof. Returns {valid, reason}, never throws for a malformed/forged proof (fails closed,
 *  reports why, same convention as every other verification function in this codebase). */
export function verifyAuthorizedAccessProof({ proof, publicKey, policy, action, timestamp, maxAgeMs = 5 * 60 * 1000 }) {
  if (!proof?.R || !proof?.s || !publicKey) return { valid: false, reason: "malformed_proof" };
  if (typeof timestamp !== "number") return { valid: false, reason: "missing_timestamp" };
  if (Date.now() - timestamp > maxAgeMs) return { valid: false, reason: "expired" };
  if (Date.now() - timestamp < -maxAgeMs) return { valid: false, reason: "timestamp_in_future" };

  try {
    const R = Point.fromBytes(hexToBytes(proof.R));
    const P = Point.fromBytes(hexToBytes(publicKey));
    const s = Fn.create(BigInt("0x" + proof.s));

    const c = fiatShamirChallenge({ RBytes: R.toBytes(true), PBytes: P.toBytes(true), policy, action, timestamp });

    // The verification equation: s·G should equal R + c·P. This holds if and only if
    // s = r + c·sk for the SAME r that produced R and the SAME sk that produced P — which is
    // only possible if the prover actually knew sk. Nobody can satisfy this by guessing.
    const lhs = G.multiply(s);
    const rhs = R.add(P.multiply(c));
    return { valid: lhs.equals(rhs), reason: lhs.equals(rhs) ? null : "invalid_proof" };
  } catch (err) {
    return { valid: false, reason: "malformed_proof" };
  }
}

export const ComplianceProofs = {
  deriveAccessCommitment,
  proveAuthorizedAccess,
  verifyAuthorizedAccessProof,
};
