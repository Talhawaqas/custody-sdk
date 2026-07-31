// examples/ReactUploadWidget.jsx
//
// Browser-based usage in a React component — wallet connection, encrypt +
// shard + anchor with live progress, and the shared event emitter for a
// global status indicator elsewhere in the app.
//
// Requires: npm install @inaya-network/custody-sdk ethers react

import { useState, useEffect, useCallback } from "react";
import { InayaKernel } from "@inaya-network/custody-sdk";

export default function ReactUploadWidget() {
  const [connection, setConnection] = useState(null);
  const [file, setFile] = useState(null);
  const [passkey, setPasskey] = useState("");
  const [stage, setStage] = useState(null); // live progress, driven by onProgress
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // The event-driven pattern — useful for a global "activity" indicator
  // elsewhere in the app that doesn't have direct access to this
  // component's onProgress callbacks.
  useEffect(() => {
    const onError = (payload) => console.error(`[InayaKernel] ${payload.operation} failed:`, payload.error);
    InayaKernel.events.on("error", onError);
    return () => InayaKernel.events.off("error", onError); // clean up on unmount
  }, []);

  const handleConnect = useCallback(async () => {
    try {
      const conn = await InayaKernel.connectWallet();
      setConnection(conn);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!connection || !file || !passkey) return;
    setError(null);
    setResult(null);

    try {
      // Encrypt + shard — the callback-driven pattern, scoped to this component.
      setStage("encrypting");
      const salt = InayaKernel.generateSecureSalt(16);
      const vaultKey = await InayaKernel.deriveVaultKey({ passkey, salt });
      const sharded = await InayaKernel.disperseAndSlice({ file, encryptionKey: vaultKey });

      // In a real app, pin sharded.shardAlpha/shardBeta to IPFS here and
      // use the returned CIDs instead — this example anchors the raw
      // shard strings directly for simplicity.
      setStage("approving");
      await InayaKernel.approveFeeTokens({
        connection,
        fileSizeBytes: file.size,
        onProgress: (p) => setStage(p.stage),
      });

      const receipt = await InayaKernel.anchorToLedger({
        connection,
        fileName: sharded.filename,
        fileSizeBytes: file.size,
        dataShardAlpha: sharded.shardAlpha,
        dataShardBeta: sharded.shardBeta,
        onProgress: (p) => setStage(p.stage),
      });

      setStage("done");
      setResult(receipt);
    } catch (err) {
      setError(err.message);
      setStage(null);
    }
  }, [connection, file, passkey]);

  return (
    <div style={{ maxWidth: 480, fontFamily: "monospace" }}>
      {!connection ? (
        <button onClick={handleConnect}>Connect Wallet</button>
      ) : (
        <p>Connected: {connection.address}</p>
      )}

      <input type="file" onChange={(e) => setFile(e.target.files[0])} disabled={!connection} />
      <input
        type="password"
        placeholder="Encryption passkey"
        value={passkey}
        onChange={(e) => setPasskey(e.target.value)}
        disabled={!connection}
      />
      <button onClick={handleUpload} disabled={!connection || !file || !passkey}>
        Encrypt + Shard + Anchor
      </button>

      {stage && <p>Status: {stage}</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {result && (
        <p>
          ✅ Confirmed:{" "}
          <a href={`https://testnet.bscscan.com/tx/${result.transactionHash}`} target="_blank" rel="noreferrer">
            {result.transactionHash.slice(0, 14)}...
          </a>
        </p>
      )}
    </div>
  );
}
