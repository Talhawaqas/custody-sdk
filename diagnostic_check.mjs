// diagnostic_check.mjs — pure Node.js, no browser, no wallet, no MetaMask.
// Tests only the read-only parts of the SDK directly against the public
// RPC endpoint, to isolate whether a failure is the contract/network
// itself, or something specific to the browser/wallet/corporate-proxy combo.
//
// Run with: node diagnostic_check.mjs

import { ethers } from "ethers";

const RPC_URL = "https://data-seed-prebsc-1-s1.binance.org:8545";
const CUSTODY_ADDRESS = "0x7F5E6cF1353beEE4fc19FD46Dd6EaD0B3895a888";
const CUSTODY_ABI = [
  "function usdtFeePerGB() public view returns (uint256)",
  "function inayaFeePerGB() public view returns (uint256)",
  "function usdtToken() public view returns (address)",
];

async function main() {
  console.log(`Connecting directly to ${RPC_URL} (no wallet, no browser)...`);
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  try {
    const network = await provider.getNetwork();
    console.log(`✅ RPC reachable. Chain ID: ${network.chainId} (expect 97 for BNB Testnet)`);
  } catch (e) {
    console.log(`❌ Could not reach the RPC endpoint at all: ${e.message}`);
    console.log(`   This would point at a network/firewall issue blocking the connection itself.`);
    return;
  }

  const custody = new ethers.Contract(CUSTODY_ADDRESS, CUSTODY_ABI, provider);

  try {
    const usdtFee = await custody.usdtFeePerGB();
    console.log(`✅ usdtFeePerGB() = ${usdtFee.toString()} wei (${ethers.formatUnits(usdtFee, 18)} USDT/GB)`);
  } catch (e) {
    console.log(`❌ usdtFeePerGB() failed: ${e.message}`);
  }

  try {
    const inayaFee = await custody.inayaFeePerGB();
    console.log(`✅ inayaFeePerGB() = ${inayaFee.toString()} wei`);
  } catch (e) {
    console.log(`❌ inayaFeePerGB() failed: ${e.message}`);
  }

  try {
    const usdtToken = await custody.usdtToken();
    console.log(`✅ usdtToken() = ${usdtToken}`);
  } catch (e) {
    console.log(`❌ usdtToken() failed: ${e.message}`);
  }

  console.log("\nIf all three calls above succeeded, the contract and RPC endpoint are genuinely fine right now —");
  console.log("meaning today's browser errors were specific to MetaMask/corporate-network, not the SDK or contract.");
}

main();
