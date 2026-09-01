// src/backup.d.ts
// Type definitions matching backup.js exactly — see that file for implementation and the
// module-comment disambiguation from passkeyBackup.js (different concern entirely).

import type { WalletConnection } from "./index";

export type BackupHealthState = "Protected" | "Rebuilding" | "Degraded" | "RecoveryRequired" | "RecoveryFailed";

export interface BackupReplicaRecord {
  provider: string;
  cid: string;
  corrupted: boolean;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
}

export interface BackupShardStatus {
  replicaCount: number;
  targetReplicaCount: number;
  replicas: BackupReplicaRecord[];
}

export interface GetBackupStatusParams {
  fileHash: string;
  apiBaseUrl?: string;
}

export interface BackupStatus {
  fileHash: string;
  targetReplicaCount: number;
  healthState: BackupHealthState;
  lastStateChangeAt: string | null;
  shardAlpha: BackupShardStatus;
  shardBeta: BackupShardStatus;
}

export interface GetBackupHealthParams {
  fileHash: string;
  apiBaseUrl?: string;
}

export interface BackupHealth {
  fileHash: string;
  healthState: BackupHealthState;
  lastStateChangeAt: string | null;
}

export interface GetRedundancyStatusParams {
  fileHash: string;
  apiBaseUrl?: string;
}

export interface RedundancyStatus {
  fileHash: string;
  targetReplicaCount: number;
  shardAlpha: { replicaCount: number; targetReplicaCount: number };
  shardBeta: { replicaCount: number; targetReplicaCount: number };
}

export interface GetRecoveryStatusParams {
  fileHash: string;
  apiBaseUrl?: string;
}

export interface RecoveryStatus {
  fileHash: string;
  healthState: BackupHealthState;
  rebuildInFlight: { alpha: boolean; beta: boolean };
  lastStateChangeAt: string | null;
}

export interface RequestRecoveryParams {
  connection: WalletConnection;
  fileHash: string;
  apiBaseUrl?: string;
}

export interface BackupAPI {
  getBackupStatus(params: GetBackupStatusParams): Promise<BackupStatus>;
  getBackupHealth(params: GetBackupHealthParams): Promise<BackupHealth>;
  getRedundancyStatus(params: GetRedundancyStatusParams): Promise<RedundancyStatus>;
  getRecoveryStatus(params: GetRecoveryStatusParams): Promise<RecoveryStatus>;
  requestRecovery(params: RequestRecoveryParams): Promise<RecoveryStatus>;
}

export const Backup: BackupAPI;
