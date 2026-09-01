// packages/cli/src/pinDirectory.js
//
// Pins a whole local directory (a built static site) to IPFS as ONE
// directory CID, using Pinata's real pinFileToIPFS multipart endpoint —
// multiple `file` parts, each carrying its path-within-the-directory as
// its part filename, which is what makes Pinata wrap the set into a
// single addressable directory (resolvable as
// https://gateway.pinata.cloud/ipfs/<CID>/index.html). Sibling to
// pinata.js (single-shard JSON pinning) — this is a genuinely different
// shape (multipart file upload, not a JSON-wrapped string), so it's its
// own module rather than an extension of that one.
//
// SECURITY: this walks a LOCAL directory the developer controls and
// uploads it to THEIR OWN Pinata account (their own PINATA_JWT, never
// Inaya's) — no data reaches Inaya's own backend from this step at all.
// Three guards run BEFORE any network call, all fail-closed:
//   1. Path safety — a resolved file path that falls outside the root
//      directory (a symlink escape, or a name containing "..") is
//      rejected outright rather than silently uploaded.
//   2. Default excludes — node_modules/.git/.env* are skipped by
//      default, the common "pointed the command at the wrong directory"
//      footgun a deploy tool should guard against.
//   3. Hard caps — MAX_FILES / MAX_TOTAL_BYTES abort the whole operation
//      BEFORE the Pinata call, so an accidentally huge directory can
//      never even attempt a giant multipart upload.

import fs from "node:fs";
import path from "node:path";

export const MAX_FILES = 1000;
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB
const DEFAULT_EXCLUDES = new Set(["node_modules", ".git", ".DS_Store"]);

function isExcluded(name) {
  return DEFAULT_EXCLUDES.has(name) || name.startsWith(".env");
}

/** Recursively walks `rootDir`, returning [{ absolutePath, relativePath, size }] for every
 *  included file. Every relativePath is guaranteed to resolve back under rootDir — a symlink
 *  or crafted name that would escape it throws instead of being silently followed. */
export function walkDirectory(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`${rootDir} is not a directory.`);
  }

  const files = [];
  let totalBytes = 0;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isExcluded(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(resolvedRoot, absolutePath);

      // Guard against a symlink (or, in principle, a crafted relative name)
      // resolving outside the root we think we're pinning.
      const resolvedEntry = fs.realpathSync.native ? fs.realpathSync.native(absolutePath) : fs.realpathSync(absolutePath);
      if (!resolvedEntry.startsWith(resolvedRoot + path.sep) && resolvedEntry !== resolvedRoot) {
        throw new Error(`Refusing to pin "${relativePath}" — it resolves outside ${rootDir} (possible symlink escape).`);
      }
      if (relativePath.split(path.sep).includes("..")) {
        throw new Error(`Refusing to pin "${relativePath}" — path traversal segment detected.`);
      }

      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!stat.isFile()) continue; // skip sockets/devices/etc.

      files.push({ absolutePath, relativePath: relativePath.split(path.sep).join("/"), size: stat.size });
      totalBytes += stat.size;

      if (files.length > MAX_FILES) {
        throw new Error(`This directory has more than ${MAX_FILES} files — refusing to pin it. Point --path at your built output directory, not your whole project.`);
      }
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`This directory is larger than ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)} MB — refusing to pin it. Point --path at your built output directory, not your whole project.`);
      }
    }
  }

  walk(resolvedRoot);
  if (files.length === 0) throw new Error(`${rootDir} has no files to pin (after excluding node_modules/.git).`);
  return { files, totalBytes };
}

/** Pins every file in `files` as one Pinata directory upload, returning the single directory
 *  CID. `dirName` becomes the top-level folder in the returned CID (so the gateway URL is
 *  https://gateway.pinata.cloud/ipfs/<CID>/index.html, not .../ipfs/<CID> directly — Pinata's
 *  directory-wrap requires every part's filename to share a common leading folder segment). */
export async function pinDirectoryToIPFS({ files, dirName = "site", jwt }) {
  if (!jwt) throw new Error("PINATA_JWT environment variable is required to pin a directory (get one from app.pinata.cloud).");
  if (!files || files.length === 0) throw new Error("No files to pin.");

  const form = new FormData();
  for (const file of files) {
    const buffer = fs.readFileSync(file.absolutePath);
    form.append("file", new Blob([buffer]), `${dirName}/${file.relativePath}`);
  }
  // Deliberately NOT setting pinataOptions.wrapWithDirectory here — Pinata infers the directory
  // structure from the shared "<dirName>/..." prefix already present on every part's filename
  // above, which is the documented multi-file convention; this flag's exact semantics for the
  // multi-file case aren't something this session could verify against a real account (no
  // PINATA_JWT configured locally — see this feature's plan/verification notes), so the safer
  // choice is to not fight Pinata's own default behavior with an option whose effect here is
  // unconfirmed.
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name: `inaya_cli_deploy_${dirName}` }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.details || data?.error || `Directory pin failed (HTTP ${res.status})`);
  return data.IpfsHash;
}
