// packages/cli/src/commands/org.js
//
// Competitive Expansion SOW (CLI-001): organization administration from a terminal or CI job, over the public API (/api/public/v1) with an API key.
//   inaya shares list|create|revoke        inaya file-requests list|get|revoke      inaya devices list|get|action
//   inaya governance policies|dlp-events|classification      inaya backup health
// Authentication is an API key ONLY (INAYA_API_KEY or --api-key) plus INAYA_BASE_URL (or --base-url). Nothing here reads or prints a wallet private key, a
// passkey, a share's content key or a file request's private key, and no file content passes through the CLI. Chat, Contacts and Notes are end-to-end encrypted
// in a person's browser, so they have no CLI command (an API key could not read them without breaking that promise). File requests are created in the app.

import { backupHealth } from "./orgBackup.js";

const out = (v) => console.log(JSON.stringify(v, null, 2));

/** `sdk` is the namespace bag ({ Shares, FileRequests, Governance, Devices }); injected so it can be tested against a stand-in server. */
export function registerOrgCommands(program, sdk) {
  const auth = (o) => {
    const apiKey = o.apiKey || process.env.INAYA_API_KEY; const baseUrl = o.baseUrl || process.env.INAYA_BASE_URL;
    if (!apiKey || !baseUrl) { console.error("An API key and base URL are required: set INAYA_API_KEY and INAYA_BASE_URL, or pass --api-key and --base-url."); process.exit(1); }
    return { apiKey, baseUrl };
  };
  const run = (fn) => async (...args) => { try { out(await fn(...args)); } catch (e) { console.error(`Error${e.status ? ` ${e.status}` : ""}: ${e.message}`); process.exit(1); } };
  const common = (c) => c.option("--base-url <url>", "Inaya base URL (or INAYA_BASE_URL)").option("--api-key <key>", "API key (or INAYA_API_KEY; prefer the environment variable so it stays out of shell history)");

  const shares = program.command("shares").description("Secure shares (needs the Advanced Sharing feature enabled for the organization).");
  common(shares.command("list").description("List every share.").option("--status <s>", "active | expired | revoked | exhausted").option("--document <id>")).action(run((o) => sdk.Shares.list({ ...auth(o), status: o.status, documentId: o.document })));
  common(shares.command("create <documentId>").description("Create a link share; the link token is printed once.").requiredOption("--expires <iso>", "Expiry, ISO date-time").option("--password <p>", "Password the recipient needs (prefer INAYA_SHARE_PASSWORD)").option("--max-downloads <n>", "Download limit").option("--permission <p>", "view | download"))
    .action(run((id, o) => sdk.Shares.createLink({ ...auth(o), documentId: id, expiresAt: o.expires, options: { ...(o.password || process.env.INAYA_SHARE_PASSWORD ? { password: o.password || process.env.INAYA_SHARE_PASSWORD } : {}), ...(o.maxDownloads ? { maxDownloads: Number(o.maxDownloads) } : {}), ...(o.permission ? { permission: o.permission } : {}) } })));
  common(shares.command("revoke <shareId>").description("Revoke a share.")).action(run((id, o) => sdk.Shares.revoke({ ...auth(o), shareId: id })));

  const fr = program.command("file-requests").description("File requests (create them in the app: their key pair is generated in a browser).");
  common(fr.command("list").option("--status <s>")).action(run((o) => sdk.FileRequests.list({ ...auth(o), status: o.status })));
  common(fr.command("get <requestId>")).action(run((id, o) => sdk.FileRequests.get({ ...auth(o), requestId: id })));
  common(fr.command("revoke <requestId>")).action(run((id, o) => sdk.FileRequests.revoke({ ...auth(o), requestId: id })));

  const dev = program.command("devices").description("Device inventory and control (needs the Device Control feature).");
  common(dev.command("list")).action(run((o) => sdk.Devices.list(auth(o))));
  common(dev.command("get <deviceId>")).action(run((id, o) => sdk.Devices.get({ ...auth(o), deviceId: id })));
  common(dev.command("action <deviceId> <action>").description("trust | untrust | block | unblock | revoke | signout | reauth | wipe_cache | disable_sync | enable_sync")).action(run((id, a, o) => sdk.Devices.action({ ...auth(o), deviceId: id, action: a })));

  const gov = program.command("governance").description("Governance, DLP and classification (read-only here; changes stay in the app, behind approvals).");
  common(gov.command("policies").option("--type <t>").option("--status <s>")).action(run((o) => sdk.Governance.listPolicies({ ...auth(o), type: o.type, status: o.status })));
  common(gov.command("dlp-events").option("--decision <d>").option("--limit <n>")).action(run((o) => sdk.Governance.listDlpEvents({ ...auth(o), decision: o.decision, limit: o.limit })));
  common(gov.command("classification <documentId>").description("Classification history for one document.")).action(run((id, o) => sdk.Governance.classificationHistory({ ...auth(o), documentId: id })));

  const bk = program.command("backup").description("Endpoint backup (needs the Endpoint Backup feature).");
  common(bk.command("health")).action(run((o) => backupHealth(auth(o))));
}
