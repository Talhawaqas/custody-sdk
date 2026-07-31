    // examples/node-script.mjs
//
// Server-side / scripting usage — no browser, no MetaMask. This is the
// same pattern the actual Inaya backend uses in stripe-webhook.js: a
// server-held wallet (funded with tBNB for gas, plus whatever tokens the
// operation needs) signs on someone's behalf.
//
// Requires the SDK's dual-mode connection support — pass an ethers.Wallet
// directly as `connection`, no connectWallet() call (that's browser-only).
//
// Run with: node examples/node-script.mjs
// (requires TREASURY_WALLET_PRIVATE_KEY set in your environment — never
// hardcode a real private key in source, even for a test script)

import { ethers } from "ethers";
import { InayaKernel } from "../src/index.js";

const RPC_URL = "https://data-seed-prebsc-1-s1.binance.org:8545";
const PRIVATE_KEY = process.env.TREASURY_WALLET_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("Set TREASURY_WALLET_PRIVATE_KEY in your environment first (needs testnet BNB for gas + USDT for the fee).");
  process.exit(1);
}

async function main() {
  // The dual-mode connection: a plain ethers.Wallet with an attached
  // provider, passed directly — no browser wallet handshake involved.
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const connection = { provider: wallet };

  console.log(`Signing as: ${wallet.address}`);

  // Subscribe to the shared event emitter once, for the whole script —
  // useful for logging in a long-running server process.
  InayaKernel.events.on("anchor:progress", (p) => console.log(`  [anchor] ${p.stage}`));
  InayaKernel.events.on("error", (p) => console.error(`  [error] ${p.operation}: ${p.error?.message || p.error}`));

  // A small in-memory "file" for this example — in a real script this
  // would be fs.readFileSync() wrapped in a Blob/File-like object.
  const fileContent = "This is a test file uploaded from a pure Node.js script, no browser involved.";
  const fileBlob = new Blob([fileContent], { type: "text/plain" });
  const file = new File([fileBlob], "node-example.txt", { type: "text/plain" });

  console.log("\nEncrypting + sharding...");
  const passkey = "node-script-test-passkey";
  const salt = InayaKernel.generateSecureSalt(16);
  const vaultKey = await InayaKernel.deriveVaultKey({ passkey, salt });
  const sharded = await InayaKernel.disperseAndSlice({ file, encryptionKey: vaultKey });
  console.log(`Sharded into Alpha (${sharded.shardAlpha.length} chars) + Beta (${sharded.shardBeta.length} chars)`);

  console.log("\nApproving fee tokens...");
  const fees = await InayaKernel.approveFeeTokens({
    connection,
    fileSizeBytes: file.size,
    onProgress: (p) => console.log(`  [approve] ${p.stage}`),
  });
  console.log(`Fees: usdt=${fees.usdtFee} inaya=${fees.inayaFee}`);

  console.log("\nAnchoring to ledger...");
  const receipt = await InayaKernel.anchorToLedger({
    connection,
    fileName: sharded.filename,
    fileSizeBytes: file.size,
    dataShardAlpha: sharded.shardAlpha,
    dataShardBeta: sharded.shardBeta,
  });
  console.log(`✅ Confirmed: ${receipt.transactionHash}`);
  console.log(`   View: https://testnet.bscscan.com/tx/${receipt.transactionHash}`);

  console.log("\nRetrieving + decrypting (read-only, doesn't need a signer)...");
  const restored = await InayaKernel.retrieveAndReconstruct({
    connection, // works fine here too — resolveProvider() only needs the .provider, not signing capability
    fileHash: receipt.fileHash,
    passkey,
  });
  console.log(`✅ Round trip confirmed. Restored data URL starts with: ${restored.dataUrl.slice(0, 40)}...`);
}

main().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
