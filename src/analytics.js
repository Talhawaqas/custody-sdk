// src/analytics.js
//
// Storage analytics / file statistics (Phase 3 Tier 1, Module 2,
// 2026-08-03). Pure aggregation on top of data the SDK can already
// read — no new on-chain writes, no new backend infrastructure beyond
// what Metadata already has.
//
// ENUMERATION SOURCE — verified before writing this, don't assume:
// InayaCustody has no on-chain reverse index or enumeration function —
// its only file-related read is assets(bytes32), a single-fileHash
// lookup. Confirmed by inspecting the full deployed ABI in contracts.js
// (batchRegisterAssets / assets / usdtToken / inayaToken / usdtFeePerGB /
// inayaFeePerGB — nothing else) and by trying to pull a verified ABI or
// event list from BscScan testnet for the live Custody address, which
// came back "Contract source code not verified." There is genuinely no
// way to ask the chain "list every file wallet X owns." Metadata.listFiles()
// (the off-chain DB) is therefore the ONLY enumeration source available —
// not a convenience choice, a hard constraint. Every file it returns is
// still cross-checked individually against assets(fileHash) below, so a
// stale or tampered-with off-chain record can't silently inflate a wallet's
// reported stats.
//
// BYTE-COUNT SOURCE — also verified, also a hard constraint: assets(bytes32)
// returns (owner, shardACID, shardBCID, timestamp) — no file size field.
// batchRegisterAssets() DOES take fileSizes as a write-time parameter, but
// nothing in the deployed contract's read interface exposes it back out.
// The only place a file's size is ever recoverable from is Metadata's
// fileSizeBytes field (client-reported at registerFileMetadata() time — see
// that function's own comment in metadata.js). totalBytesStored is honest
// about this: it's null, not 0 and not a guess, whenever any reconciled
// file is missing a known size, because a partial sum presented as a total
// would misrepresent real usage. bytesUnavailableCount says how many files
// are missing one.

import { ethers } from "ethers";
import { InayaValidationError, InayaWalletError } from "./errors.js";
import { withRetry } from "./utils.js";
import { INAYA_CUSTODY_ABI, INAYA_ADDRESSES } from "./contracts.js";
import { Metadata } from "./metadata.js";

/** Local copy of index.js's resolveProvider — kept separate (like metadata.js's resolveSigner)
 *  to avoid a circular import between index.js and this module. Read-only: no signer, no gas,
 *  works with any connection style including a plain ethers.JsonRpcProvider. */
function resolveProvider(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("InayaKernel.Analytics: no provider — pass a connection (browser wallet, ethers.Wallet, or plain ethers.Provider).", { code: "NO_CONNECTION" });
  if (raw.getNetwork) return raw; // already an ethers Provider
  if (typeof raw.getAddress === "function" && raw.provider) return raw.provider; // ethers Signer/Wallet
  return new ethers.BrowserProvider(raw); // EIP-1193 injected provider
}

function toDayKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function toWeekStartKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function bucketTimestamps(dates) {
  const daily = new Map();
  const weekly = new Map();
  for (const date of dates) {
    const dayKey = toDayKey(date);
    const weekKey = toWeekStartKey(date);
    daily.set(dayKey, (daily.get(dayKey) || 0) + 1);
    weekly.set(weekKey, (weekly.get(weekKey) || 0) + 1);
  }
  const sortEntries = (map, keyName) =>
    [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, count]) => ({ [keyName]: key, count }));
  return {
    daily: sortEntries(daily, "date"),
    weekly: sortEntries(weekly, "weekStart"),
  };
}

/**
 * Per-wallet storage statistics: total files, total bytes, upload
 * frequency (daily/weekly buckets), and most recent activity — all
 * derived from real Metadata + on-chain data, reconciled file-by-file
 * (see module comment for why reconciliation, not a blind merge, is
 * the honest approach here). Never fabricates a number: see
 * totalBytesStored's null-when-incomplete behavior above.
 */
async function getWalletStorageStats({ connection, address, apiBaseUrl = "", custodyAddress = INAYA_ADDRESSES.custody }) {
  if (!address) throw new InayaValidationError("InayaKernel.Analytics.getWalletStorageStats: address is required.");
  if (!custodyAddress) throw new InayaValidationError("InayaKernel.Analytics.getWalletStorageStats: custodyAddress is required.");

  const provider = resolveProvider(connection);
  const contract = new ethers.Contract(custodyAddress, INAYA_CUSTODY_ABI, provider);

  const { files } = await Metadata.listFiles({ owner: address, apiBaseUrl });

  const reconciled = [];
  const unreconciled = [];

  for (const file of files) {
    try {
      const [owner, , , timestamp] = await withRetry(() => contract.assets(file.fileHash));
      if (owner === ethers.ZeroAddress) {
        unreconciled.push({ fileHash: file.fileHash, reason: "no matching asset found on-chain" });
        continue;
      }
      if (owner.toLowerCase() !== address.toLowerCase()) {
        unreconciled.push({ fileHash: file.fileHash, reason: "on-chain owner does not match the queried address" });
        continue;
      }
      reconciled.push({ ...file, onChainTimestamp: Number(timestamp) });
    } catch (err) {
      unreconciled.push({ fileHash: file.fileHash, reason: `on-chain read failed: ${err.message}` });
    }
  }

  let totalBytesStored = 0;
  let bytesUnavailableCount = 0;
  for (const file of reconciled) {
    if (file.fileSizeBytes === null || file.fileSizeBytes === undefined) bytesUnavailableCount++;
    else totalBytesStored += file.fileSizeBytes;
  }

  const activityDates = reconciled.map((f) => new Date(f.onChainTimestamp * 1000));
  const mostRecentActivity = activityDates.length ? new Date(Math.max(...activityDates.map((d) => d.getTime()))) : null;

  return {
    address,
    totalFilesStored: reconciled.length,
    totalBytesStored: bytesUnavailableCount > 0 ? null : totalBytesStored,
    bytesUnavailableCount,
    mostRecentActivity: mostRecentActivity ? mostRecentActivity.toISOString() : null,
    uploadFrequency: bucketTimestamps(activityDates),
    unreconciledCount: unreconciled.length,
    unreconciled,
  };
}

export const Analytics = {
  getWalletStorageStats,
};
