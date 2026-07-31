// examples/nextjs-api-route.js
//
// app/api/example-upload/route.js — server-side usage in a Next.js API
// route, using the SDK's dual-mode connection support to sign with a
// server-held wallet. This mirrors the actual pattern used in Inaya's own
// stripe-webhook.js: the client already encrypted/sharded/pinned the file
// and just needs the server to complete the on-chain registration —
// exactly the shape a card-payment (no-wallet) flow needs.
//
// Requires: npm install @inaya-network/custody-sdk ethers
// Env var required: TREASURY_WALLET_PRIVATE_KEY

import { ethers } from "ethers";
import { InayaKernel } from "@inaya-network/custody-sdk";
import { NextResponse } from "next/server";

const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545";

// Vercel's default function timeout is often too short for an on-chain
// confirmation — see the earlier debugging notes on this exact issue.
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { filename, sizeBytes, cidAlpha, cidBeta } = await req.json();
    if (!filename || !sizeBytes || !cidAlpha || !cidBeta) {
      return NextResponse.json({ error: "filename, sizeBytes, cidAlpha, and cidBeta are all required." }, { status: 400 });
    }

    // Dual-mode connection — a plain ethers.Wallet, no browser/MetaMask involved.
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.TREASURY_WALLET_PRIVATE_KEY, provider);
    const connection = { provider: wallet };

    await InayaKernel.approveFeeTokens({ connection, fileSizeBytes: sizeBytes });

    const receipt = await InayaKernel.anchorToLedger({
      connection,
      fileName: filename,
      fileSizeBytes: sizeBytes,
      dataShardAlpha: cidAlpha,
      dataShardBeta: cidBeta,
    });

    return NextResponse.json({
      transactionHash: receipt.transactionHash,
      fileHash: receipt.fileHash,
    });
  } catch (err) {
    console.error("example-upload route failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}