"use client";
// app/page.js
//
// The read/view counterpart to the Vault template's write/upload flow --
// fetch an already-anchored asset by its fileHash, decrypt it locally,
// and render a type-appropriate preview.
//
// No wagmi here (unlike the Vault template) and deliberately not
// @inaya-network/react's <InayaConnect/> either -- InayaConnect derives a
// full VaultKey object, which is the right shape for the SDK's *encryption*
// functions (disperseAndSlice), but retrieveAndReconstruct() just wants the
// raw passkey string directly. Using InayaConnect here would mean deriving
// a VaultKey this page never actually needs. InayaKernel.connectWallet() is
// simpler and matches what this page actually requires: a connection, plus
// a plain passkey input.

import { useState, useCallback } from "react";
import { InayaKernel } from "@inaya-network/custody-sdk";

const STAGE_LABELS = {
  "reading-chain": "Reading on-chain record",
  "fetching-shards": "Fetching encrypted shards from IPFS",
  decrypting: "Decrypting",
};

function guessPreviewKind(dataUrl) {
  const match = /^data:([^;]+);/.exec(dataUrl);
  const mime = match?.[1] || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "download";
}

export default function MediaViewerPage() {
  const [connection, setConnection] = useState(null);
  const [fileHash, setFileHash] = useState("");
  const [passkey, setPasskey] = useState("");
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const conn = await InayaKernel.connectWallet();
      setConnection(conn);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleRetrieve = useCallback(async () => {
    if (!connection || !fileHash || !passkey) return;
    setError(null);
    setResult(null);
    try {
      const restored = await InayaKernel.retrieveAndReconstruct({
        connection,
        fileHash,
        passkey,
        onProgress: (p) => setStage(p.stage),
      });
      setStage(null);
      setResult(restored);
    } catch (err) {
      setStage(null);
      setError(err.message);
    }
  }, [connection, fileHash, passkey]);

  const previewKind = result ? guessPreviewKind(result.dataUrl) : null;

  return (
    <main className="mx-auto max-w-lg p-8 font-mono">
      <h1 className="mb-1 text-2xl font-bold text-white">Inaya Media Viewer</h1>
      <p className="mb-6 text-sm text-slate-400">Fetch, decrypt, and preview an already-anchored asset.</p>

      {!connection ? (
        <button
          onClick={handleConnect}
          className="rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-sm font-semibold text-slate-900"
        >
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="0x... file hash"
            value={fileHash}
            onChange={(e) => setFileHash(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
          <input
            type="password"
            placeholder="Decryption passkey"
            value={passkey}
            onChange={(e) => setPasskey(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
          <button
            onClick={handleRetrieve}
            disabled={!fileHash || !passkey || !!stage}
            className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {stage ? STAGE_LABELS[stage] || stage : "Retrieve & Decrypt"}
          </button>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {result && (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
              {previewKind === "image" && <img src={result.dataUrl} alt="Decrypted asset" className="max-w-full rounded" />}
              {previewKind === "video" && <video src={result.dataUrl} controls className="max-w-full rounded" />}
              {previewKind === "audio" && <audio src={result.dataUrl} controls className="w-full" />}
              {previewKind === "pdf" && <embed src={result.dataUrl} type="application/pdf" className="h-96 w-full rounded" />}
              {previewKind === "download" && (
                <a href={result.dataUrl} download className="text-xs text-cyan-300 underline">
                  Download decrypted file
                </a>
              )}
              <p className="mt-2 text-[10px] text-slate-500">
                owner: {result.owner} · anchored: {new Date(Number(result.timestamp) * 1000).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
