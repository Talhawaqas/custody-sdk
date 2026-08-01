// examples/nextjs-payments-api-routes.js
//
// Reference backend for src/payments.js (card-payment / no-wallet flow).
// SDK_GUIDE.md used to point to a "backend-demo" folder for this — that
// folder never actually existed in this repo. This file is the real
// reference implementation it should have pointed to all along.
//
// Requires: npm install @inaya-network/custody-sdk ethers stripe
// Env vars required: STRIPE_SECRET_KEY, TREASURY_WALLET_PRIVATE_KEY,
//                     BSC_TESTNET_RPC_URL (optional, has a default)

import Stripe from "stripe";
import { ethers } from "ethers";
import { InayaKernel } from "@inaya-network/custody-sdk";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
// import { db } from "../lib/db"; // your own DB client — not part of this SDK

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545";

// ------------------------------------------------------------------
// Schema (illustrative — adapt to your own DB/ORM):
//
//   CardCustomer { email (PK), stripeCustomerId, corporateTier (nullable),
//                  corporateActivatedAt, corporateExpiresAt }
//   PaygAsset    { fileHash (PK), email, filename, sizeBytes, txHash, uploadedAt }
//   EgressUnlock { fileHash, email, unlockedAt }
// ------------------------------------------------------------------

const IDENTITY_COOKIE = "inaya_customer_email";

// app/api/create-payg-checkout-session/route.js
export async function POST_CREATE_PAYG_CHECKOUT(req) {
  try {
    const { filename, sizeBytes, cidAlpha, cidBeta, fileHash } = await req.json();
    if (!filename || !sizeBytes || !cidAlpha || !cidBeta || !fileHash) {
      return NextResponse.json({ error: "filename, sizeBytes, cidAlpha, cidBeta, and fileHash are all required." }, { status: 400 });
    }

    const quotedUsd = ((sizeBytes / 1_073_741_824) * 5).toFixed(2); // e.g. $5/GB — your own pricing logic

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `PAYG upload: ${filename}` },
          unit_amount: Math.round(parseFloat(quotedUsd) * 100),
        },
        quantity: 1,
      }],
      // Stash everything the webhook needs to complete the on-chain registration later —
      // Stripe metadata values must be strings.
      metadata: { filename, sizeBytes: String(sizeBytes), cidAlpha, cidBeta, fileHash },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/upload/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/upload/cancelled`,
    });

    return NextResponse.json({ url: session.url, quotedUsd });
  } catch (err) {
    console.error("create-payg-checkout-session failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// app/api/resolve-checkout-session/route.js
// Call this once on the success_url landing page — completes the on-chain
// registration server-side (the customer never touched a wallet) and sets
// the identifying cookie whoAmI()/getPaygAssets() etc. read afterward.
export async function GET_RESOLVE_CHECKOUT_SESSION(req) {
  try {
    const sessionId = new URL(req.url).searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "session_id is required." }, { status: 400 });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "This session has not been paid." }, { status: 402 });
    }
    const email = session.customer_details?.email;
    const { filename, sizeBytes, cidAlpha, cidBeta, fileHash } = session.metadata;

    // Same dual-mode pattern as examples/nextjs-api-route.js — sign with a
    // server-held wallet since this customer never connected one.
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.TREASURY_WALLET_PRIVATE_KEY, provider);
    const connection = { provider: wallet };

    await InayaKernel.approveFeeTokens({ connection, fileSizeBytes: Number(sizeBytes) });
    const receipt = await InayaKernel.anchorToLedger({
      connection, fileName: filename, fileSizeBytes: Number(sizeBytes),
      dataShardAlpha: cidAlpha, dataShardBeta: cidBeta,
    });

    // await db.paygAsset.create({ data: { fileHash: receipt.fileHash, email, filename, sizeBytes, txHash: receipt.transactionHash, uploadedAt: new Date() } });

    (await cookies()).set(IDENTITY_COOKIE, email, { httpOnly: true, secure: true, sameSite: "lax" });
    return NextResponse.json({ email });
  } catch (err) {
    console.error("resolve-checkout-session failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// app/api/whoami/route.js
// The simplest possible route in this file — shown because it's the
// pattern every other cookie-gated GET route in this module follows.
export async function GET_WHOAMI(req) {
  const email = (await cookies()).get(IDENTITY_COOKIE)?.value ?? null;
  return NextResponse.json({ email });
}

// The remaining routes (create-checkout-session for Corporate Reserve,
// create-egress-checkout-session, corporate-plan-status, payg-assets,
// egress-unlock-status) follow the same two shapes shown above: a POST
// that creates a Stripe Checkout session with whatever metadata the
// webhook/resolve step needs, or a GET that reads the identity cookie and
// looks up the corresponding DB record. None of them touch the chain
// except resolve-checkout-session, which is the only one that needs
// InayaKernel at all.
