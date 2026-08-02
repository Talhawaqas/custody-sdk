// packages/react/src/InayaConnect.jsx
//
// A Web3 auth button that, once connected, also derives the user's vault
// key (the SDK's client-side encryption key) so a parent component gets
// everything it needs — connection AND vaultKey — from one place instead
// of wiring connectWallet()/deriveVaultKey() by hand.
//
// IMPORTANT — salt persistence: a vault key is derived from passkey + salt.
// If you let this component generate a fresh salt every session (the
// default, first-connect behavior), files encrypted this session become
// permanently undecryptable next session unless you persist that salt
// yourself (e.g. keyed by wallet address, in your own backend or
// localStorage) and pass it back in as the `salt` prop on future connects.
// This component surfaces the salt in onReady specifically so you can do that.

import { useState, useCallback } from "react";
import { InayaKernel, InayaWalletError } from "@inaya-network/custody-sdk";

export default function InayaConnect({ onReady, onError, salt: saltProp, label = "Connect Wallet", className = "" }) {
  const [connection, setConnection] = useState(null);
  const [passkey, setPasskey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const conn = await InayaKernel.connectWallet();
      setConnection(conn);
    } catch (err) {
      setError(err.message);
      onError?.(err);
    } finally {
      setConnecting(false);
    }
  }, [onError]);

  const handleUnlock = useCallback(async () => {
    if (!connection || !passkey) return;
    setError(null);
    setUnlocking(true);
    try {
      const salt = saltProp ?? InayaKernel.generateSecureSalt(16);
      const vaultKey = await InayaKernel.deriveVaultKey({ passkey, salt });
      onReady?.({ connection, vaultKey, salt, address: connection.address });
    } catch (err) {
      setError(err.message);
      onError?.(err);
    } finally {
      setUnlocking(false);
    }
  }, [connection, passkey, saltProp, onReady, onError]);

  if (!connection) {
    return (
      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting}
        className={`inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        {connecting ? "Connecting..." : label}
      </button>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-mono">{connection.address?.slice(0, 6)}...{connection.address?.slice(-4)}</span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          placeholder="Encryption passkey"
          value={passkey}
          onChange={(e) => setPasskey(e.target.value)}
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
        />
        <button
          type="button"
          onClick={handleUnlock}
          disabled={!passkey || unlocking}
          className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {unlocking ? "..." : "Unlock"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
