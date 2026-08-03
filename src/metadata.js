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
import { withRetry } from "./utils.js";
import { deriveEncryptionKeypairFromSignature, encryptForPublicKey, decryptWithSecretKey } from "./crypto.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// POSTs mutate (rename/move/delete/share) and are never auto-retried, same
// rationale as anchorToLedger()/approveFeeTokens() in index.js: a POST that
// "failed" client-side may have already applied server-side, so blindly
// resubmitting could double-apply a mutation. GETs are read-only and
// idempotent, so — like every other read in index.js — they retry
// automatically on transient network failures.

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
 *  here so your backend can verify `address` against the real on-chain owner before inserting.
 *
 *  fileSizeBytes is optional but strongly recommended: pass the same value you gave
 *  anchorToLedger(). The deployed InayaCustody contract's assets() getter doesn't expose the
 *  file size it was written with (see Analytics module comment in analytics.js for the full
 *  explanation), so this is the only place that number is ever recoverable from — Analytics'
 *  "total bytes stored" is honest about being sourced from here, not an on-chain-verified figure. */
async function registerFileMetadata({ connection, fileHash, filename, folderId = null, fileSizeBytes, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.registerFileMetadata: fileHash is required.");
  if (!filename) throw new InayaValidationError("Metadata.registerFileMetadata: filename is required.");
  const auth = await signMetadataAction({ connection, action: "registerFileMetadata", resourceId: fileHash, extra: { filename, folderId, fileSizeBytes } });
  return postJSON(`${apiBaseUrl}/api/metadata/register-file`, { fileHash, filename, folderId, fileSizeBytes, ...auth });
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
// Sharing — grants another wallet access to a file. Key re-wrapping is
// now built (Phase 3 Tier 1, 2026-08-03): shareFile() encrypts the
// owner's passkey specifically for the recipient's registered X25519
// public key, and getSharedFileKey() lets the recipient recover it.
//
// Why X25519 + a signature-derived keypair instead of MetaMask's
// eth_getEncryptionPublicKey/eth_decrypt: verified via web search before
// building this that those methods have been deprecated since 2022 (the
// underlying EIP-1024 was abandoned, MetaMask itself no longer
// recommends them), and found no evidence they're exposed over
// WalletConnect-style connections — which is exactly how this project's
// mobile app connects (MetaMask Connect Multichain), so relying on them
// would likely have made sharing silently unusable on mobile. Signing a
// fixed message via personal_sign works identically everywhere (browser
// extension, WalletConnect, mobile deep-link), so the recipient's
// encryption keypair is derived from that signature instead — see
// crypto.js's deriveEncryptionKeypairFromSignature() for the primitive.
//
// HONEST SCOPING NOTE: this only works for wallets that can produce a
// personal_sign signature, which is effectively universal — but a
// recipient must have called registerEncryptionKey() at least once
// before anyone can share a file with them (shareFile() will throw a
// clear InayaValidationError if the recipient hasn't registered yet,
// rather than failing silently or fabricating a key for them).
//
// REVOCATION IS NOT RETROACTIVE: revokeShare() deletes the grant record
// server-side, so a FUTURE getSharedFileKey() call will correctly fail
// for that recipient. It cannot un-decrypt something the recipient
// already fetched and decrypted before revocation — if they saved the
// recovered passkey locally, revocation has no effect on that copy.
// This is a fundamental property of any share-then-revoke scheme, not a
// bug in this implementation, and should be communicated to end users
// accordingly (e.g. "revoke" means "stop future access," not "delete
// their copy").
// ------------------------------------------------------------------

/** The exact message every wallet signs to derive its sharing keypair — must never change
 *  once any user has registered a key against it (a different message produces a completely
 *  different, non-interoperable keypair). Deliberately has no timestamp/nonce: determinism
 *  across sessions, not replay-resistance, is the entire point of this signature. */
function buildShareKeypairMessage(address) {
  return [
    "Inaya Network — Derive Sharing Keypair",
    "",
    "Signing this message deterministically derives an encryption keypair used only to receive files shared with you. It grants no on-chain permissions and never leaves your device unencrypted.",
    "",
    `Wallet: ${address}`,
  ].join("\n");
}

/** Signs the fixed keypair-derivation message and returns the resulting deterministic X25519
 *  keypair — the same wallet always reproduces the same keypair, so callers never need to
 *  store secretKey; just re-derive it whenever needed (mirrors deriveVaultKey()'s on-demand
 *  re-derivation from a passkey, rather than persisting a secret anywhere). */
async function deriveShareKeypair({ connection }) {
  try {
    const signer = await resolveSigner(connection);
    const address = await signer.getAddress();
    const signature = await signer.signMessage(buildShareKeypairMessage(address));
    return { address, ...deriveEncryptionKeypairFromSignature(signature) };
  } catch (err) {
    throw translateError(err, "Metadata.deriveShareKeypair");
  }
}

/** Registers this wallet's sharing public key so others can shareFile() with it — must be
 *  called at least once before this wallet can receive a share. Safe to call again later
 *  (e.g. after clearing local state); it always re-derives the same keypair and re-registers
 *  the same public key, so it's idempotent rather than rotating anything. */
async function registerEncryptionKey({ connection, apiBaseUrl = "" }) {
  const { address, publicKey } = await deriveShareKeypair({ connection });
  const publicKeyHex = bytesToHex(publicKey);
  const auth = await signMetadataAction({ connection, action: "registerEncryptionKey", resourceId: address, extra: { publicKey: publicKeyHex } });
  return postJSON(`${apiBaseUrl}/api/metadata/register-encryption-key`, { publicKey: publicKeyHex, ...auth });
}

/** Read-only — looks up a wallet's registered sharing public key (used internally by
 *  shareFile(); exposed directly for advanced/custom encryption flows). Returns
 *  { publicKey: null } rather than throwing if the address hasn't registered one yet. */
async function getEncryptionKey({ address, apiBaseUrl = "" }) {
  if (!address) throw new InayaValidationError("Metadata.getEncryptionKey: address is required.");
  const qs = new URLSearchParams({ address });
  return getJSON(`${apiBaseUrl}/api/metadata/get-encryption-key?${qs.toString()}`);
}

/** Shares a file: looks up granteeAddress's registered sharing public key, encrypts `passkey`
 *  specifically for it (crypto.js's encryptForPublicKey() — an ephemeral-sender X25519 sealed
 *  box, see the module comment above for why this replaces MetaMask's eth_decrypt), and stores
 *  the resulting opaque blob server-side. Throws InayaValidationError with a clear, actionable
 *  message if granteeAddress hasn't called registerEncryptionKey() yet — this SDK never
 *  fabricates or skips the recipient's key. */
async function shareFile({ connection, fileHash, granteeAddress, passkey, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.shareFile: fileHash is required.");
  if (!granteeAddress) throw new InayaValidationError("Metadata.shareFile: granteeAddress is required.");
  if (!passkey) throw new InayaValidationError("Metadata.shareFile: passkey is required.");

  const { publicKey: granteePublicKey } = await getEncryptionKey({ address: granteeAddress, apiBaseUrl });
  if (!granteePublicKey) {
    throw new InayaValidationError(
      `Metadata.shareFile: ${granteeAddress} has not registered a sharing key yet — ask them to call Metadata.registerEncryptionKey() first, then try again.`,
      { code: "GRANTEE_NOT_REGISTERED" }
    );
  }

  const wrappedVaultKey = encryptForPublicKey({ plaintext: passkey, recipientPublicKey: granteePublicKey });
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
 *  wrappedVaultKey so the caller can unwrap and decrypt locally (or just call
 *  getSharedFileKey() per-file instead, which does the unwrap for you). */
async function listSharedWithMe({ owner, apiBaseUrl = "" }) {
  if (!owner) throw new InayaValidationError("Metadata.listSharedWithMe: owner is required.");
  const qs = new URLSearchParams({ owner });
  return getJSON(`${apiBaseUrl}/api/metadata/list-shared-with-me?${qs.toString()}`);
}

/** The recipient-side half of the sharing flow: fetches the wrappedVaultKey for one specific
 *  share, re-derives this wallet's sharing keypair (same deterministic derivation as
 *  registerEncryptionKey() used), and decrypts to recover the original passkey — ready to pass
 *  straight into InayaKernel.reconstructAndDecrypt({shardAlpha, shardBeta, passkey}) alongside
 *  the shard data (fetched separately, e.g. via retrieveAndReconstruct()). Throws if the share
 *  doesn't exist (never granted, or already revoked) or if decryption fails for any reason. */
async function getSharedFileKey({ connection, fileHash, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("Metadata.getSharedFileKey: fileHash is required.");
  try {
    const { address, secretKey } = await deriveShareKeypair({ connection });
    const qs = new URLSearchParams({ fileHash, granteeAddress: address });
    const { wrappedVaultKey } = await getJSON(`${apiBaseUrl}/api/metadata/get-shared-file-key?${qs.toString()}`);
    if (!wrappedVaultKey) {
      throw new InayaValidationError(
        `Metadata.getSharedFileKey: no active share found for fileHash "${fileHash}" and this wallet — it may never have been shared with you, or the grant may have been revoked.`,
        { code: "SHARE_NOT_FOUND" }
      );
    }
    const passkey = decryptWithSecretKey({ wrapped: wrappedVaultKey, secretKey });
    return { passkey };
  } catch (err) {
    throw translateError(err, "Metadata.getSharedFileKey");
  }
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
  deriveShareKeypair,
  registerEncryptionKey,
  getEncryptionKey,
  shareFile,
  revokeShare,
  listSharedWithMe,
  getSharedFileKey,
};
