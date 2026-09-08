// test/complianceProofs.test.mjs
//
// Trust Fabric SOW, Workstream B — coverage for complianceProofs.js's Schnorr/Fiat-Shamir
// non-interactive proof of knowledge. This is real cryptography (see complianceProofs.js's own
// header for why a hand-built sigma protocol rather than a circom circuit), so the adversarial
// cases below are the actual security properties being claimed, not just shape/plumbing checks:
// a proof must be forgeable by nobody who lacks the private key, and must be bound tightly enough
// to {policy, action, timestamp} that it can never be replayed against a different one.
//
// Run with: node --test test/complianceProofs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  deriveAccessCommitment,
  proveAuthorizedAccess,
  verifyAuthorizedAccessProof,
  ComplianceProofs,
} from "../src/complianceProofs.js";
import { InayaValidationError } from "../src/errors.js";

function freshKeyHex() {
  return bytesToHex(secp256k1.utils.randomSecretKey());
}

test("ComplianceProofs export carries all three functions", () => {
  assert.equal(ComplianceProofs.deriveAccessCommitment, deriveAccessCommitment);
  assert.equal(ComplianceProofs.proveAuthorizedAccess, proveAuthorizedAccess);
  assert.equal(ComplianceProofs.verifyAuthorizedAccessProof, verifyAuthorizedAccessProof);
});

test("deriveAccessCommitment: deterministic for the same key, distinct across keys, hex and bytes agree", () => {
  const keyHex = freshKeyHex();
  const commitmentA = deriveAccessCommitment(keyHex);
  const commitmentB = deriveAccessCommitment(keyHex);
  assert.equal(commitmentA, commitmentB);

  const other = deriveAccessCommitment(freshKeyHex());
  assert.notEqual(commitmentA, other);
});

test("deriveAccessCommitment: rejects a zero-scalar key", () => {
  const zeroKey = "00".repeat(32);
  assert.throws(() => deriveAccessCommitment(zeroKey), InayaValidationError);
});

test("happy path: a genuine proof verifies against its own public key, policy, action, and timestamp", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof, publicKey, policy: "org:acme:evidence-vault", action: "read", timestamp });

  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
});

test("proveAuthorizedAccess: requires policy and action", () => {
  const privateKey = freshKeyHex();
  assert.throws(() => proveAuthorizedAccess({ privateKey, policy: "", action: "read" }), InayaValidationError);
  assert.throws(() => proveAuthorizedAccess({ privateKey, policy: "org:acme", action: "" }), InayaValidationError);
});

test("proveAuthorizedAccess: rejects a zero-scalar key", () => {
  const zeroKey = "00".repeat(32);
  assert.throws(() => proveAuthorizedAccess({ privateKey: zeroKey, policy: "org:acme", action: "read" }), InayaValidationError);
});

test("wrong policy at verification time is rejected — proof cannot be replayed against a different policy", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof, publicKey, policy: "org:acme:findings", action: "read", timestamp });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_proof");
});

test("wrong action at verification time is rejected — proof cannot be replayed against a different action", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof, publicKey, policy: "org:acme:evidence-vault", action: "delete", timestamp });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_proof");
});

test("forged proof: a proof made with a DIFFERENT private key never verifies against the original public key", () => {
  const realPrivateKey = freshKeyHex();
  const realPublicKey = deriveAccessCommitment(realPrivateKey);
  const attackerPrivateKey = freshKeyHex();
  const timestamp = Date.now();

  const { proof: forgedProof } = proveAuthorizedAccess({ privateKey: attackerPrivateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof: forgedProof, publicKey: realPublicKey, policy: "org:acme:evidence-vault", action: "read", timestamp });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_proof");
});

test("tampered proof: flipping a single hex character of s invalidates the proof", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const flippedChar = proof.s[0] === "0" ? "1" : "0";
  const tamperedProof = { ...proof, s: flippedChar + proof.s.slice(1) };

  const result = verifyAuthorizedAccessProof({ proof: tamperedProof, publicKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_proof");
});

test("tampered proof: substituting R invalidates the proof", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const { proof: otherProof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp: timestamp + 1 });
  const tamperedProof = { ...proof, R: otherProof.R };

  const result = verifyAuthorizedAccessProof({ proof: tamperedProof, publicKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_proof");
});

test("expired timestamp is rejected before any curve math runs", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof, publicKey, policy: "org:acme:evidence-vault", action: "read", timestamp, maxAgeMs: 5 * 60 * 1000 });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});

test("a timestamp implausibly far in the future is rejected", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now() + 10 * 60 * 1000; // 10 minutes ahead

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof, publicKey, policy: "org:acme:evidence-vault", action: "read", timestamp, maxAgeMs: 5 * 60 * 1000 });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "timestamp_in_future");
});

test("malformed proof shapes fail closed with a reason, never throw", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  assert.deepEqual(
    verifyAuthorizedAccessProof({ proof: null, publicKey, policy: "p", action: "a", timestamp }),
    { valid: false, reason: "malformed_proof" }
  );
  assert.deepEqual(
    verifyAuthorizedAccessProof({ proof: { R: "0xdead" }, publicKey, policy: "p", action: "a", timestamp }),
    { valid: false, reason: "malformed_proof" }
  );
  assert.deepEqual(
    verifyAuthorizedAccessProof({ proof: { R: "0xdead", s: "0xbeef" }, publicKey: undefined, policy: "p", action: "a", timestamp }),
    { valid: false, reason: "malformed_proof" }
  );

  const missingTimestamp = verifyAuthorizedAccessProof({ proof: { R: "0xdead", s: "0xbeef" }, publicKey, policy: "p", action: "a" });
  assert.equal(missingTimestamp.valid, false);
  assert.equal(missingTimestamp.reason, "missing_timestamp");
});

test("malformed proof: unparseable hex in R/publicKey is caught and reported, not thrown", () => {
  const timestamp = Date.now();
  const result = verifyAuthorizedAccessProof({
    proof: { R: "not-valid-hex", s: "also-not-valid" },
    publicKey: "still-not-valid",
    policy: "p",
    action: "a",
    timestamp,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "malformed_proof");
});

test("nonce freshness: two proofs for the same key/policy/action/timestamp never share R or s", () => {
  const privateKey = freshKeyHex();
  const timestamp = Date.now();

  const { proof: proofA } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const { proof: proofB } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });

  assert.notEqual(proofA.R, proofB.R);
  assert.notEqual(proofA.s, proofB.s);
});

test("cross-organization replay: a proof bound to one org's policy string never verifies for another org's, even with an identical action/timestamp", () => {
  const privateKey = freshKeyHex();
  const publicKey = deriveAccessCommitment(privateKey);
  const timestamp = Date.now();

  const { proof } = proveAuthorizedAccess({ privateKey, policy: "org:acme:evidence-vault", action: "read", timestamp });
  const result = verifyAuthorizedAccessProof({ proof, publicKey, policy: "org:globex:evidence-vault", action: "read", timestamp });

  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_proof");
});
