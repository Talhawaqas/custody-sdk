// src/trustPlatform.js
//
// Institutional Trust Infrastructure SOW, Phase 4 — a thin client for the
// new api/public/v1/** namespace (audit verification, evidence trails,
// permission checks). Deliberately stateless and per-call, matching this
// SDK's existing network-touching modules (Payments, Metadata) rather
// than introducing a stateful client class: every function takes
// {baseUrl, apiKey, ...} directly, no hidden config, no singleton.
//
// baseUrl is required rather than assumed (e.g. "https://app.inaya.network")
// so this works identically against a local dev server, staging, or
// production without any environment-detection guesswork.

import { InayaValidationError, InayaNetworkError, translateError } from "./errors.js";

async function callPublicV1({ baseUrl, apiKey, path }) {
  if (!baseUrl) throw new InayaValidationError("trustPlatform: baseUrl is required.");
  if (!apiKey) throw new InayaValidationError("trustPlatform: apiKey is required.");
  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (err) {
    throw translateError(err, "trustPlatform");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new InayaNetworkError(data.error || `Request failed (${res.status}).`, { status: res.status });
  return data;
}

export const TrustPlatform = {
  /** Verifies the calling org's own hash-linked evidence chain. Returns
   *  { valid, count } or { valid: false, count, brokenAtSeq, reason }. */
  async verifyAudit({ baseUrl, apiKey }) {
    return callPublicV1({ baseUrl, apiKey, path: "/api/public/v1/audit/verify" });
  },

  /** The chronological evidence trail for one record the caller already
   *  knows the id of. */
  async getEvidence({ baseUrl, apiKey, recordType, recordId }) {
    if (!recordType || !recordId) throw new InayaValidationError("trustPlatform.getEvidence: recordType and recordId are required.");
    return callPublicV1({ baseUrl, apiKey, path: `/api/public/v1/evidence?recordType=${encodeURIComponent(recordType)}&recordId=${encodeURIComponent(recordId)}` });
  },

  /** Checks whether a named capability gate is currently enabled for the
   *  calling org. See api/public/v1/permissions/check/route.js's own
   *  header comment for the honesty note on what this does and doesn't
   *  mean for an API-key caller. */
  async checkPermission({ baseUrl, apiKey, gate }) {
    if (!gate) throw new InayaValidationError("trustPlatform.checkPermission: gate is required.");
    return callPublicV1({ baseUrl, apiKey, path: `/api/public/v1/permissions/check?gate=${encodeURIComponent(gate)}` });
  },
};
