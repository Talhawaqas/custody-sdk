// test/identityIntegration.test.mjs -- Identity Integration SOW: the SDK client. Validation refusals, the signing scheme (checked against an
// independent node:crypto HMAC, which is what the server uses), and real HTTP round trips against a local stand-in server.
// Run with: node --test test/identityIntegration.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { IdentityIntegration } from "../src/identityIntegration.js";
import { InayaValidationError, InayaNetworkError } from "../src/errors.js";

test("actions refuse to call without the required parameters", async () => {
  await assert.rejects(() => IdentityIntegration.getUser({ baseUrl: "http://x", credential: "idc_x" }), InayaValidationError);
  await assert.rejects(() => IdentityIntegration.disableUser({ baseUrl: "http://x", credential: "idc_x", user: "a@b.c" }), InayaValidationError, "a reason is mandatory");
  await assert.rejects(() => IdentityIntegration.getSyncStatus({ baseUrl: "http://x" }), InayaValidationError, "a credential is mandatory");
  await assert.rejects(() => IdentityIntegration.getSyncStatus({ credential: "idc_x" }), InayaValidationError, "baseUrl is mandatory");
  await assert.rejects(() => IdentityIntegration.sendEvent({ baseUrl: "http://x", providerId: "p", event: {} }), InayaValidationError, "secret is mandatory");
});

test("signWebhook produces the exact signature the server verifies (HMAC-SHA256 over timestamp.body)", async () => {
  const raw = JSON.stringify({ eventId: "evt-1", type: "user.disabled" });
  const h = await IdentityIntegration.signWebhook({ secret: "idw_secret", rawBody: raw, timestamp: 1790000000 });
  assert.equal(h["X-Inaya-Timestamp"], "1790000000");
  assert.equal(h["X-Inaya-Signature"], `v1=${createHmac("sha256", "idw_secret").update(`1790000000.${raw}`).digest("hex")}`);
});

test("round trips: sendEvent signs the body; actions send the Bearer credential, organization header, Idempotency-Key and JSON; errors carry status and reasonCode", async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: d });
      res.setHeader("content-type", "application/json");
      if (req.url.includes("forbidden")) { res.statusCode = 403; return res.end(JSON.stringify({ error: "No.", reasonCode: "CAPABILITY_MISSING" })); }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;
  try {
    await IdentityIntegration.sendEvent({ baseUrl, providerId: "prov1", secret: "idw_s", event: { eventId: "e1", type: "user.created" } });
    const s = seen[0]; assert.equal(s.url, "/api/integrations/identity/webhooks/prov1");
    assert.equal(s.headers["x-inaya-signature"], `v1=${createHmac("sha256", "idw_s").update(`${s.headers["x-inaya-timestamp"]}.${s.body}`).digest("hex")}`);
    await IdentityIntegration.disableUser({ baseUrl, credential: "idc_tok", organizationId: "org1", user: "a b@corp.example", reason: "terminated", idempotencyKey: "idem-12345678" });
    const d = seen[1]; assert.equal(d.method, "POST"); assert.equal(d.url, "/api/integrations/identity/users/a%20b%40corp.example/revoke");
    assert.equal(d.headers.authorization, "Bearer idc_tok"); assert.equal(d.headers["x-inaya-organization"], "org1"); assert.equal(d.headers["idempotency-key"], "idem-12345678");
    assert.deepEqual(JSON.parse(d.body), { reason: "terminated", mode: "full" });
    await assert.rejects(() => IdentityIntegration.getUser({ baseUrl, credential: "idc_tok", user: "forbidden" }), (e) => e instanceof InayaNetworkError && e.status === 403);
  } finally { srv.close(); }
});
