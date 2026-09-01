// test/backup.test.mjs
//
// Backup & Recovery Mechanism (docs/backup-redundancy-architecture.md in the dApp repo) coverage
// for backup.js's request-building/response-shaping and requestRecovery()'s signed-message
// construction. Stubs global fetch (this module's own network boundary, not logic under test) --
// same rationale metadata.js's module comment gives for signMetadataAction's canonical-message
// format: what's actually being verified here is THIS module's own request shape, matching what
// a real backend route (api/backup/*/route.js in the dApp repo) expects.
//
// Run with: node --test test/backup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { Backup } from "../src/backup.js";
import { InayaValidationError, InayaNetworkError } from "../src/errors.js";

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => handler(url, options);
  return () => { globalThis.fetch = original; };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeSigner({ address = "0xAbC0000000000000000000000000000000dEaD", signMessage } = {}) {
  return {
    getAddress: async () => address,
    signMessage: signMessage || (async (msg) => `0xsig(${msg.length})`),
  };
}

test("getBackupStatus: rejects a missing fileHash before ever touching the network", async () => {
  await assert.rejects(() => Backup.getBackupStatus({ fileHash: "" }), InayaValidationError);
});

test("getBackupStatus: GETs /api/backup/status with fileHash as a query param, returns the parsed body", async () => {
  let capturedUrl;
  const restore = stubFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { fileHash: "0xabc", healthState: "Protected", targetReplicaCount: 2, shardAlpha: {}, shardBeta: {} });
  });
  try {
    const result = await Backup.getBackupStatus({ fileHash: "0xabc", apiBaseUrl: "https://example.test" });
    assert.equal(capturedUrl, "https://example.test/api/backup/status?fileHash=0xabc");
    assert.equal(result.healthState, "Protected");
  } finally {
    restore();
  }
});

test("getBackupStatus: a non-ok response is translated into an InayaNetworkError carrying the server's error message", async () => {
  const restore = stubFetch(async () => jsonResponse(500, { error: "database unavailable" }));
  try {
    await assert.rejects(() => Backup.getBackupStatus({ fileHash: "0xabc" }), (err) => {
      assert.ok(err instanceof InayaNetworkError);
      assert.match(err.message, /database unavailable/);
      return true;
    });
  } finally {
    restore();
  }
});

test("getBackupHealth: derives its concise shape from the same status endpoint as getBackupStatus", async () => {
  const restore = stubFetch(async () =>
    jsonResponse(200, {
      fileHash: "0xabc", healthState: "Degraded", lastStateChangeAt: "2026-09-01T00:00:00.000Z",
      targetReplicaCount: 2, shardAlpha: { replicaCount: 1, targetReplicaCount: 2, replicas: [] }, shardBeta: { replicaCount: 2, targetReplicaCount: 2, replicas: [] },
    })
  );
  try {
    const health = await Backup.getBackupHealth({ fileHash: "0xabc" });
    assert.deepEqual(health, { fileHash: "0xabc", healthState: "Degraded", lastStateChangeAt: "2026-09-01T00:00:00.000Z" });
  } finally {
    restore();
  }
});

test("getRedundancyStatus: extracts per-shard replica counts vs. target from the status endpoint", async () => {
  const restore = stubFetch(async () =>
    jsonResponse(200, {
      fileHash: "0xabc", healthState: "Protected", lastStateChangeAt: null, targetReplicaCount: 2,
      shardAlpha: { replicaCount: 2, targetReplicaCount: 2, replicas: [] },
      shardBeta: { replicaCount: 1, targetReplicaCount: 2, replicas: [] },
    })
  );
  try {
    const redundancy = await Backup.getRedundancyStatus({ fileHash: "0xabc" });
    assert.equal(redundancy.shardAlpha.replicaCount, 2);
    assert.equal(redundancy.shardBeta.replicaCount, 1);
  } finally {
    restore();
  }
});

test("getRecoveryStatus: GETs /api/backup/recovery-status with fileHash as a query param", async () => {
  let capturedUrl;
  const restore = stubFetch(async (url) => {
    capturedUrl = url;
    return jsonResponse(200, { fileHash: "0xabc", healthState: "RecoveryRequired", rebuildInFlight: { alpha: false, beta: true }, lastStateChangeAt: null });
  });
  try {
    const result = await Backup.getRecoveryStatus({ fileHash: "0xabc", apiBaseUrl: "https://example.test" });
    assert.equal(capturedUrl, "https://example.test/api/backup/recovery-status?fileHash=0xabc");
    assert.equal(result.healthState, "RecoveryRequired");
  } finally {
    restore();
  }
});

test("requestRecovery: rejects a missing fileHash before ever touching the signer or the network", async () => {
  await assert.rejects(() => Backup.requestRecovery({ connection: fakeSigner(), fileHash: "" }), InayaValidationError);
});

test("requestRecovery: signs a canonical 'Inaya Metadata Action' message over fileHash and POSTs the { address, message, signature, timestamp } auth tuple", async () => {
  let capturedUrl, capturedBody;
  const restore = stubFetch(async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return jsonResponse(200, { fileHash: "0xabc", healthState: "Rebuilding", rebuildInFlight: { alpha: true, beta: false }, lastStateChangeAt: null });
  });
  try {
    const signer = fakeSigner({ address: "0x1111111111111111111111111111111111111a" });
    const result = await Backup.requestRecovery({ connection: signer, fileHash: "0xabc", apiBaseUrl: "https://example.test" });

    assert.equal(capturedUrl, "https://example.test/api/backup/recover");
    assert.equal(capturedBody.fileHash, "0xabc");
    assert.equal(capturedBody.address, "0x1111111111111111111111111111111111111a");
    assert.ok(capturedBody.message.startsWith("Inaya Metadata Action"));
    assert.match(capturedBody.message, /action: requestRecovery/);
    assert.match(capturedBody.message, /resourceId: 0xabc/);
    assert.ok(capturedBody.signature);
    assert.equal(typeof capturedBody.timestamp, "number");
    assert.equal(result.healthState, "Rebuilding");
  } finally {
    restore();
  }
});

test("requestRecovery: a backend rejection (e.g. signer is not the on-chain owner) surfaces as a real error, not a silently-swallowed failure", async () => {
  const restore = stubFetch(async () => jsonResponse(403, { error: "Signer is not the on-chain owner of this file." }));
  try {
    await assert.rejects(
      () => Backup.requestRecovery({ connection: fakeSigner(), fileHash: "0xabc" }),
      (err) => {
        assert.match(err.message, /not the on-chain owner/);
        return true;
      }
    );
  } finally {
    restore();
  }
});
