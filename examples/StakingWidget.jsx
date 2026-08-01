// examples/StakingWidget.jsx
//
// Browser-based usage of InayaKernel.Staking — stake/withdraw/claimReward,
// plus reading live totals. No prior example covered this API surface at
// all. Also demonstrates the typed-error pattern (InayaWalletError vs.
// InayaContractError) that the other examples in this folder don't show,
// since Staking is where a user is most likely to hit both in practice
// (rejecting the approval prompt, or trying to withdraw during the lock).
//
// Requires: npm install @inaya-network/custody-sdk ethers react

import { useState, useCallback } from "react";
import { InayaKernel, InayaWalletError, InayaContractError } from "@inaya-network/custody-sdk";

export default function StakingWidget() {
  const [connection, setConnection] = useState(null);
  const [amount, setAmount] = useState("");
  const [lockPeriodDays, setLockPeriodDays] = useState(0);
  const [stage, setStage] = useState(null);
  const [overview, setOverview] = useState(null); // { staked, earned, tier }
  const [error, setError] = useState(null);

  const handleConnect = useCallback(async () => {
    try {
      const conn = await InayaKernel.connectWallet();
      setConnection(conn);
      await refreshOverview(conn);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const refreshOverview = useCallback(async (conn) => {
    if (!conn?.address) return;
    const [staked, earned, tier] = await Promise.all([
      InayaKernel.Staking.getStakedBalance({ connection: conn, address: conn.address }),
      InayaKernel.Staking.calculateReward({ connection: conn, address: conn.address }),
      // getUserTier isn't wrapped by the Staking helper object (it's a plain read the SDK
      // doesn't currently surface a dedicated method for) — call the contract directly if you need it:
      Promise.resolve(null),
    ]);
    setOverview({ staked, earned, tier });
  }, []);

  const handleStake = useCallback(async () => {
    if (!connection || !amount) return;
    setError(null);
    try {
      setStage("staking");
      await InayaKernel.Staking.stake({
        connection,
        amount: ethersParseInaya(amount),
        lockPeriodDays,
        onProgress: (p) => setStage(p.stage), // "approving" -> "staking"
      });
      setStage("done");
      await refreshOverview(connection);
    } catch (err) {
      handleStakingError(err);
    }
  }, [connection, amount, lockPeriodDays, refreshOverview]);

  const handleWithdraw = useCallback(async () => {
    if (!connection || !amount) return;
    setError(null);
    try {
      setStage("withdrawing");
      await InayaKernel.Staking.unstake({ connection, amount: ethersParseInaya(amount) });
      setStage("done");
      await refreshOverview(connection);
    } catch (err) {
      handleStakingError(err);
    }
  }, [connection, amount, refreshOverview]);

  const handleClaim = useCallback(async () => {
    if (!connection) return;
    setError(null);
    try {
      setStage("claiming");
      await InayaKernel.Staking.claimReward({ connection });
      setStage("done");
      await refreshOverview(connection);
    } catch (err) {
      handleStakingError(err);
    }
  }, [connection, refreshOverview]);

  // The typed-error branch this example exists to demonstrate: distinguish
  // "you need to fix something in your wallet/inputs" from "the contract
  // said no" instead of showing the same generic message for both.
  function handleStakingError(err) {
    setStage(null);
    if (err instanceof InayaWalletError) {
      setError(err.code === "USER_REJECTED" ? "You rejected the request in your wallet." : `Wallet problem: ${err.message}`);
    } else if (err instanceof InayaContractError) {
      setError(`The contract rejected this: ${err.message}`); // e.g. withdrawing before lockExpiry()
    } else {
      setError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 480, fontFamily: "monospace" }}>
      {!connection ? (
        <button onClick={handleConnect}>Connect Wallet</button>
      ) : (
        <p>Connected: {connection.address}</p>
      )}

      {overview && (
        <p>
          Staked: {overview.staked.toString()} | Pending reward: {overview.earned.toString()}
        </p>
      )}

      <input type="text" placeholder="Amount (INAYA)" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!connection} />
      <select value={lockPeriodDays} onChange={(e) => setLockPeriodDays(Number(e.target.value))} disabled={!connection}>
        <option value={0}>Flexible (1.00x)</option>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
      </select>

      <div>
        <button onClick={handleStake} disabled={!connection || !amount}>Stake</button>
        <button onClick={handleWithdraw} disabled={!connection || !amount}>Withdraw</button>
        <button onClick={handleClaim} disabled={!connection}>Claim Reward</button>
      </div>

      {stage && <p>Status: {stage}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

// INAYA has 18 decimals like most ERC-20s — swap in ethers.parseUnits if you
// need a different decimals value read from INAYA_TOKEN_ABI's decimals().
function ethersParseInaya(amountString) {
  const [whole, fraction = ""] = amountString.split(".");
  const paddedFraction = (fraction + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(paddedFraction || "0");
}
