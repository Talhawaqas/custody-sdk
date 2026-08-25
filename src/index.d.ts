// src/index.d.ts
// Type definitions matching index.js exactly — see that file for implementation.

import { generateSecureSalt, deriveVaultKey, disperseAndSlice } from "./crypto";
import type { VaultKey, DeriveVaultKeyParams, DisperseAndSliceParams, DisperseAndSliceResult, HashAlgo } from "./crypto";
import { createPasskeyBackup, restorePasskeyBackup, isPasskeyBackupEnvelope, PASSKEY_BACKUP_VERSION } from "./passkeyBackup";
import type { PasskeyBackupEnvelope, CreatePasskeyBackupOptions } from "./passkeyBackup";
import type { InayaEventEmitter } from "./utils";
import type { PaymentsAPI } from "./payments";
import type { MetadataAPI } from "./metadata";
import type { AnalyticsAPI } from "./analytics";
import { InayaError, InayaValidationError, InayaWalletError, InayaContractError, InayaNetworkError, InayaDecryptionError } from "./errors";

/**
 * Pass this whole object in as `connection` to every method that needs one.
 * Two accepted shapes:
 *   - Browser: the return value of connectWallet() — { provider: window.ethereum, address }
 *   - Node.js/server-side: { provider: new ethers.Wallet(privateKey, jsonRpcProvider) } —
 *     address isn't required here, since the Wallet already knows its own address.
 */
export interface WalletConnection {
  /** Either a browser-style EIP-1193 provider (window.ethereum) or a plain ethers.Wallet/Signer instance. */
  provider: unknown;
  /** Only present for the browser flow — omit entirely for Node.js/server-side usage. */
  address?: string;
}

export type AnchorProgress =
  | { stage: "hashing"; fileName: string }
  | { stage: "submitting"; fileName: string; fileHash: string }
  | { stage: "confirming"; fileName: string; fileHash: string; transactionHash: string };

export interface AnchorToLedgerParams {
  connection: WalletConnection;
  /** If omitted, defaults to `${fileName}-${Date.now()}`. */
  assetId?: string;
  fileName: string;
  /** Required — the contract computes its per-GB fee from this. */
  fileSizeBytes: number | string | bigint;
  dataShardAlpha: string;
  dataShardBeta: string;
  /** @default INAYA_ADDRESSES.custody */
  custodyAddress?: string;
  /** Called at each stage: hashing -> submitting -> confirming. Same info is emitted on InayaKernel.events as "anchor:progress". */
  onProgress?: (progress: AnchorProgress) => void;
}

export interface AnchorToLedgerResult {
  transactionHash: string;
  assetId: string;
  /** bytes32 hex string — the same key retrieveAndReconstruct() reads back with. */
  fileHash: string;
}

export type ApproveProgress =
  | { stage: "reading-fees" }
  | { stage: "approving-usdt"; amount: bigint }
  | { stage: "approving-inaya"; amount: bigint };

export interface ApproveFeeTokensParams {
  connection: WalletConnection;
  fileSizeBytes: number | string | bigint;
  /** @default INAYA_ADDRESSES.custody */
  custodyAddress?: string;
  /** @default INAYA_ADDRESSES.token */
  tokenAddress?: string;
  /** If omitted, read live from the contract's usdtToken(). */
  usdtAddress?: string;
  onProgress?: (progress: ApproveProgress) => void;
}

export interface ApproveFeeTokensResult {
  usdtFee: bigint;
  inayaFee: bigint;
}

export type RetrieveProgress =
  | { stage: "reading-chain"; fileHash: string }
  | { stage: "fetching-shards"; fileHash: string }
  | { stage: "decrypting"; fileHash: string };

export interface RetrieveAndReconstructParams {
  connection: WalletConnection;
  /** Provide either this or `assetId` — not both required. */
  fileHash?: string;
  /** The original assetId used at anchorToLedger() — hashed internally if fileHash isn't provided directly. */
  assetId?: string;
  passkey: string;
  /** Custody doesn't store a filename on-chain — pass this if you have it tracked elsewhere. */
  knownFilename?: string;
  /** @default INAYA_ADDRESSES.custody */
  custodyAddress?: string;
  /** @default fetches from Pinata's public gateway, retried automatically on transient failures */
  fetchShard?: (cid: string) => Promise<string>;
  onProgress?: (progress: RetrieveProgress) => void;
}

export interface RetrieveAndReconstructResult {
  name: string | null;
  owner: string;
  timestamp: bigint;
  /** data: URL — same shape the dApp already renders/downloads from. */
  dataUrl: string;
}

export interface TxResult {
  transactionHash: string;
}

export type StakeProgress = { stage: "approving" } | { stage: "staking" };

export interface StakeParams {
  connection: WalletConnection;
  amount: bigint;
  /** 0 (flexible, 1.00x), 30, or 90 days — locks in a reward multiplier. @default 0 */
  lockPeriodDays?: 0 | 30 | 90;
  /** @default INAYA_ADDRESSES.token */
  tokenAddress?: string;
  /** @default INAYA_ADDRESSES.staking */
  stakingAddress?: string;
  onProgress?: (progress: StakeProgress) => void;
}

export interface UnstakeParams {
  connection: WalletConnection;
  amount: bigint;
  /** @default INAYA_ADDRESSES.staking */
  stakingAddress?: string;
}

