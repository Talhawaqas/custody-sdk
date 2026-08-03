// ============================================================
// @inaya-network/custody-sdk — InayaKernel
//
// Wires the client-side crypto/sharding pipeline (crypto.js) to the
// live InayaNetwork / InayaToken / InayaStaking contracts. Requires
// `ethers` (v6) as a peer dependency.
//
// Works in two contexts:
//   - Browser: connection = await connectWallet() (wraps window.ethereum)
//   - Node.js / server-side: pass an ethers.Wallet directly as `connection`,
//     e.g. { provider: new ethers.Wallet(privateKey, jsonRpcProvider) } —
//     the same pattern the treasury-wallet backend routes already use.
//
// Robustness: long-running operations accept an optional onProgress
// callback and also emit matching events on the shared `events` emitter
// (InayaKernel.events) — use whichever pattern fits your app. Genuinely
// transient failures (IPFS gateway fetches, read-only RPC calls) retry
// automatically with backoff; contract reverts and wallet rejections
// never do, since retrying those doesn't help and can be actively harmful.
// ============================================================

import { ethers } from "ethers";
import { generateSecureSalt, deriveVaultKey, disperseAndSlice, reconstructAndDecrypt } from "./crypto.js";
import { INAYA_CUSTODY_ABI, INAYA_TOKEN_ABI, INAYA_STAKING_ABI, INAYA_ADDRESSES } from "./contracts.js";
import { withRetry, InayaEventEmitter } from "./utils.js";
import { Payments } from "./payments.js";
import { Metadata } from "./metadata.js";
import { Analytics } from "./analytics.js";
import { InayaError, InayaValidationError, InayaWalletError, InayaContractError, InayaNetworkError, translateError } from "./errors.js";

/** Shared event emitter — subscribe with InayaKernel.events.on("event:name", handler). */
const events = new InayaEventEmitter();

function emitProgress(onProgress, eventName, payload) {
  onProgress?.(payload);
  events.emit(eventName, payload);
}

/** True if `raw` is already an ethers Signer (Node.js usage — e.g. new ethers.Wallet(pk, provider))
 *  rather than a browser-style EIP-1193 injected provider (window.ethereum). Duck-typed since
 *  ethers v6 doesn't export one single class every signer type cleanly extends for instanceof. */
function isEthersSigner(raw) {
  return raw != null && typeof raw.getAddress === "function" && typeof raw.signTransaction === "function";
}

/** Resolves a signer for write operations — works with either a browser wallet (via connectWallet())
 *  or a plain ethers.Wallet/Signer passed directly (Node.js/server-side usage). */
async function resolveSigner(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("No provider/signer — call connectWallet() (browser) or pass an ethers.Wallet directly (Node.js) first.", { code: "NO_CONNECTION" });
  if (isEthersSigner(raw)) return raw; // Node.js: already a Signer
  return new ethers.BrowserProvider(raw).getSigner(); // Browser: EIP-1193 injected provider
}

/** Resolves a read-only provider — works with either connection style. */
function resolveProvider(connection) {
  const raw = connection?.provider ?? connection;
  if (!raw) throw new InayaWalletError("No provider/signer — call connectWallet() (browser) or pass an ethers.Wallet directly (Node.js) first.", { code: "NO_CONNECTION" });
  if (isEthersSigner(raw)) {
    if (!raw.provider) throw new InayaValidationError("The ethers.Wallet passed as `connection` has no attached provider — construct it as `new ethers.Wallet(privateKey, provider)`.");
    return raw.provider;
  }
  return new ethers.BrowserProvider(raw);
}

/**
 * Opens the Web3 wallet connection handshake (MetaMask window injection,
 * or any EIP-1193 provider already present on window.ethereum). Browser-only —
 * for Node.js/server-side usage, construct an ethers.Wallet directly instead
 * and pass it as `connection` to every other method (see module comment).
 */
async function connectWallet() {
  if (typeof window === "undefined" || typeof window.ethereum === "undefined") {
    throw new InayaWalletError(
      "No injected Web3 provider found in this browser. For Node.js/server-side usage, pass an ethers.Wallet directly as `connection` instead — see the SDK guide's Node.js example.",
      { code: "NO_INJECTED_PROVIDER" }
    );
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    return { provider: window.ethereum, address: accounts[0] };
  } catch (err) {
    throw translateError(err, "connectWallet");
  }
}

