// src/metadata.js
//
// Client for the off-chain mutable-metadata layer (Module 1: virtual
// folders, rename/move/delete, sharing). Same pattern as payments.js —
// a typed fetch() client with zero secrets and zero storage of its own;
// the actual database lives in routes you deploy yourself. See that
// file's module comment for the rationale behind this shape.
//
// WHY THIS EXISTS: InayaCustody.batchRegisterAssets() is a write-once
// operation. This was verified directly against the live deployed
// contract — six plausible mutation function names (deleteAsset,
// removeAsset, updateAsset, renameAsset, setAsset, unregisterAsset) all
// cleanly reverted with empty data (the "no such function selector, no
// fallback" signature), while the real assets(bytes32) call succeeded
// normally even for a nonexistent key. See SDK_GUIDE.md's known-
// limitations section for the full verification trail. There is no
// on-chain way to rename, move, or delete a registered asset — this
// module fills that gap with a server-backed layer keyed by the same
// immutable on-chain fileHash. The fileHash and the encrypted shards
// themselves are never mutated; only display name / folder placement /
// soft-delete state / share grants live here.
//
// SECURITY MODEL — read this before wiring up a backend for this module:
// every mutating call is authenticated with a wallet signature
// (personal_sign over a canonical message — see signMetadataAction()),
// never a bare address in the request body. Your backend route MUST,
// before applying any mutation:
//   1. Recover the signer from { message, signature } and confirm it
//      equals the claimed `address`.
//   2. Recompute the expected message server-side from the request's
//      other fields and confirm it matches exactly (stops a signature
//      for one action/fileHash being replayed against a different one).
//   3. Reject stale signatures (a `timestamp` embedded in the message —
//      5 minutes is a reasonable window).
//   4. For file actions specifically: read InayaCustody.assets(fileHash)
//      on-chain (InayaKernel works server-side too — pass a dual-mode
//      connection) and confirm `address` matches the real on-chain
//      `owner`. Folder/share actions have no on-chain anchor, so this
//      step instead means checking your own DB's recorded owner.
// Skipping any of these means anyone who learns a fileHash could
// rename/move/delete someone else's file metadata. See
// examples/nextjs-metadata-api-routes.js for a complete reference route
// implementing all four checks.

import { InayaValidationError, InayaNetworkError, InayaWalletError, translateError } from "./errors.js";

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
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new InayaNetworkError(data?.error || `Request to ${url} failed (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
    return data;
  } catch (err) {
    throw translateError(err);
  }
}

/** Duck-typed the same way index.js's resolveSigner is — kept as a small local copy rather than
 *  a shared export to avoid a circular import between index.js and this module. */
function isEthersSigner(raw) {
  return raw != null && typeof raw.getAddress === "function" && typeof raw.signMessage === "function";
}

async function resolveSigner(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("No provider/signer — call connectWallet() (browser) or pass an ethers.Wallet directly (Node.js) first.", { code: "NO_CONNECTION" });
  if (isEthersSigner(raw)) return raw;
  // Lazy require avoids making `ethers` a hard dependency of this file's module graph beyond what index.js already needs.
  const { ethers } = await import("ethers");
  return new ethers.BrowserProvider(raw).getSigner();
}

function buildMetadataMessage({ action, resourceId, extra }) {
  const timestamp = Date.now();
  const lines = ["Inaya Metadata Action", `action: ${action}`, `resourceId: ${resourceId}`];
  if (extra) for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${String(value)}`);
  lines.push(`timestamp: ${timestamp}`);
  return { message: lines.join("\n"), timestamp };
}

/** Signs a canonical message proving control of the connected wallet for one specific metadata
 *  action — the { address, message, signature } triple your backend route must verify (see the
 *  module comment above). Exported so you can pre-sign in advanced flows; every method below
 *  already calls this internally. */
async function signMetadataAction({ connection, action, resourceId, extra }) {
  try {
    const signer = await resolveSigner(connection);
    const address = await signer.getAddress();
    const { message, timestamp } = buildMetadataMessage({ action, resourceId, extra });
    const signature = await signer.signMessage(message);
    return { address, message, signature, timestamp };
  } catch (err) {
    throw translateError(err, "Metadata.signMetadataAction");
  }
}

// ------------------------------------------------------------------
// Files
// ------------------------------------------------------------------

