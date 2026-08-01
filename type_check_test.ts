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
  InayaError,
  InayaValidationError,
  InayaWalletError,
  InayaContractError,
  InayaNetworkError,
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