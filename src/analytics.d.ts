// src/analytics.d.ts
// Type definitions matching analytics.js exactly — see that file for the full
// explanation of why enumeration and byte-count sourcing work the way they do.

import type { WalletConnection } from "./index";

export interface GetWalletStorageStatsParams {
  connection: WalletConnection;
  address: string;
  apiBaseUrl?: string;
  custodyAddress?: string;
}

export interface UnreconciledFile {
  fileHash: string;
  reason: string;
}

export interface UploadFrequencyBucket {
  date?: string;
  weekStart?: string;
  count: number;
}

export interface WalletStorageStats {
  address: string;
  totalFilesStored: number;
  /** Sum of Metadata's client-reported fileSizeBytes across reconciled files — null (never 0 or
   *  a partial guess) if any reconciled file is missing a known size. See bytesUnavailableCount. */
  totalBytesStored: number | null;
  bytesUnavailableCount: number;
  /** ISO timestamp of the most recent reconciled file's on-chain assets() timestamp, or null if
   *  there are no reconciled files at all. */
  mostRecentActivity: string | null;
  uploadFrequency: {
    daily: UploadFrequencyBucket[];
    weekly: UploadFrequencyBucket[];
  };
  /** Files Metadata.listFiles() returned that did NOT reconcile against on-chain state (never
   *  found, or on-chain owner mismatch, or the on-chain read itself failed) — excluded from every
   *  other field above rather than silently trusted. */
  unreconciledCount: number;
  unreconciled: UnreconciledFile[];
}

export interface AnalyticsAPI {
  /** Per-wallet storage statistics, derived from real Metadata + on-chain data only —
   *  see analytics.js's module comment for the hard constraints this works within
   *  (no on-chain enumeration, no on-chain file-size field) and how it stays honest about them. */
  getWalletStorageStats(params: GetWalletStorageStatsParams): Promise<WalletStorageStats>;
}

export const Analytics: AnalyticsAPI;