/**
 * Submits the asset record to the InayaCustody contract via
 * batchRegisterAssets — wraps a single file as a 1-element batch.
 * fileSizeBytes is required: the contract computes its per-GB USDT +
 * INAYA fee from it (usdtFeePerGB / inayaFeePerGB) — call
 * approveFeeTokens() first, or this reverts with "USDT payment failed"
 * / "INAYA payment failed".
 *
 * Emits (and calls onProgress with): "hashing" -> "submitting" -> "confirming" -> "done".
 * Transaction submission/confirmation is never retried automatically —
 * see the module comment for why.
 */
async function anchorToLedger({ connection, assetId, fileName, fileSizeBytes, dataShardAlpha, dataShardBeta, custodyAddress = INAYA_ADDRESSES.custody, onProgress }) {
  if (!custodyAddress) throw new InayaValidationError("InayaKernel.anchorToLedger: custodyAddress is required (see contracts.js INAYA_ADDRESSES).");
  if (fileSizeBytes === undefined) throw new InayaValidationError("InayaKernel.anchorToLedger: fileSizeBytes is required — the contract's fee is computed per-GB from it.");

  try {
    emitProgress(onProgress, "anchor:progress", { stage: "hashing", fileName });
    const signer = await resolveSigner(connection);
    const contract = new ethers.Contract(custodyAddress, INAYA_CUSTODY_ABI, signer);

    const resolvedAssetId = assetId || `${fileName}-${Date.now()}`;
    const fileHash = ethers.id(resolvedAssetId); // bytes32 key — same key retrieveAndReconstruct() reads back with

    emitProgress(onProgress, "anchor:progress", { stage: "submitting", fileName, fileHash });
    const tx = await contract.batchRegisterAssets([fileHash], [fileSizeBytes], [dataShardAlpha], [dataShardBeta]);

    emitProgress(onProgress, "anchor:progress", { stage: "confirming", fileName, fileHash, transactionHash: tx.hash });
    const receipt = await tx.wait();

    const result = { transactionHash: receipt.hash, assetId: resolvedAssetId, fileHash };
    emitProgress(onProgress, "anchor:complete", result);
    return result;
  } catch (err) {
    const translated = translateError(err, "anchorToLedger");
    events.emit("error", { operation: "anchorToLedger", error: translated });
    throw translated;
  }
}

/**
 * Reads the live per-GB fees and approves both tokens for the given file
 * size, so anchorToLedger() doesn't revert on the internal transferFrom.
 * Call this once before anchorToLedger() for each new file.
 *
 * The read-only fee lookups retry automatically on transient RPC errors
 * (a flaky public RPC endpoint is common); the approval transactions
 * themselves are never auto-retried.
 */
async function approveFeeTokens({ connection, fileSizeBytes, custodyAddress = INAYA_ADDRESSES.custody, tokenAddress = INAYA_ADDRESSES.token, usdtAddress, onProgress }) {
  if (!custodyAddress) throw new InayaValidationError("InayaKernel.approveFeeTokens: custodyAddress is required.");

  try {
    emitProgress(onProgress, "approve:progress", { stage: "reading-fees" });
    const provider = resolveProvider(connection);
    const signer = await resolveSigner(connection);
    const custody = new ethers.Contract(custodyAddress, INAYA_CUSTODY_ABI, provider);

    const [usdtFeePerGB, inayaFeePerGB, resolvedUsdtAddress] = await Promise.all([
      withRetry(() => custody.usdtFeePerGB()),
      withRetry(() => custody.inayaFeePerGB()),
      usdtAddress ? Promise.resolve(usdtAddress) : withRetry(() => custody.usdtToken()),
    ]);

    const GB = 1073741824n;
    const usdtFee = (BigInt(fileSizeBytes) * usdtFeePerGB) / GB;
    const inayaFee = (BigInt(fileSizeBytes) * inayaFeePerGB) / GB;

    const usdt = new ethers.Contract(resolvedUsdtAddress, INAYA_TOKEN_ABI, signer);
    const inaya = new ethers.Contract(tokenAddress, INAYA_TOKEN_ABI, signer);

    if (usdtFee > 0n) {
      emitProgress(onProgress, "approve:progress", { stage: "approving-usdt", amount: usdtFee });
      await (await usdt.approve(custodyAddress, usdtFee)).wait();
    }
    if (inayaFee > 0n) {
      emitProgress(onProgress, "approve:progress", { stage: "approving-inaya", amount: inayaFee });
      await (await inaya.approve(custodyAddress, inayaFee)).wait();
    }

    const result = { usdtFee, inayaFee };
    emitProgress(onProgress, "approve:complete", result);
    return result;
  } catch (err) {
    const translated = translateError(err, "approveFeeTokens");
    events.emit("error", { operation: "approveFeeTokens", error: translated });
    throw translated;
  }
}

