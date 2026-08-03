// src/metadata.d.ts
// Type definitions matching metadata.js exactly — see that file for implementation
// and the full security-model writeup (signature + on-chain ownership verification).

import type { WalletConnection } from "./index";

/** The { address, message, signature, timestamp } proof your backend route must verify
 *  before applying any mutation — see metadata.js's module comment for the four checks. */
export interface MetadataAuth {
  address: string;
  message: string;
  signature: string;
  timestamp: number;
}

export interface SignMetadataActionParams {
  connection: WalletConnection;
  action: string;
  resourceId: string;
  extra?: Record<string, unknown>;
}

export interface RegisterFileMetadataParams {
  connection: WalletConnection;
  fileHash: string;
  filename: string;
  folderId?: string | null;
  apiBaseUrl?: string;
}

export interface RenameFileParams {
  connection: WalletConnection;
  fileHash: string;
  newName: string;
  apiBaseUrl?: string;
}

export interface MoveFileParams {
  connection: WalletConnection;
  fileHash: string;
  folderId?: string | null;
  apiBaseUrl?: string;
}

export interface DeleteFileParams {
  connection: WalletConnection;
  fileHash: string;
  apiBaseUrl?: string;
}

export interface RestoreFileParams {
  connection: WalletConnection;
  fileHash: string;
  apiBaseUrl?: string;
}

export interface ListFilesParams {
  owner: string;
  folderId?: string | null;
  includeDeleted?: boolean;
  apiBaseUrl?: string;
}

export interface FileMetadataRecord {
  fileHash: string;
  owner: string;
  filename: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateFolderParams {
  connection: WalletConnection;
  name: string;
  parentFolderId?: string | null;
  apiBaseUrl?: string;
}

export interface RenameFolderParams {
  connection: WalletConnection;
  folderId: string;
  newName: string;
  apiBaseUrl?: string;
}

export interface MoveFolderParams {
  connection: WalletConnection;
  folderId: string;
  parentFolderId?: string | null;
  apiBaseUrl?: string;
}

export interface DeleteFolderParams {
  connection: WalletConnection;
  folderId: string;
  apiBaseUrl?: string;
}

export interface ListFoldersParams {
  owner: string;
  parentFolderId?: string | null;
  apiBaseUrl?: string;
}

export interface FolderRecord {
  folderId: string;
  owner: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DeriveShareKeypairParams {
  connection: WalletConnection;
}

export interface ShareKeypair {
  address: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface RegisterEncryptionKeyParams {
  connection: WalletConnection;
  apiBaseUrl?: string;
}

export interface GetEncryptionKeyParams {
  address: string;
  apiBaseUrl?: string;
}

export interface ShareFileParams {
  connection: WalletConnection;
  fileHash: string;
  granteeAddress: string;
  /** The owner's original passkey (the same one deriveVaultKey() was called with) — shareFile()
   *  encrypts it for granteeAddress internally; you never construct wrappedVaultKey yourself. */
  passkey: string;
  apiBaseUrl?: string;
}

export interface GetSharedFileKeyParams {
  connection: WalletConnection;
  fileHash: string;
  apiBaseUrl?: string;
}

export interface RevokeShareParams {
  connection: WalletConnection;
  fileHash: string;
  granteeAddress: string;
  apiBaseUrl?: string;
}

export interface ListSharedWithMeParams {
  owner: string;
  apiBaseUrl?: string;
}

export interface SharedFileRecord {
  fileHash: string;
  granterAddress: string;
  wrappedVaultKey: string;
  createdAt: string;
}

export interface MetadataAPI {
  signMetadataAction(params: SignMetadataActionParams): Promise<MetadataAuth>;

  registerFileMetadata(params: RegisterFileMetadataParams): Promise<FileMetadataRecord>;
  renameFile(params: RenameFileParams): Promise<FileMetadataRecord>;
  moveFile(params: MoveFileParams): Promise<FileMetadataRecord>;
  deleteFile(params: DeleteFileParams): Promise<FileMetadataRecord>;
  restoreFile(params: RestoreFileParams): Promise<FileMetadataRecord>;
  listFiles(params: ListFilesParams): Promise<{ files: FileMetadataRecord[] }>;

  createFolder(params: CreateFolderParams): Promise<FolderRecord>;
  renameFolder(params: RenameFolderParams): Promise<FolderRecord>;
  moveFolder(params: MoveFolderParams): Promise<FolderRecord>;
  deleteFolder(params: DeleteFolderParams): Promise<FolderRecord>;
  listFolders(params: ListFoldersParams): Promise<{ folders: FolderRecord[] }>;

  /** Derives this wallet's deterministic X25519 sharing keypair — exported for advanced/custom
   *  flows; registerEncryptionKey() and getSharedFileKey() already call this internally. */
  deriveShareKeypair(params: DeriveShareKeypairParams): Promise<ShareKeypair>;
  registerEncryptionKey(params: RegisterEncryptionKeyParams): Promise<{ ok: true }>;
  getEncryptionKey(params: GetEncryptionKeyParams): Promise<{ publicKey: string | null }>;

  shareFile(params: ShareFileParams): Promise<{ ok: true }>;
  revokeShare(params: RevokeShareParams): Promise<{ ok: true }>;
  listSharedWithMe(params: ListSharedWithMeParams): Promise<{ shares: SharedFileRecord[] }>;
  /** Recipient-side: fetches, derives, and decrypts in one call — returns the original passkey,
   *  ready to pass into InayaKernel.reconstructAndDecrypt() alongside the file's shard data. */
  getSharedFileKey(params: GetSharedFileKeyParams): Promise<{ passkey: string }>;
}

export const Metadata: MetadataAPI;
