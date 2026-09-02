// packages/cli/src/commands/upload.js
//
// Encrypts + shards a local file and anchors it to the chain, entirely
// from the terminal — no browser, no wallet extension. Wraps InayaKernel
// directly with a server-held ethers.Wallet (the same dual-mode
// connection pattern examples/node-script.mjs already demonstrates),
// since a CLI process has no browser wallet to connect to.

import fs from "node:fs";
import path from "node:path";
import { InayaKernel } from "@inaya-network/custody-sdk";
import { resolveWallet } from "../resolveWallet.js";
import { pinShardToIPFS, guessMimeType } from "../pinata.js";
import { promptHidden } from "../prompt.js";

// disperseAndSlice() only needs .name/.type/.arrayBuffer() — a plain object
// satisfies that without requiring Node 20+'s global File (this package
// targets Node >=18, same as the SDK itself).
function readAsFileLike(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    name: path.basename(filePath),
    type: guessMimeType(filePath),
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

export async function uploadCommand(filePath, options) {
  if (!fs.existsSync(filePath)) {
    console.error(`No such file: ${filePath}`);
    process.exit(1);
  }

  // No --passkey flag, deliberately -- a command-line argument is visible to other users on a
  // shared machine via `ps`/process listing and persists in shell history, unlike login's private
  // key (env var or hidden prompt only). Same reasoning applies here, so this only ever reads the
  // env var or prompts.
  const passkey = process.env.INAYA_PASSKEY || await promptHidden("Encryption passkey: ");
  if (!passkey) {
    console.error("A passkey is required to encrypt the file.");
    process.exit(1);
  }

  const { connection, address } = await resolveWallet();
  const file = readAsFileLike(filePath);

  console.log(`Encrypting & sharding ${file.name} (${file.size} bytes)...`);
  const salt = InayaKernel.generateSecureSalt(16);
  const vaultKey = await InayaKernel.deriveVaultKey({ passkey, salt });
  const sharded = await InayaKernel.disperseAndSlice({ file, encryptionKey: vaultKey });

  console.log("Pinning shards to IPFS...");
  const [cidAlpha, cidBeta] = await Promise.all([
    pinShardToIPFS(sharded.shardAlpha, sharded.filename, "Alpha"),
    pinShardToIPFS(sharded.shardBeta, sharded.filename, "Beta"),
  ]);

  console.log("Approving fee tokens...");
  await InayaKernel.approveFeeTokens({ connection, fileSizeBytes: file.size });

  console.log("Anchoring to ledger...");
  const receipt = await InayaKernel.anchorToLedger({
    connection,
    fileName: sharded.filename,
    fileSizeBytes: file.size,
    dataShardAlpha: cidAlpha,
    dataShardBeta: cidBeta,
  });

  console.log(`\nUploaded as ${address}`);
  console.log(`  fileHash: ${receipt.fileHash}`);
  console.log(`  tx:       ${receipt.transactionHash}`);
  console.log(`  view:     https://testnet.bscscan.com/tx/${receipt.transactionHash}`);

  if (options.apiBaseUrl) {
    try {
      await InayaKernel.Metadata.registerFileMetadata({ connection, fileHash: receipt.fileHash, filename: sharded.filename, apiBaseUrl: options.apiBaseUrl });
      console.log('  Registered in Metadata backend -- shows up in "inaya list".');
    } catch (err) {
      console.warn(`  Warning: uploaded successfully, but registerFileMetadata failed: ${err.message}`);
    }
  } else {
    console.log('  (Pass --api-base-url to also register this in your Metadata backend, so "inaya list" can find it.)');
  }
}
