// test/attestation.test.mjs
//
// Trust Fabric SOW, Workstream A — coverage for attestation.js's
// Provider Adapter -> Verifier -> Policy Engine -> KeyBroker pipeline. The adversarial cases
// below are the SOW's own required proof: a protected value must be unobtainable by skipping
// attestation, presenting a tampered evidence object, replaying a past evidence object, or
// waiting out its expiry — same fail-closed discipline as complianceProofs.test.mjs and
// intent.test.mjs's sibling Workstream B/C suites.
//
// Run with: node --test test/attestation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSoftwareSimAdapter,
  verifyAttestation,
  evaluateAttestationPolicy,
  createKeyBroker,
  Attestation,
} from "../src/attestation.js";
import { InayaValidationError } from "../src/errors.js";

const WORKLOAD_A = "function processCompliancePayload(x) { return sha256(x); }";
const WORKLOAD_B = "function somethingElseEntirely() { return 42; }";

test("Attestation export carries the whole pipeline", () => {
  assert.equal(Attestation.createSoftwareSimAdapter, createSoftwareSimAdapter);
  assert.equal(Attestation.verifyAttestation, verifyAttestation);
  assert.equal(Attestation.evaluateAttestationPolicy, evaluateAttestationPolicy);
  assert.equal(Attestation.createKeyBroker, createKeyBroker);
});

test("SoftwareSimAdapter: every evidence object honestly declares hardwareBacked: false", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  assert.equal(evidence.hardwareBacked, false);
  assert.equal(evidence.provider, "software-sim");
});

test("SoftwareSimAdapter: workloadMeasurement is a real sha256 of the workload source, not a placeholder", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidenceA1 = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const evidenceA2 = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const evidenceB = await adapter.getAttestationReport({ workloadSource: WORKLOAD_B });

  assert.equal(evidenceA1.workloadMeasurement, evidenceA2.workloadMeasurement, "same workload source must hash identically");
  assert.notEqual(evidenceA1.workloadMeasurement, evidenceB.workloadMeasurement, "different workload source must hash differently");
});

test("SoftwareSimAdapter: getAttestationReport rejects a missing workloadSource", async () => {
  const adapter = createSoftwareSimAdapter();
  await assert.rejects(() => adapter.getAttestationReport({}), InayaValidationError);
});

test("happy path: a genuine, fresh, approved-measurement evidence object verifies VALID and the broker releases its value", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });

  const verification = verifyAttestation({ evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement] });
  assert.equal(verification.status, "VALID");

  const decision = evaluateAttestationPolicy({ verification, evidence, policy: {} });
  assert.equal(decision.decision, "ALLOW");

  const broker = createKeyBroker();
  broker.registerProtectedValue("compliance-processor-key", "super-secret-scoped-value");
  const result = broker.releaseKey({ scope: "compliance-processor-key", evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement], policy: {} });
  assert.equal(result.released, true);
  assert.equal(result.value, "super-secret-scoped-value");
});

test("adversarial: a tampered measurement (attacker swaps in a different workload after signing) fails signature verification", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const tampered = { ...evidence, workloadMeasurement: "0".repeat(64) };

  const verification = verifyAttestation({ evidence: tampered, adapter, approvedMeasurements: [evidence.workloadMeasurement] });
  assert.equal(verification.status, "INVALID");
  assert.equal(verification.reason, "signature_invalid");
});

test("adversarial: a tampered nonce fails signature verification", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const tampered = { ...evidence, nonce: "f".repeat(64) };

  const verification = verifyAttestation({ evidence: tampered, adapter, approvedMeasurements: [evidence.workloadMeasurement] });
  assert.equal(verification.status, "INVALID");
  assert.equal(verification.reason, "signature_invalid");
});

test("adversarial: a forged evidence object (attacker's own key, claiming the victim's platformIdentity) cannot produce a valid signature", async () => {
  const victimAdapter = createSoftwareSimAdapter();
  const attackerAdapter = createSoftwareSimAdapter();
  const victimEvidence = await victimAdapter.getAttestationReport({ workloadSource: WORKLOAD_A });

  // Attacker crafts evidence that claims to be from the victim's platform but is actually signed
  // by the attacker's own key (they don't hold the victim's secret key, so they can't sign
  // correctly for it) -- simulate this by taking the attacker's real evidence and overwriting
  // platformIdentity to point at the victim.
  const attackerEvidence = await attackerAdapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const forged = { ...attackerEvidence, platformIdentity: victimEvidence.platformIdentity };

  const verification = verifyAttestation({ evidence: forged, adapter: victimAdapter, approvedMeasurements: [WORKLOAD_A].map(() => victimEvidence.workloadMeasurement) });
  assert.equal(verification.status, "INVALID");
  assert.equal(verification.reason, "signature_invalid");
});

test("expired evidence is rejected with EXPIRED, and the policy engine calls for REQUIRE_REATTESTATION, never a silent ALLOW", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A, ttlMs: -1 }); // already expired the instant it's issued

  const verification = verifyAttestation({ evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement] });
  assert.equal(verification.status, "EXPIRED");

  const decision = evaluateAttestationPolicy({ verification, evidence, policy: {} });
  assert.equal(decision.decision, "REQUIRE_REATTESTATION");
});

