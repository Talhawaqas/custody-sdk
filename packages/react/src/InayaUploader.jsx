// packages/react/src/InayaUploader.jsx
//
// Drag-and-drop upload widget — hooks the SDK's encrypt -> shard -> pin ->
// anchor pipeline to a real-time progress bar via the "Upload progress
// callbacks" (onProgress) already built into anchorToLedger()/approveFeeTokens().
//
// `pinShard` is required rather than hardcoded, same reasoning as the SDK's
// own Payments/Metadata clients: pinning is backend-specific (every app
// deploys its own IPFS pinning route), so this component stays reusable
// across whatever backend you've actually deployed instead of assuming one.

import { useState, useCallback, useRef } from "react";
import { InayaKernel } from "@inaya-network/custody-sdk";

const STAGE_ORDER = ["hashing", "pinning", "reading-fees", "approving-usdt", "approving-inaya", "submitting", "confirming", "done"];
const STAGE_LABELS = {
  hashing: "Encrypting & sharding",
  pinning: "Pinning to IPFS",
  "reading-fees": "Reading fees",
  "approving-usdt": "Approving USDT",
  "approving-inaya": "Approving INAYA",
  submitting: "Submitting to chain",
  confirming: "Confirming transaction",
  done: "Done",
};

export default function InayaUploader({
  connection,
  vaultKey,
  pinShard, // async (shardContent, filename, tag) => cid
  onComplete,
  onError,
  className = "",
}) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const stageIndex = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const progressPct = stageIndex >= 0 ? Math.round(((stageIndex + 1) / STAGE_ORDER.length) * 100) : 0;

  const upload = useCallback(async (pickedFile) => {
    if (!connection || !vaultKey || !pickedFile) return;
    setError(null);
    setStage("hashing");
    try {
      const sharded = await InayaKernel.disperseAndSlice({ file: pickedFile, encryptionKey: vaultKey });

      setStage("pinning");
      const [cidAlpha, cidBeta] = await Promise.all([
        pinShard(sharded.shardAlpha, sharded.filename, "Alpha"),
        pinShard(sharded.shardBeta, sharded.filename, "Beta"),
      ]);

      await InayaKernel.approveFeeTokens({
        connection,
        fileSizeBytes: pickedFile.size,
        onProgress: (p) => setStage(p.stage), // "reading-fees" -> "approving-usdt" -> "approving-inaya"
      });

      const receipt = await InayaKernel.anchorToLedger({
        connection,
        fileName: sharded.filename,
        fileSizeBytes: pickedFile.size,
        dataShardAlpha: cidAlpha,
        dataShardBeta: cidBeta,
        onProgress: (p) => setStage(p.stage), // "hashing" -> "submitting" -> "confirming" (re-emitted, harmless)
      });

      setStage("done");
      onComplete?.(receipt);
    } catch (err) {
      setError(err.message);
      setStage(null);
      onError?.(err);
    }
  }, [connection, vaultKey, pinShard, onComplete, onError]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) { setFile(dropped); upload(dropped); }
  }, [upload]);

  const handlePick = useCallback((e) => {
    const picked = e.target.files?.[0];
    if (picked) { setFile(picked); upload(picked); }
  }, [upload]);

  const disabled = !connection || !vaultKey;

  return (
    <div className={className}>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={disabled ? undefined : handleDrop}
        onClick={disabled ? undefined : () => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition
          ${disabled ? "cursor-not-allowed border-white/10 bg-black/10 opacity-50" : dragging ? "border-cyan-400 bg-cyan-400/5" : "border-white/20 bg-black/20 hover:border-cyan-400/50"}`}
      >
        <input ref={inputRef} type="file" onChange={handlePick} disabled={disabled} className="hidden" />
        <p className="text-sm text-slate-300">
          {disabled ? "Connect a wallet and unlock a vault key first" : file ? file.name : "Drag a file here, or click to browse"}
        </p>
      </div>

      {stage && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-400">{STAGE_LABELS[stage] || stage}</p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
