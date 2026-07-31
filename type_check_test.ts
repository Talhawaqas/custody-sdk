// type_check_test.ts — not a runtime test, just validates that the .d.ts
// files actually type-check against realistic usage. Run with:
//   npx tsc --noEmit --strict type_check_test.ts

import InayaKernel, {
  generateSecureSalt,
  deriveVaultKey,
  disperseAndSlice,
  connectWallet,
  anchorToLedger,
  approveFeeTokens,
  retrieveAndReconstruct,
  Staking,
  type WalletConnection,
  type VaultKey,
} from "./src/index";

import { INAYA_ADDRESSES, INAYA_CUSTODY_ABI } from "./src/contracts";

async function testFullFlow(file: File) {
  // Crypto
  const salt: Uint8Array = generateSecureSalt(16);
  const vaultKey: VaultKey = await deriveVaultKey({ passkey: "test", salt });
  const sharded = await disperseAndSlice({ file, encryptionKey: vaultKey });
  const shardAlpha: string = sharded.shardAlpha;
  const shardBeta: string = sharded.shardBeta;

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

  // Default export shape
  const kernelMethods: string[] = Object.keys(InayaKernel);

  // Contracts module
  const custodyAddress: string = INAYA_ADDRESSES.custody;
  const abiLength: number = INAYA_CUSTODY_ABI.length;

  return { dataUrl, usdtFee, reward, kernelMethods, custodyAddress, abiLength, stakeResult };
}