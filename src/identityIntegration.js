// src/identityIntegration.js
//
// Identity Integration SOW (Web2 identity, automation and MSP integration): a thin, stateless client for
//   /api/integrations/identity/*   (organization-scoped API, Bearer idc_... service credential)
//   /api/integrations/identity/webhooks/:provider   (signed inbound events)
// Same per-call {baseUrl, ...} style as TrustPlatform: no hidden config, no singleton. Nothing here talks to Entra, Active Directory or Rewst.
// It is what a Rewst workflow step, an RMM script or a small service uses to talk to Inaya.
//
// Signing scheme (must match the server): X-Inaya-Timestamp = unix seconds; X-Inaya-Signature = "v1=" + hex HMAC-SHA256(secret, timestamp + "." + rawBody).

import { InayaValidationError, InayaNetworkError, translateError } from "./errors.js";

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret, data) {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

const base = (baseUrl) => { if (!baseUrl) throw new InayaValidationError("identityIntegration: baseUrl is required."); return baseUrl.replace(/\/$/, ""); };
const httpError = (data, res) => Object.assign(new InayaNetworkError(data.error || `Request failed (${res.status}).`, { operation: "identityIntegration" }), { status: res.status, reasonCode: data.reasonCode });
const need = (v, name) => { if (!v) throw new InayaValidationError(`identityIntegration: ${name} is required.`); };
const e1 = encodeURIComponent;

async function call({ baseUrl, credential, organizationId, method = "GET", path, body, idempotencyKey }) {
  const root = base(baseUrl);
  need(credential, "credential (an idc_... token)");
  const headers = { Authorization: `Bearer ${credential}` };
  if (organizationId) headers["X-Inaya-Organization"] = organizationId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try { res = await fetch(`${root}/api/integrations/identity/${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
  catch (err) { throw translateError(err, "identityIntegration"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(data, res);
  return data;
}

export const IdentityIntegration = {
  /** Headers that sign `rawBody` for the webhook endpoint. `timestamp` is unix seconds (defaults to now). */
  async signWebhook({ secret, rawBody, timestamp }) {
    need(secret, "secret"); need(typeof rawBody === "string" ? rawBody : null, "rawBody (string)");
    const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
    return { "X-Inaya-Timestamp": ts, "X-Inaya-Signature": `v1=${await hmacHex(secret, `${ts}.${rawBody}`)}`, "Content-Type": "application/json" };
  },

  /** Sends one signed lifecycle event (canonical shape, or a source-specific payload the provider's adapter understands). */
  async sendEvent({ baseUrl, providerId, secret, event }) {
    const root = base(baseUrl);
    need(providerId, "providerId"); need(secret, "secret"); need(event, "event");
    const rawBody = JSON.stringify(event);
    const headers = await IdentityIntegration.signWebhook({ secret, rawBody });
    let res;
    try { res = await fetch(`${root}/api/integrations/identity/webhooks/${e1(providerId)}`, { method: "POST", headers, body: rawBody }); }
    catch (err) { throw translateError(err, "identityIntegration"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(data, res);
    return data; // { status: PROCESSED | DUPLICATE | STALE | PENDING | UNRESOLVED, runId?, ... }
  },

  // ---- actions (organization-scoped; the credential decides which are allowed) -------------------------------------------------
  getUser: async (o) => { need(o.user, "user"); return call({ ...o, path: `users/${e1(o.user)}` }); },
  getAccessibleScope: async (o) => { need(o.user, "user"); return call({ ...o, path: `users/${e1(o.user)}/access` }); },
  provisionUser: async (o) => { need(o.providerId, "providerId"); need(o.event, "event"); return call({ ...o, method: "POST", path: "users/provision", body: { providerId: o.providerId, dryRun: o.dryRun === true, event: o.event } }); },
  disableUser: async (o) => { need(o.user, "user"); need(o.reason, "reason"); return call({ ...o, method: "POST", path: `users/${e1(o.user)}/revoke`, body: { reason: o.reason, mode: o.mode || "full" } }); },
  revokeUserAccess: async (o) => IdentityIntegration.disableUser(o),
  restoreUser: async (o) => { need(o.user, "user"); return call({ ...o, method: "POST", path: `users/${e1(o.user)}/restore`, body: { reason: o.reason } }); },
  assignDepartment: async (o) => { need(o.user, "user"); need(o.departmentId, "departmentId"); need(o.reason, "reason"); return call({ ...o, method: "POST", path: `users/${e1(o.user)}/departments`, body: { departmentId: o.departmentId, reason: o.reason, expiresAt: o.expiresAt ?? null } }); },
  removeDepartment: async (o) => { need(o.user, "user"); need(o.departmentId, "departmentId"); need(o.reason, "reason"); return call({ ...o, method: "DELETE", path: `users/${e1(o.user)}/departments`, body: { departmentId: o.departmentId, reason: o.reason } }); },
  assignProject: async (o) => { need(o.user, "user"); need(o.projectId, "projectId"); need(o.reason, "reason"); return call({ ...o, method: "POST", path: `users/${e1(o.user)}/projects`, body: { projectId: o.projectId, reason: o.reason, expiresAt: o.expiresAt ?? null } }); },
  removeProject: async (o) => { need(o.user, "user"); need(o.projectId, "projectId"); need(o.reason, "reason"); return call({ ...o, method: "DELETE", path: `users/${e1(o.user)}/projects`, body: { projectId: o.projectId, reason: o.reason } }); },
  assignRole: async (o) => { need(o.user, "user"); need(o.role, "role"); need(o.reason, "reason"); return call({ ...o, method: "POST", path: `users/${e1(o.user)}/roles`, body: { role: o.role, kind: o.kind, reason: o.reason, expiresAt: o.expiresAt ?? null } }); },
  removeRole: async (o) => { need(o.user, "user"); need(o.role, "role"); need(o.reason, "reason"); return call({ ...o, method: "DELETE", path: `users/${e1(o.user)}/roles`, body: { role: o.role, kind: o.kind, reason: o.reason } }); },
  reconcileUser: async (o) => { need(o.user, "user"); need(o.providerId, "providerId"); need(o.subject, "subject"); return call({ ...o, method: "POST", path: `users/${e1(o.user)}/reconcile`, body: { providerId: o.providerId, subject: o.subject } }); },
  reconcileOrganization: async (o) => { need(o.providerId, "providerId"); need(o.snapshotId, "snapshotId"); need(Array.isArray(o.users) ? o.users : null, "users"); return call({ ...o, method: "POST", path: "reconcile", body: { providerId: o.providerId, snapshotId: o.snapshotId, users: o.users, last: o.last === true } }); },
  dryRun: async (o) => { need(o.providerId, "providerId"); need(o.event, "event"); return call({ ...o, method: "POST", path: "dry-run", body: { providerId: o.providerId, event: o.event } }); }, // { text, plan, liveMutation: false }
  getOrganization: async (o) => call({ ...o, path: "organization" }),
  getMembership: async (o) => IdentityIntegration.getUser(o),
  getSyncStatus: async (o) => call({ ...o, path: "status" }),
  getAuditEvidence: async (o) => { need(o.runId, "runId"); return call({ ...o, path: `evidence?runId=${e1(o.runId)}` }); },
  getAudit: async (o) => call({ ...o, path: `audit${o.email ? `?email=${e1(o.email)}` : ""}` }),
};
