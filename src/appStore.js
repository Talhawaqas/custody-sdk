// src/appStore.js
//
// Client for the Web3 App Store (inaya-network-dapp's /apps) — lets a
// developer submit their own app for listing, check its review status,
// and browse what's already public. Same typed-fetch-client-with-zero-
// secrets shape as backup.js/metadata.js.
//
// SECURITY MODEL: getListings/getMyListings are unauthenticated reads —
// a submission's public fields reveal nothing sensitive, and
// getMyListings is scoped by the querying address, the same risk profile
// Backup.getBackupStatus already has for fileHash. submitListing() is
// wallet-signature authenticated exactly like Backup.requestRecovery() —
// api/apps/submit/route.js (the dApp repo) verifies it via the same
// verifyMetadataAuth() helper. THE SERVER, NOT THIS MODULE, is what
// actually enforces anything: every submission lands "pending" and is
// checked against the live Security Layer threat registry before an
// admin can approve it — this client can't skip or influence that.
//
// Two hosting paths, matching the App Store's own two accepted options:
// hostType "ipfs" (cid — pin it yourself, e.g. via inaya-cli's `deploy`
// command) or "iframe" (embedUrl — an already-hosted app, shown inside a
// strictly sandboxed iframe once approved). See appStoreListings.js's
// module comment (dApp repo) for why same-origin hosting and an unvetted
// open registry were both explicitly rejected as options.

import { InayaValidationError, InayaNetworkError, InayaWalletError, translateError } from "./errors.js";

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
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new InayaNetworkError(data?.error || `Request to ${url} failed (HTTP ${res.status})`, { code: `HTTP_${res.status}` });
    return data;
  } catch (err) {
    throw translateError(err);
  }
}

/** Duck-typed the same way backup.js/metadata.js's own local copies are — kept independent to
 *  avoid a circular import between index.js and this module. */
function isEthersSigner(raw) {
  return raw != null && typeof raw.getAddress === "function" && typeof raw.signMessage === "function";
}

async function resolveSigner(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("No provider/signer — call connectWallet() (browser) or pass an ethers.Wallet directly (Node.js) first.", { code: "NO_CONNECTION" });
  if (isEthersSigner(raw)) return raw;
  const { ethers } = await import("ethers");
  return new ethers.BrowserProvider(raw).getSigner();
}

/** Matches metadata-auth.js's verifyMetadataAuth canonical format EXACTLY, `extra` fields
 *  included — a mismatch here (e.g. re-normalizing a URL before signing vs. what's actually
 *  stored) fails closed server-side as "possible tampering," a real bug already hit once
 *  building the web submission form this mirrors. resourceId must be the RAW cid/embedUrl
 *  string, never re-parsed/normalized. */
function buildAppStoreMessage({ action, resourceId, extra }) {
  const timestamp = Date.now();
  const lines = ["Inaya Metadata Action", `action: ${action}`, `resourceId: ${resourceId}`];
  if (extra) for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${String(value)}`);
  lines.push(`timestamp: ${timestamp}`);
  return { message: lines.join("\n"), timestamp };
}

/** Submits an app for review — lands as "pending", never immediately public. Exactly one of
 *  `cid` (hostType "ipfs") or `embedUrl` (hostType "iframe") is required, matching
 *  appStoreListings.js's own validation. */
async function submitListing({ connection, name, description, category, hostType, cid, embedUrl, apiBaseUrl = "" }) {
  if (!name) throw new InayaValidationError("AppStore.submitListing: name is required.");
  if (!description) throw new InayaValidationError("AppStore.submitListing: description is required.");
  if (hostType !== "ipfs" && hostType !== "iframe") throw new InayaValidationError('AppStore.submitListing: hostType must be "ipfs" or "iframe".');
  if (hostType === "ipfs" && !cid) throw new InayaValidationError("AppStore.submitListing: cid is required when hostType is \"ipfs\".");
  if (hostType === "iframe" && !embedUrl) throw new InayaValidationError("AppStore.submitListing: embedUrl is required when hostType is \"iframe\".");

  const signer = await resolveSigner(connection);
  const address = await signer.getAddress();
  const resourceId = `${hostType}:${hostType === "ipfs" ? cid : embedUrl}`;
  const { message, timestamp } = buildAppStoreMessage({ action: "submitAppListing", resourceId, extra: { name } });
  const signature = await signer.signMessage(message);

  return postJSON(`${apiBaseUrl}/api/apps/submit`, { name, description, category, hostType, cid, embedUrl, address, message, signature, timestamp });
}

/** Public, approved-only listings — the same data the /apps page itself renders. */
async function getListings({ apiBaseUrl = "" } = {}) {
  return getJSON(`${apiBaseUrl}/api/apps/listings`);
}

/** Every submission from one wallet, any status — the only way to check whether YOUR OWN
 *  submission is still pending, was approved, or was rejected (and why) without admin access. */
async function getMyListings({ address, apiBaseUrl = "" }) {
  if (!address) throw new InayaValidationError("AppStore.getMyListings: address is required.");
  return getJSON(`${apiBaseUrl}/api/apps/my-listings?${new URLSearchParams({ address }).toString()}`);
}

export const AppStore = {
  submitListing,
  getListings,
  getMyListings,
};
