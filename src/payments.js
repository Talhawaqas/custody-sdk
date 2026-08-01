// src/payments.js
//
// Client-side wrappers around the card-payment backend routes (see the
// backend-demo folder in this repo for the actual Next.js route
// implementations). IMPORTANT — this module does NOT contain any payment
// logic itself. It only calls fetch() against routes that must already be
// deployed on your own server, since the real logic (Stripe secret keys,
// the treasury wallet's private key, MongoDB credentials) can never safely
// live in code that ships to a browser.
//
// Think of this as: "a typed client for an API you deploy yourself,"
// not "Stripe payments in a box." Every function here assumes those
// routes already exist at apiBaseUrl (defaults to "", i.e. same-origin
// relative paths — the normal case for a Next.js app calling its own
// /api/* routes).

import { InayaValidationError, InayaNetworkError, translateError } from "./errors.js";
import { withRetry } from "./utils.js";

// POSTs (checkout/session creation) are never auto-retried — same rationale
// as anchorToLedger() in index.js: a POST that "failed" client-side may
// have already applied server-side (e.g. a Stripe session already created),
// so blindly resubmitting risks duplicating it. GETs are read-only and
// idempotent, so — like every other read in index.js — they retry
// automatically on transient network failures.

async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new InayaNetworkError(data?.error || `Request to ${url} failed (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
    return data;
  } catch (err) {
    throw translateError(err);
  }
}

async function getJSON(url) {
  try {
    return await withRetry(async () => {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new InayaNetworkError(data?.error || `Request to ${url} failed (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
      return data;
    });
  } catch (err) {
    throw translateError(err);
  }
}

/**
 * Starts a Corporate Reserve card checkout. Returns the Stripe Checkout
 * URL — navigate the browser there yourself (e.g. window.location.href = url),
 * this function deliberately doesn't redirect for you, so it stays usable
 * outside a browser context (e.g. server-side pre-generation) too.
 */
export async function startCorporateReserveCheckout({ tier, apiBaseUrl = "" }) {
  if (!tier) throw new InayaValidationError("startCorporateReserveCheckout: tier is required.");
  const data = await postJSON(`${apiBaseUrl}/api/create-checkout-session`, { tier });
  return { checkoutUrl: data.url };
}

/**
 * Starts a PAYG upload card checkout for a single already-encrypted-and-
 * pinned file. Call this AFTER InayaKernel.disperseAndSlice() and pinning
 * both shards to IPFS yourself — this function only handles the payment
 * step, not the encryption/upload pipeline.
 */
export async function startPaygCheckout({ filename, sizeBytes, cidAlpha, cidBeta, fileHash, apiBaseUrl = "" }) {
  if (!filename || !sizeBytes || !cidAlpha || !cidBeta || !fileHash) {
    throw new InayaValidationError("startPaygCheckout: filename, sizeBytes, cidAlpha, cidBeta, and fileHash are all required.");
  }
  const data = await postJSON(`${apiBaseUrl}/api/create-payg-checkout-session`, { filename, sizeBytes, cidAlpha, cidBeta, fileHash });
  return { checkoutUrl: data.url, quotedUsd: data.quotedUsd };
}

/**
 * Starts an egress-unlock card checkout for a file the customer wants to
 * retrieve. Once paid, the customer is "unlocked" for that specific file —
 * check with getEgressUnlockStatus() before prompting for a passkey.
 */
export async function startEgressCheckout({ fileHash, filename, sizeBytes, apiBaseUrl = "" }) {
  if (!fileHash || !filename || !sizeBytes) {
    throw new InayaValidationError("startEgressCheckout: fileHash, filename, and sizeBytes are all required.");
  }
  const data = await postJSON(`${apiBaseUrl}/api/create-egress-checkout-session`, { fileHash, filename, sizeBytes });
  return { checkoutUrl: data.url, quotedUsd: data.quotedUsd, inayaPriceUsdt: data.inayaPriceUsdt };
}

/**
 * Call this once, right after landing back from Stripe with a session_id
 * in the URL — resolves the checkout session server-side and sets the
 * identifying cookie for this browser. Returns the customer's email.
 */
export async function resolveCheckoutSession({ sessionId, apiBaseUrl = "" }) {
  if (!sessionId) throw new InayaValidationError("resolveCheckoutSession: sessionId is required.");
  return getJSON(`${apiBaseUrl}/api/resolve-checkout-session?session_id=${encodeURIComponent(sessionId)}`);
}

/**
 * Checks whether this browser is already recognized as a card customer
 * (via the cookie resolveCheckoutSession() set previously). Call this on
 * every page load for returning visitors — returns { email: string | null }.
 */
export async function whoAmI({ apiBaseUrl = "" } = {}) {
  return getJSON(`${apiBaseUrl}/api/whoami`);
}

/** Reads a card customer's Corporate Reserve plan status. email is optional if the identifying cookie is already set. */
export async function getCorporatePlanStatus({ email, apiBaseUrl = "" } = {}) {
  const qs = email ? `?email=${encodeURIComponent(email)}` : "";
  return getJSON(`${apiBaseUrl}/api/corporate-plan-status${qs}`);
}

/** Lists a card customer's uploaded PAYG files. email is optional if the identifying cookie is already set. */
export async function getPaygAssets({ email, apiBaseUrl = "" } = {}) {
  const qs = email ? `?email=${encodeURIComponent(email)}` : "";
  return getJSON(`${apiBaseUrl}/api/payg-assets${qs}`);
}

/** Checks whether egress has already been paid for a given file. email is optional if the identifying cookie is already set. */
export async function getEgressUnlockStatus({ fileHash, email, apiBaseUrl = "" }) {
  if (!fileHash) throw new InayaValidationError("getEgressUnlockStatus: fileHash is required.");
  const emailPart = email ? `&email=${encodeURIComponent(email)}` : "";
  return getJSON(`${apiBaseUrl}/api/egress-unlock-status?fileHash=${encodeURIComponent(fileHash)}${emailPart}`);
}

export const Payments = {
  startCorporateReserveCheckout,
  startPaygCheckout,
  startEgressCheckout,
  resolveCheckoutSession,
  whoAmI,
  getCorporatePlanStatus,
  getPaygAssets,
  getEgressUnlockStatus,
};