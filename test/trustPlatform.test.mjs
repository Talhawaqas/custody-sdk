// test/trustPlatform.test.mjs
//
// Institutional Trust Infrastructure SOW, Phase 4 — validation coverage
// for the trustPlatform SDK client. No live server needed: these assert
// the client refuses to even attempt a call when required parameters are
// missing, matching every other module in this SDK's InayaValidationError
// convention.
//
// Run with: node --test test/trustPlatform.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { TrustPlatform } from "../src/trustPlatform.js";
import { InayaValidationError } from "../src/errors.js";

test("verifyAudit: requires baseUrl and apiKey", async () => {
  await assert.rejects(() => TrustPlatform.verifyAudit({ apiKey: "x" }), InayaValidationError);
  await assert.rejects(() => TrustPlatform.verifyAudit({ baseUrl: "http://x" }), InayaValidationError);
});

test("getEvidence: requires recordType and recordId in addition to baseUrl/apiKey", async () => {
  await assert.rejects(() => TrustPlatform.getEvidence({ baseUrl: "http://x", apiKey: "x" }), InayaValidationError);
  await assert.rejects(() => TrustPlatform.getEvidence({ baseUrl: "http://x", apiKey: "x", recordType: "TASK" }), InayaValidationError);
});

test("checkPermission: requires gate", async () => {
  await assert.rejects(() => TrustPlatform.checkPermission({ baseUrl: "http://x", apiKey: "x" }), InayaValidationError);
});
