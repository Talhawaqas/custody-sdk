// type_check_test.ts — not a runtime test, just validates that the .d.ts
// files actually type-check against realistic usage. Run with:
//   npx tsc --noEmit --strict type_check_test.ts

import InayaKernel, {
  generateSecureSalt,
  deriveVaultKey,
  disperseAndSlice,
  reconstructAndDecrypt,
  connectWallet,
  anchorToLedger,
  approveFeeTokens,
  retrieveAndReconstruct,
  Staking,
  InayaError,
  InayaValidationError,
  InayaWalletError,
  InayaContractError,
  InayaNetworkError,
  type WalletConnection,
  type VaultKey,
} from "./src/index";

import { INAYA_ADDRESSES, INAYA_CUSTODY_ABI } from "./src/contracts";
import { Metadata } from "./src/metadata";
import type { FileMetadataRecord, FolderRecord } from "./src/metadata";

async function testFullFlow(file: File) {
  // Crypto
  const salt: Uint8Array = generateSecureSalt(16);
  const vaultKey: VaultKey = await deriveVaultKey({ passkey: "test", salt });
  const sharded = await disperseAndSlice({ file, encryptionKey: vaultKey });
  const shardAlpha: string = sharded.shardAlpha;
  const shardBeta: string = sharded.shardBeta;

  // Standalone decrypt primitive (no on-chain lookup, no gateway fetch — just the two
  // shards + passkey) — the piece inaya-network-dapp's own dual-gateway shard-fetch flow
  // needs directly, distinct from retrieveAndReconstruct()'s full on-chain+fetch+decrypt.
  const recoveredDataUrl: string = await reconstructAndDecrypt({ shardAlpha, shardBeta, passkey: "test" });

  // Wallet
  const connection: WalletConnection = await connectWallet();
  const address: string = connection.address;

  // Fee approval + anchor
  const fees = await approveFeeTokens({ connection, fileSizeBytes: file.size });
  const usdtFee: bigint = fees.usdtFee;

  const receipt = await anchorToLedger({
    connection,
    fileName: sharded.filename,
    fileSizeBytes: file.size,
    dataShardAlpha: shardAlpha,
    dataShardBeta: shardBeta,
  });
  const fileHash: string = receipt.fileHash;

  // Retrieve
  const restored = await retrieveAndReconstruct({
    connection,
    fileHash,
    passkey: "test",
  });
  const dataUrl: string = restored.dataUrl;

  // Staking
  const stakeResult = await Staking.stake({ connection, amount: 1000n });
  const reward: bigint = await Staking.calculateReward({ connection, address });

  // Also reachable through the InayaKernel namespace, same as disperseAndSlice above.
  const alsoRecovered: string = await InayaKernel.reconstructAndDecrypt({ shardAlpha, shardBeta, passkey: "test" });

  // Default export shape
  const kernelMethods: string[] = Object.keys(InayaKernel);

  // Contracts module
  const custodyAddress: string = INAYA_ADDRESSES.custody;
  const abiLength: number = INAYA_CUSTODY_ABI.length;

  return { dataUrl, usdtFee, reward, kernelMethods, custodyAddress, abiLength, stakeResult };
}

// Error handling — every SDK operation throws one of these instead of a raw
// ethers/JSON-RPC error; callers can narrow on `instanceof` and rely on `.code`.
async function testErrorHandling(connection: WalletConnection) {
  try {
    await anchorToLedger({ connection, fileName: "x", dataShardAlpha: "a", dataShardBeta: "b" } as any);
  } catch (err) {
    if (err instanceof InayaValidationError) {
      const code: string = err.code;
      const message: string = err.message;
    } else if (err instanceof InayaWalletError || err instanceof InayaContractError || err instanceof InayaNetworkError) {
      const cause: unknown = err.cause;
    } else if (err instanceof InayaError) {
      // still a known InayaKernel error, just not one of the more specific subclasses
    }
    throw err;
  }

  const errorClasses = InayaKernel.errors;
  const isWalletError: typeof InayaWalletError = errorClasses.InayaWalletError;
}

// Module 1 — off-chain mutable metadata layer (rename/move/delete, virtual
// folders, sharing). Custody's batchRegisterAssets() is write-once on-chain
// (verified directly against the deployed contract — see SDK_GUIDE.md), so
// these calls never touch the chain themselves; they're authenticated via a
// wallet signature instead (see metadata.js's signMetadataAction()).
async function testMetadataLayer(connection: WalletConnection, fileHash: string) {
  const renamed: FileMetadataRecord = await InayaKernel.Metadata.renameFile({ connection, fileHash, newName: "renamed.txt" });
  const folder: FolderRecord = await InayaKernel.Metadata.createFolder({ connection, name: "Invoices" });
  const moved: FileMetadataRecord = await Metadata.moveFile({ connection, fileHash, folderId: folder.folderId });

  const { files } = await InayaKernel.Metadata.listFiles({ owner: renamed.owner, folderId: folder.folderId });
  const filenames: string[] = files.map((f) => f.filename);

  await InayaKernel.Metadata.shareFile({ connection, fileHash, granteeAddress: "0x0000000000000000000000000000000000dEaD", wrappedVaultKey: "opaque-blob" });
  const { shares } = await InayaKernel.Metadata.listSharedWithMe({ owner: renamed.owner });

  return { renamed, moved, filenames, shares };
}