// packages/cli/src/commands/deploy.js
//
// Pins a local static site directory to IPFS (the developer's OWN
// Pinata account — see pinDirectory.js's header) and submits it to
// Inaya's Web3 App Store for review. Mirrors upload.js's orchestration
// shape: resolve wallet -> do the real work -> print a clear summary.
//
// Nothing here bypasses the App Store's review pipeline — this is just a
// different, scriptable way to reach the exact same
// POST /api/apps/submit that the web form (/apps/submit) calls. Every
// deploy still lands "pending", still gets checked against the live
// Security Layer threat registry, still needs an admin to approve it
// before it's public.

import { InayaKernel } from "@inaya-network/custody-sdk";
import { resolveWallet } from "../resolveWallet.js";
import { walkDirectory, pinDirectoryToIPFS, MAX_FILES, MAX_TOTAL_BYTES } from "../pinDirectory.js";
import { prompt } from "../prompt.js";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function deployCommand(dirPath, options) {
  let files, totalBytes;
  try {
    ({ files, totalBytes } = walkDirectory(dirPath));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(`Found ${files.length} file${files.length === 1 ? "" : "s"} (${formatBytes(totalBytes)}) in ${dirPath}.`);
  if (files.length > MAX_FILES * 0.9 || totalBytes > MAX_TOTAL_BYTES * 0.9) {
    console.log(`(Approaching this tool's ${MAX_FILES}-file / ${formatBytes(MAX_TOTAL_BYTES)} cap.)`);
  }

  const name = options.name || await prompt("App name: ");
  const description = options.description || await prompt("Description: ");
  const category = options.category || "Tools";
  if (!name || !description) {
    console.error("A name and description are required.");
    process.exit(1);
  }

  if (!options.yes) {
    const confirmed = await prompt(`Pin ${files.length} files to your Pinata account and submit "${name}" for App Store review? [y/N]: `);
    if (confirmed.toLowerCase() !== "y" && confirmed.toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  const { connection, address } = await resolveWallet();

  console.log("Pinning directory to IPFS (this may take a while for larger sites)...");
  const cid = await pinDirectoryToIPFS({ files, dirName: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "site", jwt: process.env.PINATA_JWT });
  console.log(`  CID: ${cid}`);
  console.log(`  Preview: https://gateway.pinata.cloud/ipfs/${cid}/`);

  const apiBaseUrl = options.apiBaseUrl || process.env.INAYA_API_BASE_URL;
  if (!apiBaseUrl) {
    console.log("\nPinned successfully, but no --api-base-url (or INAYA_API_BASE_URL) was given, so this wasn't submitted to the App Store.");
    console.log(`Your CID is ${cid} — you can submit it manually later via the App Store's web form, or re-run with --api-base-url.`);
    return;
  }

  console.log("Submitting for App Store review...");
  const result = await InayaKernel.AppStore.submitListing({
    connection, name, description, category, hostType: "ipfs", cid, apiBaseUrl,
  });

  console.log(`\nSubmitted as ${address}`);
  console.log(`  slug:   ${result.slug}`);
  console.log(`  status: ${result.status}`);
  console.log(`  An Inaya admin reviews every submission before it's public — check status any time with your App Store submission's slug, or via InayaKernel.AppStore.getMyListings({ address }).`);
}
