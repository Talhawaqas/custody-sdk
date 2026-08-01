import { generateSecureSalt, deriveVaultKey, disperseAndSlice, reconstructAndDecrypt } from './src/crypto.js';

// Exercises the REAL disperseAndSlice()/reconstructAndDecrypt() pair (not a reimplementation)
// in plain Node.js — no browser, no FileReader. A minimal object with .name/.type/.arrayBuffer()
// stands in for a browser File; both implement the same three properties disperseAndSlice() uses.
async function testRoundTrip() {
  const passkey = "test_passkey_12345";
  const salt = generateSecureSalt(16);
  const vaultKey = await deriveVaultKey({ passkey, salt });

  const originalText = "Hello Inaya Network!";
  const fakeFile = {
    name: "test.txt",
    type: "text/plain",
    arrayBuffer: async () => new TextEncoder().encode(originalText).buffer,
  };

  const sharded = await disperseAndSlice({ file: fakeFile, encryptionKey: vaultKey });
  console.log("Shard Alpha length:", sharded.shardAlpha.length, "| Shard Beta length:", sharded.shardBeta.length);
  console.log("Neither shard alone is valid base64 of the full payload:", sharded.shardAlpha !== sharded.shardAlpha + sharded.shardBeta);

  const restored = await reconstructAndDecrypt({ shardAlpha: sharded.shardAlpha, shardBeta: sharded.shardBeta, passkey });
  const expectedDataUrl = `data:text/plain;base64,${Buffer.from(originalText, "utf-8").toString("base64")}`;
  console.log("Restored matches original:", restored === expectedDataUrl);
  if (restored !== expectedDataUrl) {
    console.log("MISMATCH! Expected:", expectedDataUrl, "Got:", restored);
    process.exit(1);
  }
  console.log("Full round trip (encrypt -> shard -> reconstruct -> decrypt) verified working in plain Node.js.");
}

testRoundTrip().catch(e => { console.error("FAILED:", e); process.exit(1); });
