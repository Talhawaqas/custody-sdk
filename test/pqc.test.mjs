// test/pqc.test.mjs
//
// Internxt-inspired SOW, Workstream A: PqcProvider + envelope tests. Per SOW §4.23/§14.2: encapsulation/
// decapsulation parity, serialization parity, algorithm identifier validation, downgrade/corruption
// rejection, wrong-recipient rejection, wrong-AAD rejection, wrong-version rejection. Real
// @noble/post-quantum calls throughout -- nothing here is mocked.
//
// Run with: node --test test/pqc.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { ALGORITHM_ID, capabilityInfo, generateKeyPair, encapsulate, decapsulate } from "../src/pqc/provider.js";
import { ENVELOPE_VERSION, wrapContentKeyHybrid, unwrapContentKeyHybrid, isHybridEnvelope } from "../src/pqc/envelope.js";
import { Pqc } from "../src/pqc.js";
import { InayaValidationError, InayaDecryptionError } from "../src/errors.js";

test("capabilityInfo reports the real, documented key/ciphertext/shared-secret lengths", () => {
  const info = capabilityInfo();
  assert.equal(info.algorithmId, ALGORITHM_ID);
  assert.equal(info.mlKemPublicKeyLength, 1184);
  assert.equal(info.mlKemSecretKeyLength, 2400);
  assert.equal(info.mlKemCipherTextLength, 1088);
  assert.equal(info.x25519PublicKeyLength, 32);
  assert.equal(info.x25519SecretKeyLength, 32);
  assert.equal(info.sharedSecretLength, 32);
});

test("capabilityInfo rejects an unrecognized algorithm id rather than guessing", () => {
  assert.throws(() => capabilityInfo("NOT-A-REAL-ALGORITHM"), InayaValidationError);
});

test("generateKeyPair produces real, distinct key material each call", () => {
  const a = generateKeyPair();
  const b = generateKeyPair();
  assert.equal(a.algorithmId, ALGORITHM_ID);
  assert.equal(a.publicKey.length, 1216); // 1184 (ML-KEM-768 public key) + 32 (X25519 public key)
  assert.equal(a.secretKey.length, 2432); // 2400 (ML-KEM-768 secret key) + 32 (X25519 secret key)
  assert.notDeepEqual(Buffer.from(a.secretKey), Buffer.from(b.secretKey), "two keygen calls must not collide");
  assert.notDeepEqual(Buffer.from(a.publicKey), Buffer.from(b.publicKey));
});

test("encapsulate/decapsulate parity: the sender's and recipient's shared secrets match exactly", () => {
  const { publicKey, secretKey } = generateKeyPair();
  const { cipherText, sharedSecret: senderSecret } = encapsulate(publicKey);
  const { sharedSecret: recipientSecret } = decapsulate(cipherText, secretKey);
  assert.equal(cipherText.length, 1120);
  assert.equal(senderSecret.length, 32);
  assert.deepEqual(Buffer.from(senderSecret), Buffer.from(recipientSecret));
});

test("decapsulate with the WRONG secret key yields a different shared secret, not a thrown error (ML-KEM implicit rejection)", () => {
  const recipient = generateKeyPair();
  const stranger = generateKeyPair();
  const { cipherText, sharedSecret: realSecret } = encapsulate(recipient.publicKey);
  const { sharedSecret: wrongSecret } = decapsulate(cipherText, stranger.secretKey);
  assert.notDeepEqual(Buffer.from(realSecret), Buffer.from(wrongSecret));
});

test("decapsulate with a CORRUPTED ciphertext yields a different shared secret, never a crash or a matching secret", () => {
  const { publicKey, secretKey } = generateKeyPair();
  const { cipherText, sharedSecret: realSecret } = encapsulate(publicKey);
  const corrupted = new Uint8Array(cipherText);
  corrupted[0] ^= 0xff;
  const { sharedSecret: wrongSecret } = decapsulate(corrupted, secretKey);
  assert.notDeepEqual(Buffer.from(realSecret), Buffer.from(wrongSecret));
});

test("encapsulate rejects a missing/empty recipient public key", () => {
  assert.throws(() => encapsulate(null), InayaValidationError);
  assert.throws(() => encapsulate(new Uint8Array(0)), InayaValidationError);
});

// ---- Envelope layer ----

test("wrap/unwrap round-trip recovers the exact original 32-byte content key", () => {
  const recipient = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const aad = new TextEncoder().encode("doc:test-object-1");

  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: recipient.publicKey, aad });
  assert.equal(envelope.version, ENVELOPE_VERSION);
  assert.equal(envelope.algorithm, ALGORITHM_ID);
  assert.ok(isHybridEnvelope(envelope));

  const recovered = unwrapContentKeyHybrid({ envelope, recipientSecretKey: recipient.secretKey });
  assert.deepEqual(Buffer.from(recovered), Buffer.from(contentKey));
});

test("wrapContentKeyHybrid rejects an empty content key", () => {
  const recipient = generateKeyPair();
  assert.throws(() => wrapContentKeyHybrid({ contentKey: new Uint8Array(0), recipientPublicKey: recipient.publicKey }), InayaValidationError);
});

