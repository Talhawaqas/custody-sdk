// packages/cli/src/commands/list.js
//
// Prints the ledger of registered files for the logged-in wallet.
//
// IMPORTANT: InayaCustody has no on-chain enumeration function at all —
// confirmed via live eth_call testing (see custody-sdk/SDK_GUIDE.md §12,
// known-limitations entry #6). batchRegisterAssets/assets(bytes32) only
// supports single-key lookups by a fileHash you already know, not "list
// everything owned by this address". So this command necessarily goes
// through the same off-chain Metadata backend the SDK's Metadata client
// uses (see examples/nextjs-metadata-api-routes.js) — there's no other
// source of truth for "all my files" to read from.

import { InayaKernel } from "@inaya-network/custody-sdk";
import { readConfig } from "../config.js";

export async function listCommand(options) {
  const config = readConfig();
  if (!config) {
    console.error('Not logged in. Run "inaya login" first.');
    process.exit(1);
  }

  const apiBaseUrl = options.apiBaseUrl || process.env.INAYA_API_BASE_URL;
  if (!apiBaseUrl) {
    console.error("--api-base-url (or INAYA_API_BASE_URL) is required — InayaCustody has no on-chain way to list all of a wallet's files, only single-fileHash lookups. Point this at your deployed Metadata backend (see examples/nextjs-metadata-api-routes.js).");
    process.exit(1);
  }

  const { files } = await InayaKernel.Metadata.listFiles({ owner: config.address, apiBaseUrl });
  if (files.length === 0) {
    console.log("No files registered for this wallet in the Metadata backend.");
    return;
  }

  console.log(`Files registered for ${config.address}:\n`);
  for (const f of files) {
    console.log(`  ${f.filename}`);
    console.log(`    fileHash:  ${f.fileHash}`);
    console.log(`    uploaded:  ${new Date(f.createdAt).toLocaleString()}`);
    console.log("");
  }
}
