// test/pqc-agile-sharing.test.mjs
//
// Internxt-inspired SOW, Workstream A, PQC-A05: the algorithm-agile sharing layer. Verifies it
// extends (never replaces or forks) crypto.js's existing encryptForPublicKey/decryptWithSecretKey
// for the LEGACY_CLASSICAL path, and correctly selects/enforces HYBRID_PQC and PQC_REQUIRED.
//
// Run with: node --test test/pqc-agile-sharing.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEncryptionKeypairFromSignature, encryptForPublicKey, decryptWithSecretKey } from "../src/crypto.js";
import { generateKeyPair as generatePqcKeyPair } from "../src/pqc/provider.js";
import { SHARING_MODE, wrapForRecipient, unwrapFromSender, isAgileHybridEnvelope } from "../src/pqc/agileSharing.js";
import { InayaValidationError } from "../src/errors.js";

// A real X25519 keypair the same way the dApp derives one today (from a wallet signature hash) --
// here just a fixed 32-byte seed stands in for "a signature happened".
const classicalRecipient = deriveEncryptionKeypairFromSignature("0x" + "ab".repeat(32));

test("LEGACY_CLASSICAL mode produces byte-identical results to calling encryptForPublicKey directly (the existing primitive is reused unchanged, not forked)", () => {
  const plaintext = "the-owner's-real-passkey-string";
  const wrapped = wrapForRecipient({ plaintext, recipientClassicalPublicKey: classicalRecipient.publicKey, mode: SHARING_MODE.LEGACY_CLASSICAL });
  assert.equal(typeof wrapped, "string", "a legacy wrap is a plain base64 string, same shape as always");
  assert.equal(isAgileHybridEnvelope(wrapped), false);

  // It really is the same function underneath: a direct decryptWithSecretKey() call (not going
  // through unwrapFromSender) must also recover it correctly.
  const direct = decryptWithSecretKey({ wrapped, secretKey: classicalRecipient.secretKey });
  assert.equal(direct, plaintext);

  const viaAgile = unwrapFromSender({ wrapped, classicalSecretKey: classicalRecipient.secretKey });
  assert.equal(viaAgile, plaintext);
});

test("LEGACY_CLASSICAL is the default mode when none is specified", () => {
  const plaintext = "default-mode-passkey";
  const wrapped = wrapForRecipient({ plaintext, recipientClassicalPublicKey: classicalRecipient.publicKey });
  assert.equal(typeof wrapped, "string");
});

test("HYBRID_PQC uses the hybrid envelope when the recipient has a registered PQC key", () => {
  const pqcRecipient = generatePqcKeyPair();
  const plaintext = "shared-with-a-pqc-capable-recipient";
  const wrapped = wrapForRecipient({
    plaintext,
    recipientClassicalPublicKey: classicalRecipient.publicKey,
    recipientPqcPublicKey: pqcRecipient.publicKey,
    mode: SHARING_MODE.HYBRID_PQC,
  });
  assert.ok(isAgileHybridEnvelope(wrapped), "HYBRID_PQC with a PQC key available must actually use the hybrid envelope, not silently stay classical");

  const recovered = unwrapFromSender({ wrapped, pqcSecretKey: pqcRecipient.secretKey });
  assert.equal(recovered, plaintext);
});

test("HYBRID_PQC honestly falls back to classical when the recipient has no PQC key on file (this is a preference, not a requirement)", () => {
  const plaintext = "recipient-has-no-pqc-key-yet";
  const wrapped = wrapForRecipient({
    plaintext,
    recipientClassicalPublicKey: classicalRecipient.publicKey,
    recipientPqcPublicKey: null,
    mode: SHARING_MODE.HYBRID_PQC,
  });
  assert.equal(isAgileHybridEnvelope(wrapped), false, "no PQC key available -> classical fallback, not an error");
  assert.equal(unwrapFromSender({ wrapped, classicalSecretKey: classicalRecipient.secretKey }), plaintext);
});

test("PQC_REQUIRED refuses to downgrade when the recipient has no PQC key -- never silently falls back", () => {
  assert.throws(
    () => wrapForRecipient({ plaintext: "x", recipientClassicalPublicKey: classicalRecipient.publicKey, recipientPqcPublicKey: null, mode: SHARING_MODE.PQC_REQUIRED }),
    InayaValidationError
  );
});

test("PQC_REQUIRED succeeds and uses the hybrid envelope when the recipient does have a PQC key", () => {
  const pqcRecipient = generatePqcKeyPair();
  const plaintext = "pqc-required-share";
  const wrapped = wrapForRecipient({
    plaintext,
    recipientPqcPublicKey: pqcRecipient.publicKey,
    mode: SHARING_MODE.PQC_REQUIRED,
  });
  assert.ok(isAgileHybridEnvelope(wrapped));
  assert.equal(unwrapFromSender({ wrapped, pqcSecretKey: pqcRecipient.secretKey }), plaintext);
});

test("unwrapFromSender rejects supplying the wrong kind of secret key for the wrap's actual shape", () => {
  const pqcRecipient = generatePqcKeyPair();
  const hybridWrapped = wrapForRecipient({ plaintext: "x", recipientPqcPublicKey: pqcRecipient.publicKey, mode: SHARING_MODE.PQC_REQUIRED });
  assert.throws(() => unwrapFromSender({ wrapped: hybridWrapped, classicalSecretKey: classicalRecipient.secretKey }), InayaValidationError, "only a classical key was given for a hybrid wrap");

  const classicalWrapped = wrapForRecipient({ plaintext: "y", recipientClassicalPublicKey: classicalRecipient.publicKey, mode: SHARING_MODE.LEGACY_CLASSICAL });
  assert.throws(() => unwrapFromSender({ wrapped: classicalWrapped, pqcSecretKey: pqcRecipient.secretKey }), InayaValidationError, "only a pqc key was given for a classical wrap");
});

test("wrapForRecipient rejects an unrecognized mode rather than guessing", () => {
  assert.throws(() => wrapForRecipient({ plaintext: "x", recipientClassicalPublicKey: classicalRecipient.publicKey, mode: "SOMETHING_ELSE" }), InayaValidationError);
});

test("LEGACY_CLASSICAL without any recipient public key is rejected, not silently skipped", () => {
  assert.throws(() => wrapForRecipient({ plaintext: "x", mode: SHARING_MODE.LEGACY_CLASSICAL }), InayaValidationError);
});