test("wrapContentKeyHybrid accepts a non-32-byte secret too (e.g. a variable-length passkey for the sharing layer, not just a fixed AES key)", () => {
  const recipient = generateKeyPair();
  const passkey = new TextEncoder().encode("a much longer arbitrary passkey string, not 32 bytes");
  const envelope = wrapContentKeyHybrid({ contentKey: passkey, recipientPublicKey: recipient.publicKey });
  const recovered = unwrapContentKeyHybrid({ envelope, recipientSecretKey: recipient.secretKey });
  assert.deepEqual(Buffer.from(recovered), Buffer.from(passkey));
});

test("unwrapContentKeyHybrid rejects the WRONG recipient's secret key (never silently returns a wrong key)", () => {
  const recipient = generateKeyPair();
  const stranger = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: recipient.publicKey });

  assert.throws(() => unwrapContentKeyHybrid({ envelope, recipientSecretKey: stranger.secretKey }), InayaDecryptionError);
});

test("unwrapContentKeyHybrid rejects a tampered AAD (the wrap was bound to a different object reference)", () => {
  const recipient = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const aad = new TextEncoder().encode("doc:real-target");
  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: recipient.publicKey, aad });

  const tampered = { ...envelope, aad: Buffer.from(new TextEncoder().encode("doc:different-target")).toString("base64") };
  assert.throws(() => unwrapContentKeyHybrid({ envelope: tampered, recipientSecretKey: recipient.secretKey }), InayaDecryptionError);
});

test("unwrapContentKeyHybrid rejects a tampered wrappedKey ciphertext (AES-GCM auth tag fails)", () => {
  const recipient = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: recipient.publicKey });

  const rawWrapped = Buffer.from(envelope.wrappedKey, "base64");
  rawWrapped[0] ^= 0xff;
  const tampered = { ...envelope, wrappedKey: rawWrapped.toString("base64") };
  assert.throws(() => unwrapContentKeyHybrid({ envelope: tampered, recipientSecretKey: recipient.secretKey }), InayaDecryptionError);
});

test("unwrapContentKeyHybrid rejects an unrecognized algorithm rather than guessing or downgrading", () => {
  const recipient = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: recipient.publicKey });

  assert.throws(() => unwrapContentKeyHybrid({ envelope: { ...envelope, algorithm: "LEGACY_CLASSICAL" }, recipientSecretKey: recipient.secretKey }), InayaValidationError);
});

test("unwrapContentKeyHybrid rejects an unrecognized envelope version rather than guessing", () => {
  const recipient = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: recipient.publicKey });

  assert.throws(() => unwrapContentKeyHybrid({ envelope: { ...envelope, version: 99 }, recipientSecretKey: recipient.secretKey }), InayaValidationError);
});

test("isHybridEnvelope is false for a missing/malformed/non-hybrid object, never throws", () => {
  assert.equal(isHybridEnvelope(null), false);
  assert.equal(isHybridEnvelope(undefined), false);
  assert.equal(isHybridEnvelope({}), false);
  assert.equal(isHybridEnvelope({ version: 1, algorithm: "LEGACY_CLASSICAL" }), false);
});

// ---- SDK surface (InayaKernel.Pqc) ----

test("Pqc namespace exposes the full documented surface and works end-to-end through it alone", () => {
  assert.deepEqual(Object.keys(Pqc).sort(), [
    "ALGORITHM_ID",
    "ENVELOPE_VERSION",
    "SHARING_MODE",
    "capabilityInfo",
    "generateDeviceKeyPair",
    "isHybridEnvelope",
    "unwrapContentKeyHybrid",
    "wrapContentKeyHybrid",
    "wrapForRecipient",
    "unwrapFromSender",
    "isAgileHybridEnvelope",
  ].sort());

  const device = Pqc.generateDeviceKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const envelope = Pqc.wrapContentKeyHybrid({ contentKey, recipientPublicKey: device.publicKey });
  const recovered = Pqc.unwrapContentKeyHybrid({ envelope, recipientSecretKey: device.secretKey });
  assert.deepEqual(Buffer.from(recovered), Buffer.from(contentKey));
});

// ---- Multi-device interop (SOW §4.23: "mobile/desktop interoperability") ----
// All platforms run the same pure-JS @noble/post-quantum build (no native/WASM backend per
// provider.js's design), so this is the real cross-platform contract: two independently-generated
// key pairs and two independent wrap/unwrap calls must interoperate byte-for-byte.

test("two independently-generated devices interoperate (simulates web device wrapping to a desktop device)", () => {
  const webDevice = generateKeyPair();
  const desktopDevice = generateKeyPair();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));

  // webDevice wraps a key FOR desktopDevice
  const envelope = wrapContentKeyHybrid({ contentKey, recipientPublicKey: desktopDevice.publicKey });
  // desktopDevice unwraps it with its own secret key
  const recovered = unwrapContentKeyHybrid({ envelope, recipientSecretKey: desktopDevice.secretKey });
  assert.deepEqual(Buffer.from(recovered), Buffer.from(contentKey));

  // webDevice's own secret key must NOT be able to unwrap it (it wrapped TO desktop, not itself)
  assert.throws(() => unwrapContentKeyHybrid({ envelope, recipientSecretKey: webDevice.secretKey }), InayaDecryptionError);
});
