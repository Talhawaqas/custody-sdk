// packages/cli/src/resolveWallet.js
//
// Shared by upload/list — decrypts the stored private key (see
// secretCrypto.js) and builds the same dual-mode `{ provider: wallet }`
// connection shape InayaKernel accepts server-side (identical pattern to
// examples/nextjs-api-route.js and examples/node-script.mjs).

import { ethers } from "ethers";
import { decryptSecret } from "./secretCrypto.js";
import { requireConfig } from "./config.js";
import { promptHidden } from "./prompt.js";

const RPC_URL = process.env.INAYA_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545";

export async function resolveWallet() {
  const config = requireConfig();
  const cliPassword = process.env.INAYA_CLI_PASSWORD || await promptHidden("CLI password: ");
  const privateKey = decryptSecret(config.encryptedKey, cliPassword);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  return { wallet, address: config.address, connection: { provider: wallet } };
}