/**
 * Reads an asset's shard CIDs from Custody's assets(bytes32) mapping —
 * confirmed against the working dApp's own retrieval flow (page.js
 * handleRetrievalSequence), which reads via contract.assets(searchHash)
 * on this same Custody contract, not InayaNetwork.getAsset(). Filename
 * is not stored on-chain here — page.js resolves it from a local
 * getFilenameMapping() lookup; pass knownFilename if you have one.
 *
 * Read-only — works with just a provider, no signer needed, so this
 * works even with connection styles that have no signing capability.
 * The on-chain read and both shard fetches retry automatically on
 * transient failures — IPFS gateways in particular are prone to brief
 * timeouts that a second attempt often clears on its own.
 */
async function retrieveAndReconstruct({ connection, fileHash, assetId, passkey, knownFilename, custodyAddress = INAYA_ADDRESSES.custody, fetchShard = defaultFetchShard, onProgress }) {
  if (!custodyAddress) throw new InayaValidationError("InayaKernel.retrieveAndReconstruct: custodyAddress is required.");
  const resolvedFileHash = fileHash || (assetId ? ethers.id(assetId) : undefined);
  if (!resolvedFileHash) throw new InayaValidationError("InayaKernel.retrieveAndReconstruct: pass either fileHash or the original assetId used at anchorToLedger().");

  try {
    emitProgress(onProgress, "retrieve:progress", { stage: "reading-chain", fileHash: resolvedFileHash });
    const provider = resolveProvider(connection);
    const contract = new ethers.Contract(custodyAddress, INAYA_CUSTODY_ABI, provider);

    const [owner, cidAlpha, cidBeta, timestamp] = await withRetry(() => contract.assets(resolvedFileHash));
    if (!cidAlpha || !cidBeta || owner === ethers.ZeroAddress) {
      throw new InayaContractError(`No asset found for fileHash "${resolvedFileHash}".`, { code: "ASSET_NOT_FOUND", operation: "retrieveAndReconstruct" });
    }

    emitProgress(onProgress, "retrieve:progress", { stage: "fetching-shards", fileHash: resolvedFileHash });
    const [shardAlpha, shardBeta] = await Promise.all([
      withRetry(() => fetchShard(cidAlpha)),
      withRetry(() => fetchShard(cidBeta)),
    ]);

    emitProgress(onProgress, "retrieve:progress", { stage: "decrypting", fileHash: resolvedFileHash });
    const dataUrl = await reconstructAndDecrypt({ shardAlpha, shardBeta, passkey });

    const result = { name: knownFilename ?? null, owner, timestamp, dataUrl };
    emitProgress(onProgress, "retrieve:complete", result);
    return result;
  } catch (err) {
    const translated = translateError(err, "retrieveAndReconstruct");
    events.emit("error", { operation: "retrieveAndReconstruct", error: translated });
    throw translated;
  }
}

async function defaultFetchShard(cid) {
  const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
  if (!res.ok) throw new InayaNetworkError(`Failed to fetch shard ${cid} (HTTP ${res.status})`, { code: "SHARD_FETCH_FAILED", operation: "retrieveAndReconstruct" });
  const json = await res.json();
  return json.shard;
}

/**
 * Staking — thin wrapper around the deployed InayaStaking contract.
 * Handles the token approval step automatically before staking, since
 * INAYA transfers carry a fixed micro-fee (transferFee) the caller
 * should be aware of but doesn't need to compute manually.
 * Read-only calls (calculateReward, getStakedBalance) retry on transient
 * RPC errors; stake/unstake/claimReward transactions themselves do not.
 *
 * withdraw() and claimReward() are two separate on-chain actions (the
 * contract has no combined "unstake and pay out" function) — call
 * claimReward() explicitly if there's a pending reward, same as the web
 * dApp's own UI does with separate Withdraw and Claim Rewards buttons.
 */
