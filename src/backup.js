// src/backup.js
//
// Client for the Backup & Recovery Mechanism (docs/backup-redundancy-architecture.md in the
// dApp repo) -- replica redundancy for the two existing shards (Alpha/Beta) across independent
// pinning providers, with automated health monitoring and integrity-verified recovery. Same
// typed-fetch-client-with-zero-secrets shape as metadata.js/payments.js.
//
// NOT TO BE CONFUSED WITH passkeyBackup.js: that module backs up the user's *passkey* (a small,
// local, self-service secret) with zero network calls, by design. This module backs up *file
// shard data* across storage providers -- an entirely different concern, entirely server-backed
// (there is no local-only equivalent, since the whole point is redundancy across infrastructure
// this SDK doesn't run). If you're looking for "how do I let a user recover their passkey if
// they lose it," see passkeyBackup.js instead; this file has nothing to do with that.
//
// SECURITY MODEL: reads (getBackupStatus/getBackupHealth/getRedundancyStatus/getRecoveryStatus)
// are unauthenticated, same trust level as Metadata.listFiles -- a fileHash alone reveals no
// plaintext. requestRecovery() is wallet-signature authenticated exactly like every mutating
// Metadata call (see metadata.js's module comment for the four checks your backend route MUST
// perform) -- api/backup/recover/route.js in the dApp repo is the reference implementation,
// reusing the same verifyMetadataAuth/verifyOnChainFileOwner helper every other file-keyed
// mutation already uses.

import { InayaValidationError, InayaNetworkError, InayaWalletError, translateError } from "./errors.js";
import { withRetry } from "./utils.js";

async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new InayaNetworkError(data?.error || `Request to ${url} failed (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
    return data;
  } catch (err) {
    throw translateError(err);
  }
}

async function getJSON(url) {
  try {
    return await withRetry(async () => {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new InayaNetworkError(data?.error || `Request to ${url} failed (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
      return data;
    });
  } catch (err) {
    throw translateError(err);
  }
}

/** Duck-typed the same way metadata.js's own local copy is -- kept independent to avoid a
 *  circular import between index.js and this module. */
function isEthersSigner(raw) {
  return raw != null && typeof raw.getAddress === "function" && typeof raw.signMessage === "function";
}

async function resolveSigner(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("No provider/signer — call connectWallet() (browser) or pass an ethers.Wallet directly (Node.js) first.", { code: "NO_CONNECTION" });
  if (isEthersSigner(raw)) return raw;
  const { ethers } = await import("ethers");
  return new ethers.BrowserProvider(raw).getSigner();
}

function buildBackupMessage({ action, resourceId }) {
  const timestamp = Date.now();
  return { message: ["Inaya Metadata Action", `action: ${action}`, `resourceId: ${resourceId}`, `timestamp: ${timestamp}`].join("\n"), timestamp };
}

/** Full replica-level detail: per-shard replica list (provider, cid, corrupted flag,
 *  consecutiveFailures), overall healthState, and when it last changed. */
async function getBackupStatus({ fileHash, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Backup.getBackupStatus: fileHash is required.");
  return getJSON(`${apiBaseUrl}/api/backup/status?${new URLSearchParams({ fileHash }).toString()}`);
}

/** Concise 5-state summary -- same underlying data as getBackupStatus, for callers that just
 *  want the health badge (e.g. a UI status pill) without the full replica list. */
async function getBackupHealth({ fileHash, apiBaseUrl = "" }) {
  const status = await getBackupStatus({ fileHash, apiBaseUrl });
  return { fileHash, healthState: status.healthState, lastStateChangeAt: status.lastStateChangeAt };
}

/** Healthy-replica-count vs. target, per shard -- same underlying data as getBackupStatus, for
 *  callers specifically interested in redundancy margin rather than the overall health state. */
async function getRedundancyStatus({ fileHash, apiBaseUrl = "" }) {
  const status = await getBackupStatus({ fileHash, apiBaseUrl });
  return {
    fileHash,
    targetReplicaCount: status.targetReplicaCount,
    shardAlpha: { replicaCount: status.shardAlpha.replicaCount, targetReplicaCount: status.shardAlpha.targetReplicaCount },
    shardBeta: { replicaCount: status.shardBeta.replicaCount, targetReplicaCount: status.shardBeta.targetReplicaCount },
  };
}

/** In-flight/last recovery job detail for one asset. */
async function getRecoveryStatus({ fileHash, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Backup.getRecoveryStatus: fileHash is required.");
  return getJSON(`${apiBaseUrl}/api/backup/recovery-status?${new URLSearchParams({ fileHash }).toString()}`);
}

/** Requests an immediate recovery attempt for one asset rather than waiting for the next
 *  automatic sweep. Wallet-signature authenticated; your backend cross-checks the signer against
 *  the real on-chain InayaCustody owner before doing anything (see this module's header comment). */
async function requestRecovery({ connection, fileHash, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Backup.requestRecovery: fileHash is required.");
  const signer = await resolveSigner(connection);
  const address = await signer.getAddress();
  const { message, timestamp } = buildBackupMessage({ action: "requestRecovery", resourceId: fileHash });
  const signature = await signer.signMessage(message);
  return postJSON(`${apiBaseUrl}/api/backup/recover`, { fileHash, address, message, signature, timestamp });
}

export const Backup = {
  getBackupStatus,
  getBackupHealth,
  getRedundancyStatus,
  getRecoveryStatus,
  requestRecovery,
};
