import { NextResponse } from "next/server";

// Same pinned-JSON shape ({ shard, element }) as the reference Inaya
// backend -- keeps files uploaded from this template retrievable by
// anything else that already knows how to read Inaya-pinned shards.
export async function POST(request) {
  try {
    const { encryptedShard, filename, elementTag } = await request.json();
    const pinataJWT = process.env.PINATA_JWT;
    if (!pinataJWT) {
      return NextResponse.json({ error: "Server missing PINATA_JWT -- set it in .env.local (see .env.example)." }, { status: 500 });
    }

    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pinataJWT}` },
      body: JSON.stringify({
        pinataContent: { shard: encryptedShard, element: elementTag },
        pinataMetadata: { name: `inaya_vault_${elementTag}_${filename}` },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json({ error: errorText }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ IpfsHash: data.IpfsHash });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
