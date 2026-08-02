// packages/cli/src/pinata.js
//
// Direct Pinata pinning — a CI/CD pipeline or terminal user has no running
// Next.js backend to pin through (unlike the browser/mobile apps, which
// reuse a deployed /api/upload route), so the CLI pins directly with the
// user's own Pinata JWT. Same pinned JSON shape as api/upload/route.js
// ({ shard, element }), so files uploaded via the CLI stay readable by
// anything that already knows how to retrieve Inaya-pinned shards.

const MIME_EXTENSIONS = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json",
};

export function guessMimeType(filename) {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_EXTENSIONS[ext] || "application/octet-stream";
}

export async function pinShardToIPFS(shardContent, filename, tag) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT environment variable is required to pin shards (get one from app.pinata.cloud).");

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      pinataContent: { shard: shardContent, element: tag },
      pinataMetadata: { name: `inaya_cli_${tag}_${filename}` },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Pinning failed for shard ${tag} (HTTP ${res.status})`);
  return data.IpfsHash;
}