export interface ClaimRewardParams {
  connection: WalletConnection;
  /** @default INAYA_ADDRESSES.staking */
  stakingAddress?: string;
}

export interface StakingReadParams {
  connection: WalletConnection;
  address: string;
  /** @default INAYA_ADDRESSES.staking */
  stakingAddress?: string;
}

export interface StakingAPI {
  /** Automatically approves the token allowance first if the current allowance is insufficient. */
  stake(params: StakeParams): Promise<TxResult>;
  /** Withdraws staked principal only — reverts if still inside the lock period. Call claimReward() separately for pending rewards. */
  unstake(params: UnstakeParams): Promise<TxResult>;
  /** Claims any pending reward balance — a separate on-chain action from unstake(). */
  claimReward(params: ClaimRewardParams): Promise<TxResult>;
  /** Read-only, retries on transient RPC errors — safe to call without a signer. */
  calculateReward(params: StakingReadParams): Promise<bigint>;
  /** Read-only, retries on transient RPC errors — safe to call without a signer. */
  getStakedBalance(params: StakingReadParams): Promise<bigint>;
}

/** Opens the Web3 wallet connection handshake via window.ethereum. Throws if no injected provider is found. */
export function connectWallet(): Promise<WalletConnection>;

/**
 * Submits the asset record to InayaCustody.batchRegisterAssets — wraps a single file as a 1-element batch.
 * Never auto-retried: retrying a submitted/reverted transaction can waste gas or risk double-spending.
 */
export function anchorToLedger(params: AnchorToLedgerParams): Promise<AnchorToLedgerResult>;

/** Reads live per-GB fees (retried on transient RPC errors) and approves both tokens — call once before anchorToLedger() for each new file. */
export function approveFeeTokens(params: ApproveFeeTokensParams): Promise<ApproveFeeTokensResult>;

/** Reads an asset's shard CIDs from Custody, fetches both shards, and reconstructs + decrypts locally. The chain read and both shard fetches retry automatically on transient failures. */
export function retrieveAndReconstruct(params: RetrieveAndReconstructParams): Promise<RetrieveAndReconstructResult>;

export const Staking: StakingAPI;
export const Payments: PaymentsAPI;
export const Metadata: MetadataAPI;
export const Analytics: AnalyticsAPI;

/**
 * Every event InayaKernel.events can emit, mapped to its exact payload shape.
 * This is what makes `events.on("anchor:progress", (p) => ...)` correctly
 * infer `p` as AnchorProgress instead of `unknown`.
 */
export interface InayaEventMap {
  "anchor:progress": AnchorProgress;
  "anchor:complete": AnchorToLedgerResult;
  "approve:progress": ApproveProgress;
  "approve:complete": ApproveFeeTokensResult;
  "retrieve:progress": RetrieveProgress;
  "retrieve:complete": RetrieveAndReconstructResult;
  "stake:progress": StakeProgress;
  "stake:complete": TxResult;
  "error": { operation: string; error: unknown };
}

/**
 * Shared event emitter — subscribe with InayaKernel.events.on(eventName, handler).
 * Fully typed: the handler's payload parameter is inferred from InayaEventMap
 * based on the event name you pass, no manual casting needed.
 */
export const events: InayaEventEmitter<InayaEventMap>;

export {
  generateSecureSalt,
  deriveVaultKey,
  disperseAndSlice,
  createPasskeyBackup,
  restorePasskeyBackup,
  isPasskeyBackupEnvelope,
  PASSKEY_BACKUP_VERSION,
  InayaError,
  InayaValidationError,
  InayaWalletError,
  InayaContractError,
  InayaNetworkError,
  InayaDecryptionError,
};

export type { VaultKey, DeriveVaultKeyParams, DisperseAndSliceParams, DisperseAndSliceResult, HashAlgo, PasskeyBackupEnvelope, CreatePasskeyBackupOptions };

export interface InayaErrorClasses {
  InayaError: typeof InayaError;
  InayaValidationError: typeof InayaValidationError;
  InayaWalletError: typeof InayaWalletError;
  InayaContractError: typeof InayaContractError;
  InayaNetworkError: typeof InayaNetworkError;
  InayaDecryptionError: typeof InayaDecryptionError;
}

export interface InayaKernelAPI {
  generateSecureSalt: typeof generateSecureSalt;
  deriveVaultKey: typeof deriveVaultKey;
  disperseAndSlice: typeof disperseAndSlice;
  createPasskeyBackup: typeof createPasskeyBackup;
  restorePasskeyBackup: typeof restorePasskeyBackup;
  isPasskeyBackupEnvelope: typeof isPasskeyBackupEnvelope;
  connectWallet: typeof connectWallet;
  approveFeeTokens: typeof approveFeeTokens;
  anchorToLedger: typeof anchorToLedger;
  retrieveAndReconstruct: typeof retrieveAndReconstruct;
  Staking: StakingAPI;
  Payments: PaymentsAPI;
  Metadata: MetadataAPI;
  Analytics: AnalyticsAPI;
  events: InayaEventEmitter<InayaEventMap>;
  errors: InayaErrorClasses;
}

export const InayaKernel: InayaKernelAPI;
export default InayaKernel;