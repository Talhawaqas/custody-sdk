"use client";
// app/page.js
//
// wagmi drives the connect UX (multi-connector support); the SDK itself
// still just wants a plain { provider, address } object, so once wagmi
// reports a connection, this bridges straight to window.ethereum -- same
// pattern the real Inaya web dApp uses. @inaya-network/react isn't wired
// in here yet (it isn't published anywhere outside the custody-sdk
// monorepo yet -- see that repo's Module 4). Once it is, this page can
// shrink to <InayaConnect/>/<InayaUploader/>/<InayaFileBrowser/> instead
// of the hand-rolled UI below.

import { useState, useCallback } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { InayaKernel } from "@inaya-network/custody-sdk";

async function pinShardToIPFS(shardContent, filename, tag) {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encryptedShard: shardContent, filename, elementTag: tag }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Pinning failed for shard ${tag}`);
  return data.IpfsHash;
}

export default function VaultPage() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  const [passkey, setPasskey] = useState("");
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleUpload = useCallback(async () => {
    if (!isConnected || !file || !passkey) return;
    setError(null);
    setResult(null);
    try {
      const connection = { provider: window.ethereum, address };

      setStage("encrypting");
      const salt = InayaKernel.generateSecureSalt(16);
      const vaultKey = await InayaKernel.deriveVaultKey({ passkey, salt });
      const sharded = await InayaKernel.disperseAndSlice({ file, encryptionKey: vaultKey });

      setStage("pinning");
      const [cidAlpha, cidBeta] = await Promise.all([
        pinShardToIPFS(sharded.shardAlpha, sharded.filename, "Alpha"),
        pinShardToIPFS(sharded.shardBeta, sharded.filename, "Beta"),
      ]);

      await InayaKernel.approveFeeTokens({
        connection,
        fileSizeBytes: file.size,
        onProgress: (p) => setStage(p.stage),
      });

      const receipt = await InayaKernel.anchorToLedger({
        connection,
        fileName: sharded.filename,
        fileSizeBytes: file.size,
        dataShardAlpha: cidAlpha,
        dataShardBeta: cidBeta,
        onProgress: (p) => setStage(p.stage),
      });

      setStage("done");
      setResult(receipt);
    } catch (err) {
      setError(err.message);
      setStage(null);
    }
  }, [isConnected, address, file, passkey]);

  return (
    <main className="mx-auto max-w-lg p-8 font-mono">
      <h1 className="mb-1 text-2xl font-bold text-white">Inaya Vault</h1>
      <p className="mb-6 text-sm text-slate-400">Encrypted client-side. Split before it leaves your device.</p>

      {!isConnected ? (
        <button
          onClick={() => connect({ connector: injected() })}
          className="rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-sm font-semibold text-slate-900"
        >
          Connect Wallet
        </button>
      ) : (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          <span className="font-mono text-slate-300">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
          <button onClick={() => disconnect()} className="text-xs text-slate-500 hover:text-slate-300">Disconnect</button>
        </div>
      )}

      {isConnected && (
        <div className="space-y-3">
          <input
            type="password"
            placeholder="Encryption passkey"
            value={passkey}
            onChange={(e) => setPasskey(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-slate-400"
          />
          <button
            onClick={handleUpload}
            disabled={!file || !passkey || !!stage}
            className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {stage ? stage : "Encrypt + Shard + Anchor"}
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {result && (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3 text-xs text-emerald-300">
              <p>fileHash: {result.fileHash}</p>
              <p>tx: {result.transactionHash}</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
