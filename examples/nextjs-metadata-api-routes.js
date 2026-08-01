// examples/nextjs-metadata-api-routes.js
//
// Reference backend for src/metadata.js (Module 1: virtual folders,
// rename/move/delete, sharing). Shows the schema this module assumes,
// and — most importantly — the full four-step verification every
// mutating route MUST perform before touching the database. Skipping
// any one of these means anyone who learns a fileHash could rename,
// move, or delete someone else's file metadata.
//
// Requires: npm install @inaya-network/custody-sdk ethers
// Env var required: BSC_TESTNET_RPC_URL (or reuse the SDK's default)
//
// ------------------------------------------------------------------
// Schema (illustrative — adapt to your own DB/ORM):
//
//   FileMetadata { fileHash (PK), owner, filename, folderId (nullable),
//                  createdAt, updatedAt, deletedAt (nullable) }
//   Folder       { folderId (PK), owner, name, parentFolderId (nullable),
//                  createdAt, updatedAt, deletedAt (nullable) }
//   ShareGrant   { id (PK), fileHash, granterAddress, granteeAddress,
//                  wrappedVaultKey, createdAt, revokedAt (nullable) }
// ------------------------------------------------------------------

import { ethers } from "ethers";
import { INAYA_CUSTODY_ABI, INAYA_ADDRESSES } from "@inaya-network/custody-sdk/src/contracts.js";
import { NextResponse } from "next/server";
// import { db } from "../lib/db"; // your own DB client — not part of this SDK

const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545";
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Step 1 + 2 + 3: recompute the exact message the SDK signed, confirm the
 * signature recovers to the claimed address, and reject stale signatures.
 * Mirrors metadata.js's buildMetadataMessage() line-for-line — any drift
 * between the two breaks every route below.
 */
function verifyMetadataAuth({ action, resourceId, extra, address, message, signature, timestamp }) {
  if (Date.now() - timestamp > MAX_SIGNATURE_AGE_MS) {
    throw new Error("Signature expired — please retry.");
  }

  const lines = ["Inaya Metadata Action", `action: ${action}`, `resourceId: ${resourceId}`];
  if (extra) for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${String(value)}`);
  lines.push(`timestamp: ${timestamp}`);
  const expectedMessage = lines.join("\n");

  if (message !== expectedMessage) {
    throw new Error("Signed message doesn't match the request fields — possible tampering.");
  }

  const recovered = ethers.verifyMessage(message, signature);
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Signature does not match the claimed address.");
  }
}

/**
 * Step 4 (file actions only): cross-check the signer against the REAL
 * on-chain owner of fileHash, not just whatever your DB happens to have
 * recorded. This is the actual security anchor for the whole module —
 * verified against the live Custody contract's assets(bytes32) mapping.
 */
async function verifyOnChainFileOwner(fileHash, claimedAddress) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const custody = new ethers.Contract(INAYA_ADDRESSES.custody, INAYA_CUSTODY_ABI, provider);
  const [owner] = await custody.assets(fileHash);
  if (owner === ethers.ZeroAddress) throw new Error(`No asset found on-chain for fileHash "${fileHash}".`);
  if (owner.toLowerCase() !== claimedAddress.toLowerCase()) {
    throw new Error("Signer is not the on-chain owner of this file.");
  }
}

// app/api/metadata/rename-file/route.js
export async function POST(req) {
  try {
    const { fileHash, newName, address, message, signature, timestamp } = await req.json();
    if (!fileHash || !newName) {
      return NextResponse.json({ error: "fileHash and newName are required." }, { status: 400 });
    }

    verifyMetadataAuth({ action: "renameFile", resourceId: fileHash, extra: { newName }, address, message, signature, timestamp });
    await verifyOnChainFileOwner(fileHash, address);

    // const record = await db.fileMetadata.update({ where: { fileHash }, data: { filename: newName, updatedAt: new Date() } });
    const record = { fileHash, owner: address, filename: newName, folderId: null, updatedAt: new Date().toISOString() };

    return NextResponse.json(record);
  } catch (err) {
    console.error("metadata/rename-file failed:", err);
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
}

// app/api/metadata/delete-folder/route.js
// Shown because it's the one route with a non-obvious rule: deleting a
// folder must ORPHAN its contained files (folderId -> null), never
// cascade-delete their metadata — a folder action should never be able
// to make file metadata disappear as a side effect.
export async function DELETE_FOLDER_EXAMPLE(req) {
  try {
    const { folderId, address, message, signature, timestamp } = await req.json();
    if (!folderId) return NextResponse.json({ error: "folderId is required." }, { status: 400 });

    verifyMetadataAuth({ action: "deleteFolder", resourceId: folderId, address, message, signature, timestamp });

    // Folders have no on-chain anchor — ownership is whatever your DB recorded at createFolder() time.
    // const folder = await db.folder.findUnique({ where: { folderId } });
    // if (folder.owner.toLowerCase() !== address.toLowerCase()) throw new Error("Not your folder.");
    // await db.folder.update({ where: { folderId }, data: { deletedAt: new Date() } });
    // await db.fileMetadata.updateMany({ where: { folderId }, data: { folderId: null } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("metadata/delete-folder failed:", err);
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
}

// The remaining routes (move-file, delete-file, restore-file, list-files,
// create-folder, rename-folder, move-folder, list-folders, share-file,
// revoke-share, list-shared-with-me) follow the exact same shape as
// rename-file above: verifyMetadataAuth() first, verifyOnChainFileOwner()
// for anything keyed by a fileHash, then the actual DB read/write. The
// list-* routes are read-only and don't require a signature at all (see
// metadata.js's module comment on why reads are a lower trust tier).