const Staking = {
  async stake({ connection, amount, lockPeriodDays = 0, tokenAddress = INAYA_ADDRESSES.token, stakingAddress = INAYA_ADDRESSES.staking, onProgress }) {
    if (!tokenAddress || !stakingAddress) throw new InayaValidationError("InayaKernel.Staking.stake: tokenAddress and stakingAddress are required.");
    if (![0, 30, 90].includes(lockPeriodDays)) throw new InayaValidationError("InayaKernel.Staking.stake: lockPeriodDays must be 0 (flexible), 30, or 90.");
    try {
      const signer = await resolveSigner(connection);
      const owner = await signer.getAddress();

      const token = new ethers.Contract(tokenAddress, INAYA_TOKEN_ABI, signer);
      const currentAllowance = await withRetry(() => token.allowance(owner, stakingAddress));
      if (currentAllowance < amount) {
        emitProgress(onProgress, "stake:progress", { stage: "approving" });
        const approveTx = await token.approve(stakingAddress, amount);
        await approveTx.wait();
      }

      emitProgress(onProgress, "stake:progress", { stage: "staking" });
      const staking = new ethers.Contract(stakingAddress, INAYA_STAKING_ABI, signer);
      const tx = await staking.stake(amount, lockPeriodDays);
      const receipt = await tx.wait();
      const result = { transactionHash: receipt.hash };
      emitProgress(onProgress, "stake:complete", result);
      return result;
    } catch (err) {
      const translated = translateError(err, "Staking.stake");
      events.emit("error", { operation: "Staking.stake", error: translated });
      throw translated;
    }
  },

  /** Withdraws staked principal only — reverts if still inside the lock period. Call claimReward() separately for pending rewards. */
  async unstake({ connection, amount, stakingAddress = INAYA_ADDRESSES.staking }) {
    if (!stakingAddress) throw new InayaValidationError("InayaKernel.Staking.unstake: stakingAddress is required.");
    if (!amount) throw new InayaValidationError("InayaKernel.Staking.unstake: amount is required.");
    try {
      const signer = await resolveSigner(connection);
      const staking = new ethers.Contract(stakingAddress, INAYA_STAKING_ABI, signer);
      const tx = await staking.withdraw(amount);
      const receipt = await tx.wait();
      return { transactionHash: receipt.hash };
    } catch (err) {
      const translated = translateError(err, "Staking.unstake");
      events.emit("error", { operation: "Staking.unstake", error: translated });
      throw translated;
    }
  },

  /** Claims any pending reward balance — separate from unstake(), see the note above. */
  async claimReward({ connection, stakingAddress = INAYA_ADDRESSES.staking }) {
    if (!stakingAddress) throw new InayaValidationError("InayaKernel.Staking.claimReward: stakingAddress is required.");
    try {
      const signer = await resolveSigner(connection);
      const staking = new ethers.Contract(stakingAddress, INAYA_STAKING_ABI, signer);
      const tx = await staking.claimReward();
      const receipt = await tx.wait();
      return { transactionHash: receipt.hash };
    } catch (err) {
      const translated = translateError(err, "Staking.claimReward");
      events.emit("error", { operation: "Staking.claimReward", error: translated });
      throw translated;
    }
  },

  /** Read-only — retries on transient RPC errors. Works with any connection style, no signer needed. */
  async calculateReward({ connection, address, stakingAddress = INAYA_ADDRESSES.staking }) {
    if (!stakingAddress) throw new InayaValidationError("InayaKernel.Staking.calculateReward: stakingAddress is required.");
    try {
      const provider = resolveProvider(connection);
      const staking = new ethers.Contract(stakingAddress, INAYA_STAKING_ABI, provider);
      return await withRetry(() => staking.earned(address));
    } catch (err) {
      throw translateError(err, "Staking.calculateReward");
    }
  },

  async getStakedBalance({ connection, address, stakingAddress = INAYA_ADDRESSES.staking }) {
    if (!stakingAddress) throw new InayaValidationError("InayaKernel.Staking.getStakedBalance: stakingAddress is required.");
    try {
      const provider = resolveProvider(connection);
      const staking = new ethers.Contract(stakingAddress, INAYA_STAKING_ABI, provider);
      return await withRetry(() => staking.userStakedBalance(address));
    } catch (err) {
      throw translateError(err, "Staking.getStakedBalance");
    }
  },
};

export const InayaKernel = {
  generateSecureSalt,
  deriveVaultKey,
  disperseAndSlice,
  connectWallet,
  approveFeeTokens,
  anchorToLedger,
  retrieveAndReconstruct,
  Staking,
  Payments,
  Metadata,
  Analytics,
  events,
  errors: { InayaError, InayaValidationError, InayaWalletError, InayaContractError, InayaNetworkError },
};

// Also available as named imports (`import { InayaWalletError } from '@inaya-network/custody-sdk'`)
// for consumers who'd rather not reach through InayaKernel.errors for instanceof checks.
export { InayaError, InayaValidationError, InayaWalletError, InayaContractError, InayaNetworkError };

export default InayaKernel;