test("no measurement allowlist configured yields UNKNOWN, never a fabricated VALID — the same 'unknown is never fabricated as passing' rule as compliance-health.js", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });

  const verification = verifyAttestation({ evidence, adapter, approvedMeasurements: undefined });
  assert.equal(verification.status, "UNKNOWN");

  const decision = evaluateAttestationPolicy({ verification, evidence, policy: {} });
  assert.equal(decision.decision, "DENY", "UNKNOWN must never resolve to ALLOW");
});

test("a measurement outside the approved allowlist (unrecognized/unapproved workload) is denied", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_B });

  const verification = verifyAttestation({ evidence, adapter, approvedMeasurements: [(await adapter.getAttestationReport({ workloadSource: WORKLOAD_A })).workloadMeasurement] });
  assert.equal(verification.status, "INVALID");
  assert.equal(verification.reason, "measurement_not_approved");
});

test("policy.requireHardware denies a perfectly valid but software-simulated attestation — hardwareBacked is honored, not ignored", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const verification = verifyAttestation({ evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement] });
  assert.equal(verification.status, "VALID");

  const decision = evaluateAttestationPolicy({ verification, evidence, policy: { requireHardware: true } });
  assert.equal(decision.decision, "DENY");
  assert.equal(decision.reason, "hardware_attestation_required_but_evidence_is_software_simulated");
});

test("adversarial (replay): the SAME evidence object cannot release the same protected value twice", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const broker = createKeyBroker();
  broker.registerProtectedValue("scope-1", "value-1");

  const first = broker.releaseKey({ scope: "scope-1", evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement], policy: {} });
  assert.equal(first.released, true);

  const replay = broker.releaseKey({ scope: "scope-1", evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement], policy: {} });
  assert.equal(replay.released, false);
  assert.equal(replay.reason, "nonce_reused_replay_detected");
});

test("adversarial (bypass attempt): the KeyBroker cannot be tricked into releasing a value by skipping attestation entirely", () => {
  const broker = createKeyBroker();
  broker.registerProtectedValue("scope-1", "value-1");

  const result = broker.releaseKey({ scope: "scope-1", evidence: null, adapter: null, approvedMeasurements: [], policy: {} });
  assert.equal(result.released, false);
  assert.equal(result.reason, "malformed_evidence");
});

test("adversarial (bypass attempt): a KeyBroker caller cannot shortcut the pipeline by handing it a pre-fabricated ALLOW decision — releaseKey always re-verifies itself", async () => {
  const adapter = createSoftwareSimAdapter();
  // A tampered evidence object an attacker fully controls, paired with an attempt to smuggle in
  // a fabricated "already decided" ALLOW — releaseKey's signature takes no such parameter at all,
  // so there is no code path that accepts one; this is the structural proof of that.
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const tampered = { ...evidence, workloadMeasurement: "attacker-controlled-measurement" };
  const broker = createKeyBroker();
  broker.registerProtectedValue("scope-1", "value-1");

  const result = broker.releaseKey({
    scope: "scope-1",
    evidence: tampered,
    adapter,
    approvedMeasurements: ["attacker-controlled-measurement"], // even if the attacker also controlled the allowlist
    policy: {},
    decision: "ALLOW", // extraneous — releaseKey has no parameter that trusts this
  });
  assert.equal(result.released, false);
  assert.equal(result.reason, "signature_invalid");
});

test("releaseKey against an unregistered scope fails closed, not with an undefined value", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const broker = createKeyBroker();

  const result = broker.releaseKey({ scope: "never-registered", evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement], policy: {} });
  assert.equal(result.released, false);
  assert.equal(result.reason, "unknown_scope");
  assert.equal(result.value, null);
});

test("a rejected release (wrong measurement) does not burn the evidence's nonce — a legitimately corrected retry with the SAME evidence still isn't possible after allowlist fix (must re-attest), but a bystander's unrelated valid release for a different scope is unaffected", async () => {
  const adapter = createSoftwareSimAdapter();
  const evidence = await adapter.getAttestationReport({ workloadSource: WORKLOAD_A });
  const broker = createKeyBroker();
  broker.registerProtectedValue("scope-a", "value-a");
  broker.registerProtectedValue("scope-b", "value-b");

  // First attempt: wrong allowlist, rejected (not the evidence's fault).
  const rejected = broker.releaseKey({ scope: "scope-a", evidence, adapter, approvedMeasurements: ["some-other-measurement"], policy: {} });
  assert.equal(rejected.released, false);
  assert.equal(rejected.reason, "measurement_not_approved");

  // Second attempt: correct allowlist this time, same evidence, different scope -- still succeeds,
  // proving the earlier rejection did not spuriously burn the nonce.
  const succeeded = broker.releaseKey({ scope: "scope-b", evidence, adapter, approvedMeasurements: [evidence.workloadMeasurement], policy: {} });
  assert.equal(succeeded.released, true);
});
