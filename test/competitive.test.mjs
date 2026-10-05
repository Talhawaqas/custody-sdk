// test/competitive.test.mjs -- Competitive Expansion SDK-001: the public API clients (validation, auth header, URL shape, error mapping) against a local stand-in
// server, and receiver-side webhook verification checked against an independent node:crypto HMAC (what the server uses).
// Run with: node --test test/competitive.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { Shares, FileRequests, Governance, Devices, Compliance, Webhooks } from "../src/competitive.js";
import { InayaValidationError, InayaNetworkError } from "../src/errors.js";

test("calls refuse to run without the required parameters", async () => {
  await assert.rejects(() => Shares.list({ baseUrl: "http://x" }), InayaValidationError, "apiKey is mandatory");
  await assert.rejects(() => Shares.list({ apiKey: "inaya_x" }), InayaValidationError, "baseUrl is mandatory");
  assert.throws(() => Shares.createLink({ baseUrl: "http://x", apiKey: "k", documentId: "d" }), InayaValidationError, "expiresAt is mandatory");
  assert.throws(() => Shares.revoke({ baseUrl: "http://x", apiKey: "k" }), InayaValidationError);
  assert.throws(() => Devices.action({ baseUrl: "http://x", apiKey: "k", deviceId: "d" }), InayaValidationError, "action is mandatory");
  assert.throws(() => Governance.classificationHistory({ baseUrl: "http://x", apiKey: "k" }), InayaValidationError);
  assert.throws(() => FileRequests.get({ baseUrl: "http://x", apiKey: "k" }), InayaValidationError);
  assert.equal(FileRequests.create, undefined, "a file request cannot be created over the API (its key pair belongs in a browser)");
});

test("round trips: Bearer key, URL, query string, JSON body and error mapping", async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: d ? JSON.parse(d) : null }); if (req.url.includes("boom")) { res.writeHead(403, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Feature off.", code: "FEATURE_OFF" })); } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const baseUrl = `http://127.0.0.1:${srv.address().port}/`; const o = { baseUrl, apiKey: "inaya_k1" };
  try {
    await Shares.list({ ...o, status: "active", limit: 5 });
    await Shares.createLink({ ...o, documentId: "d1", expiresAt: "2030-01-01T00:00:00Z", options: { permission: "view" } });
    await Shares.createMember({ ...o, documentId: "d1", memberEmail: "a@b.c", permission: "view" });
    await Shares.revoke({ ...o, shareId: "s 1" });
    await FileRequests.list(o); await FileRequests.revoke({ ...o, requestId: "r1" });
    await Governance.listPolicies({ ...o, type: "dlp" }); await Governance.listDlpEvents({ ...o, decision: "DENY" }); await Governance.classify({ ...o, documentId: "d1" }); await Governance.classify({ ...o, documentId: "d1", dryRun: false });
    await Devices.list(o); await Devices.action({ ...o, deviceId: "dev1", action: "block" }); await Compliance.evidence({ ...o, recordType: "SHARE", recordId: "x" });
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), [
      "GET /api/public/v1/shares?status=active&limit=5", "POST /api/public/v1/shares", "POST /api/public/v1/shares", "DELETE /api/public/v1/shares/s%201",
      "GET /api/public/v1/file-requests", "DELETE /api/public/v1/file-requests/r1", "GET /api/public/v1/governance/policies?type=dlp", "GET /api/public/v1/governance/dlp-events?decision=DENY",
      "POST /api/public/v1/classification/d1", "POST /api/public/v1/classification/d1", "GET /api/public/v1/devices", "POST /api/public/v1/devices/dev1", "GET /api/public/v1/evidence?recordType=SHARE&recordId=x"]);
    assert.ok(seen.every((s) => s.auth === "Bearer inaya_k1")); assert.deepEqual(seen[8].body, { dryRun: true }, "classify defaults to a dry run"); assert.deepEqual(seen[9].body, { dryRun: false });
    assert.deepEqual(seen[2].body, { documentId: "d1", memberEmail: "a@b.c", permission: "view" });
    const e = await Devices.get({ ...o, deviceId: "boom" }).catch((x) => x); assert.ok(e instanceof InayaNetworkError); assert.equal(e.status, 403); assert.equal(e.code, "FEATURE_OFF"); assert.equal(e.message, "Feature off.");
  } finally { srv.close(); }
});

test("Webhooks.verify: accepts the server's signature (including either value during a rotation), rejects tampering, wrong secret, replays and malformed headers", async () => {
  const body = JSON.stringify({ type: "file.uploaded", data: { path: "a.txt" } }); const ts = 1790000000; const sig = (s) => createHmac("sha256", s).update(`${ts}.${body}`).digest("hex");
  const now = ts * 1000 + 10_000; const v = (o) => Webhooks.verify({ secret: "whsec_new", rawBody: body, signatureHeader: `t=${ts},v1=${sig("whsec_new")}`, now, ...o });
  assert.equal(await v({}), true);
  assert.equal(await v({ signatureHeader: `t=${ts},v1=${sig("whsec_old")},v1=${sig("whsec_new")}` }), true, "rotation: any v1 may match");
  assert.equal(await v({ rawBody: body + " " }), false, "tampered body");
  assert.equal(await v({ secret: "whsec_other" }), false, "wrong secret");
  assert.equal(await v({ now: now + 400_000 }), false, "older than five minutes");
  assert.equal(await v({ now: now + 400_000, toleranceSeconds: 900 }), true, "tolerance is adjustable");
  for (const h of ["", "garbage", `t=abc,v1=${sig("whsec_new")}`, `v1=${sig("whsec_new")}`, `t=${ts}`, `t=${ts},v1=short`]) assert.equal(await v({ signatureHeader: h }), false, JSON.stringify(h));
  await assert.rejects(() => Webhooks.verify({ rawBody: body, signatureHeader: "" }), InayaValidationError);
});
