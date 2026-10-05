// packages/cli/test/org.test.mjs -- CLI-001: the organization commands, run through commander against a local stand-in for /api/public/v1 and the real SDK
// clients. Proves the API key comes from the environment (or a flag), the right requests are made, output is JSON, errors exit non-zero with a readable
// message, and that no wallet-key or file-content command exists in this group.
// Run with: node --test test/org.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Command } from "commander";
import { registerOrgCommands } from "../src/commands/org.js";
import * as sdk from "../../../src/competitive.js";

async function withServer(fn) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let d = ""; req.on("data", (c) => (d += c));
    req.on("end", () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: d ? JSON.parse(d) : null }); if (req.url.includes("/forbidden")) { res.writeHead(403, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "Feature off." })); } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, items: [] })); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, seen); } finally { srv.close(); }
}

async function run(args, env = {}) {
  const logs = []; const errs = []; const origLog = console.log; const origErr = console.error; const origExit = process.exit; const saved = { ...process.env };
  console.log = (...a) => logs.push(a.join(" ")); console.error = (...a) => errs.push(a.join(" ")); let code = 0; process.exit = (c) => { code = c ?? 0; throw new Error("__exit__"); };
  Object.assign(process.env, env); for (const k of ["INAYA_API_KEY", "INAYA_BASE_URL"]) if (!(k in env)) delete process.env[k];
  try {
    const program = new Command(); program.exitOverride(); registerOrgCommands(program, sdk);
    await program.parseAsync(["node", "inaya", ...args]);
  } catch (e) { if (e.message !== "__exit__") errs.push(e.message); } finally { console.log = origLog; console.error = origErr; process.exit = origExit; process.env = saved; }
  return { logs, errs, code };
}

test("commands read the API key and base URL from the environment and print JSON", async () => {
  await withServer(async (base, seen) => {
    const env = { INAYA_API_KEY: "inaya_cli1", INAYA_BASE_URL: base };
    let r = await run(["shares", "list", "--status", "active"], env); assert.equal(r.code, 0); assert.deepEqual(JSON.parse(r.logs.join("\n")), { ok: true, items: [] });
    await run(["shares", "create", "doc1", "--expires", "2030-01-01T00:00:00Z", "--max-downloads", "3"], env);
    await run(["shares", "revoke", "sh1"], env);
    await run(["file-requests", "list"], env); await run(["file-requests", "get", "r1"], env); await run(["file-requests", "revoke", "r1"], env);
    await run(["devices", "list"], env); await run(["devices", "action", "dev1", "block"], env);
    await run(["governance", "policies", "--type", "dlp"], env); await run(["governance", "dlp-events", "--decision", "DENY"], env); await run(["governance", "classification", "d1"], env);
    await run(["backup", "health"], env);
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["GET /api/public/v1/shares?status=active", "POST /api/public/v1/shares", "DELETE /api/public/v1/shares/sh1", "GET /api/public/v1/file-requests", "GET /api/public/v1/file-requests/r1", "DELETE /api/public/v1/file-requests/r1", "GET /api/public/v1/devices", "POST /api/public/v1/devices/dev1", "GET /api/public/v1/governance/policies?type=dlp", "GET /api/public/v1/governance/dlp-events?decision=DENY", "GET /api/public/v1/classification/d1", "GET /api/public/v1/endpoint-backup/health"]);
    assert.ok(seen.every((s) => s.auth === "Bearer inaya_cli1")); assert.deepEqual(seen[1].body, { documentId: "doc1", expiresAt: "2030-01-01T00:00:00Z", options: { maxDownloads: 3 } }); assert.deepEqual(seen[7].body, { action: "block" });
  });
});

test("a missing key or base URL stops before any request; a server error exits non-zero with its message; the key flag works", async () => {
  await withServer(async (base, seen) => {
    const none = await run(["shares", "list"], {}); assert.equal(none.code, 1); assert.match(none.errs.join(" "), /INAYA_API_KEY/); assert.equal(seen.length, 0);
    const bad = await run(["devices", "get", "forbidden"], { INAYA_API_KEY: "k", INAYA_BASE_URL: base }); assert.equal(bad.code, 1); assert.match(bad.errs.join(" "), /403.*Feature off/);
    const viaFlag = await run(["shares", "list", "--api-key", "inaya_flag", "--base-url", base], {}); assert.equal(viaFlag.code, 0); assert.equal(seen.at(-1).auth, "Bearer inaya_flag");
  });
});

test("there is no command that touches a wallet key, a passkey, chat, notes or file content in this group", () => {
  const program = new Command(); registerOrgCommands(program, sdk);
  const names = program.commands.map((c) => c.name()); assert.deepEqual(names.sort(), ["backup", "devices", "file-requests", "governance", "shares"]);
  const flat = program.commands.flatMap((c) => c.commands.map((s) => `${c.name()} ${s.name()}`)); assert.equal(flat.some((n) => /create/.test(n) && n.startsWith("file-requests")), false, "file requests are created in the app");
  assert.equal(flat.some((n) => /chat|note|contact|private|passkey|upload|download/.test(n)), false);
});