/** Call this right after anchorToLedger() succeeds, to give the immutable on-chain fileHash a
 *  mutable display name and (optional) starting folder. Signed like every other mutating call
 *  here so your backend can verify `address` against the real on-chain owner before inserting. */
async function registerFileMetadata({ connection, fileHash, filename, folderId = null, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.registerFileMetadata: fileHash is required.");
  if (!filename) throw new InayaValidationError("Metadata.registerFileMetadata: filename is required.");
  const auth = await signMetadataAction({ connection, action: "registerFileMetadata", resourceId: fileHash, extra: { filename, folderId } });
  return postJSON(`${apiBaseUrl}/api/metadata/register-file`, { fileHash, filename, folderId, ...auth });
}

/** Renames a file's off-chain display name — the on-chain fileHash and shards are untouched. */
async function renameFile({ connection, fileHash, newName, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.renameFile: fileHash is required.");
  if (!newName) throw new InayaValidationError("Metadata.renameFile: newName is required.");
  const auth = await signMetadataAction({ connection, action: "renameFile", resourceId: fileHash, extra: { newName } });
  return postJSON(`${apiBaseUrl}/api/metadata/rename-file`, { fileHash, newName, ...auth });
}

/** Moves a file into a different virtual folder. Pass folderId: null to move it back to root. */
async function moveFile({ connection, fileHash, folderId = null, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.moveFile: fileHash is required.");
  const auth = await signMetadataAction({ connection, action: "moveFile", resourceId: fileHash, extra: { folderId } });
  return postJSON(`${apiBaseUrl}/api/metadata/move-file`, { fileHash, folderId, ...auth });
}

/** Soft-deletes a file's metadata (sets deletedAt) — hides it from listFiles() by default.
 *  The on-chain record is permanent by design; this never touches the chain or the shards
 *  themselves, and the file can still be retrieved directly via retrieveAndReconstruct() if
 *  someone already has the fileHash. Call restoreFile() to undo. */
async function deleteFile({ connection, fileHash, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.deleteFile: fileHash is required.");
  const auth = await signMetadataAction({ connection, action: "deleteFile", resourceId: fileHash });
  return postJSON(`${apiBaseUrl}/api/metadata/delete-file`, { fileHash, ...auth });
}

/** Undoes a prior deleteFile() — clears deletedAt. */
async function restoreFile({ connection, fileHash, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.restoreFile: fileHash is required.");
  const auth = await signMetadataAction({ connection, action: "restoreFile", resourceId: fileHash });
  return postJSON(`${apiBaseUrl}/api/metadata/restore-file`, { fileHash, ...auth });
}

/** Read-only — lists a wallet's file metadata, optionally scoped to one folder. Not signature-gated
 *  (same trust level as Payments.getPaygAssets); your backend can layer its own session/auth on top
 *  of the `owner` filter if you need stronger read privacy than "knows the address". */
async function listFiles({ owner, folderId, includeDeleted = false, apiBaseUrl = "" }) {
  if (!owner) throw new InayaValidationError("Metadata.listFiles: owner is required.");
  const qs = new URLSearchParams({ owner, includeDeleted: String(includeDeleted) });
  if (folderId !== undefined && folderId !== null) qs.set("folderId", folderId);
  return getJSON(`${apiBaseUrl}/api/metadata/list-files?${qs.toString()}`);
}

// ------------------------------------------------------------------
// Virtual folders — pure off-chain construct, no on-chain anchor at all,
// so ownership here is only ever whatever your backend recorded at
// createFolder() time (there's no assets(fileHash).owner equivalent to
// cross-check against).
// ------------------------------------------------------------------

async function createFolder({ connection, name, parentFolderId = null, apiBaseUrl = "" }) {
  if (!name) throw new InayaValidationError("Metadata.createFolder: name is required.");
  const auth = await signMetadataAction({ connection, action: "createFolder", resourceId: parentFolderId ?? "root", extra: { name } });
  return postJSON(`${apiBaseUrl}/api/metadata/create-folder`, { name, parentFolderId, ...auth });
}

async function renameFolder({ connection, folderId, newName, apiBaseUrl = "" }) {
  if (!folderId) throw new InayaValidationError("Metadata.renameFolder: folderId is required.");
  if (!newName) throw new InayaValidationError("Metadata.renameFolder: newName is required.");
  const auth = await signMetadataAction({ connection, action: "renameFolder", resourceId: folderId, extra: { newName } });
  return postJSON(`${apiBaseUrl}/api/metadata/rename-folder`, { folderId, newName, ...auth });
}

async function moveFolder({ connection, folderId, parentFolderId = null, apiBaseUrl = "" }) {
  if (!folderId) throw new InayaValidationError("Metadata.moveFolder: folderId is required.");
  const auth = await signMetadataAction({ connection, action: "moveFolder", resourceId: folderId, extra: { parentFolderId } });
  return postJSON(`${apiBaseUrl}/api/metadata/move-folder`, { folderId, parentFolderId, ...auth });
}

/** Soft-deletes a folder. Deliberately does NOT cascade-delete contained files — your backend
 *  route should orphan them back to root (folderId: null), never delete file metadata as a side
 *  effect of a folder action. Keeps the two resource types' delete semantics independent. */
async function deleteFolder({ connection, folderId, apiBaseUrl = "" }) {
  if (!folderId) throw new InayaValidationError("Metadata.deleteFolder: folderId is required.");
  const auth = await signMetadataAction({ connection, action: "deleteFolder", resourceId: folderId });
  return postJSON(`${apiBaseUrl}/api/metadata/delete-folder`, { folderId, ...auth });
}

/** Read-only — lists a wallet's virtual folders under one parent (null = root). */
async function listFolders({ owner, parentFolderId = null, apiBaseUrl = "" }) {
  if (!owner) throw new InayaValidationError("Metadata.listFolders: owner is required.");
  const qs = new URLSearchParams({ owner });
  if (parentFolderId !== null) qs.set("parentFolderId", parentFolderId);
  return getJSON(`${apiBaseUrl}/api/metadata/list-folders?${qs.toString()}`);
}

// ------------------------------------------------------------------
// Sharing — grants another wallet access to a file. This module only
// stores the grant record; the actual key exchange (re-wrapping the
// file's vaultKey so recipientAddress can decrypt it) is the caller's
// responsibility, using whatever key-encapsulation scheme your app
// chooses (e.g. the recipient's MetaMask encryption public key, or an
// out-of-band exchange) — deliberately not baked into this SDK's crypto
// module, which only knows about passkey-derived vault keys today.
// ------------------------------------------------------------------

/** wrappedVaultKey: an opaque string your app produced by re-encrypting the file's vault key for
 *  granteeAddress — this module stores and returns it verbatim, never inspects or decrypts it. */
async function shareFile({ connection, fileHash, granteeAddress, wrappedVaultKey, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.shareFile: fileHash is required.");
  if (!granteeAddress) throw new InayaValidationError("Metadata.shareFile: granteeAddress is required.");
  if (!wrappedVaultKey) throw new InayaValidationError("Metadata.shareFile: wrappedVaultKey is required.");
  const auth = await signMetadataAction({ connection, action: "shareFile", resourceId: fileHash, extra: { granteeAddress } });
  return postJSON(`${apiBaseUrl}/api/metadata/share-file`, { fileHash, granteeAddress, wrappedVaultKey, ...auth });
}

async function revokeShare({ connection, fileHash, granteeAddress, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.revokeShare: fileHash is required.");
  if (!granteeAddress) throw new InayaValidationError("Metadata.revokeShare: granteeAddress is required.");
  const auth = await signMetadataAction({ connection, action: "revokeShare", resourceId: fileHash, extra: { granteeAddress } });
  return postJSON(`${apiBaseUrl}/api/metadata/revoke-share`, { fileHash, granteeAddress, ...auth });
}

/** Read-only — lists files shared with `owner` by other wallets, including each grant's
 *  wrappedVaultKey so the caller can unwrap and decrypt locally. */
async function listSharedWithMe({ owner, apiBaseUrl = "" }) {
  if (!owner) throw new InayaValidationError("Metadata.listSharedWithMe: owner is required.");
  const qs = new URLSearchParams({ owner });
  return getJSON(`${apiBaseUrl}/api/metadata/list-shared-with-me?${qs.toString()}`);
}

export const Metadata = {
  signMetadataAction,
  registerFileMetadata,
  renameFile,
  moveFile,
  deleteFile,
  restoreFile,
  listFiles,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  listFolders,
  shareFile,
  revokeShare,
  listSharedWithMe,
};
