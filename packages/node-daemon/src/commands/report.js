// packages/node-daemon/src/commands/report.js
//
// Submits a signed security-threat observation using this daemon's already-authenticated
// wallet keystore (see resolveWallet.js) -- the Security Layer SOW's "reporting-node
// reference" maps directly onto the node identity this daemon already has, rather than
// inventing a second one. Same signed-message technique as the rest of this codebase
// (metadata-auth.js/watcherPioneer.js): reconstruct a canonical message string, sign it with
// personal_sign semantics via ethers.
//
// buildSecurityReportMessage's exact string format MUST stay in lockstep with
// inaya-network-dapp/src/lib/security.js's own buildSecurityReportMessage -- any drift
// breaks every signed report.

import { resolveWallet } from "../resolveWallet.js";
import { API_BASE_URL } from "../constants.js";

const CATEGORIES = ["unknown", "phishing", "malware", "scam", "botnet_c2", "spam", "other"];

function buildSecurityReportMessage({ indicator, category, confidenceBps, evidenceHash, timestamp }) {
  const lines = [
    "Inaya Security Report",
    `indicator: ${String(indicator || "").trim().toLowerCase()}`,
    `category: ${String(category)}`,
    `confidenceBps: ${confidenceBps}`,
  ];
  if (evidenceHash) lines.push(`evidenceHash: ${evidenceHash}`);
  lines.push(`timestamp: ${timestamp}`);
  return lines.join("\n");
}

export async function reportCommand(indicator, options) {
  if (!indicator) {
    console.error('An indicator (domain or IP) is required, e.g. "inaya-node-daemon report evil-example.test --category phishing"');
    process.exit(1);
  }
  const category = (options?.category || "phishing").toLowerCase();
  if (!CATEGORIES.includes(category)) {
    console.error(`--category must be one of: ${CATEGORIES.join(", ")}`);
    process.exit(1);
  }
  const confidenceBps = Math.min(10000, Math.max(0, Number(options?.confidence) || 8000));
  const evidenceHash = options?.evidence || null;
  const apiBaseUrl = options?.apiBaseUrl || API_BASE_URL;

  const { wallet, address } = await resolveWallet();
  const timestamp = Date.now();
  const message = buildSecurityReportMessage({ indicator, category, confidenceBps, evidenceHash, timestamp });
  const signature = await wallet.signMessage(message);

  try {
    const res = await fetch(`${apiBaseUrl}/api/security/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeAddress: address, indicator, category, confidenceBps, evidenceHash, message, signature, timestamp }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error("Report rejected:", body.error || res.statusText);
      process.exit(1);
    }
    console.log(`Reported ${indicator} as ${category} (confidence ${confidenceBps / 100}%).`);
    console.log(`Aggregate status: ${body.confirmed ? "CONFIRMED" : "collecting independent reports"} (${(body.contributingNodes || []).length} independent reporter(s) so far).`);
  } catch (err) {
    console.error("Report request failed:", err.message);
    process.exit(1);
  }
}
