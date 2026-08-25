// src/errors.js
//
// Standardized SDK error hierarchy. Every InayaKernel operation that talks
// to a wallet, RPC provider, or contract throws one of these instead of a
// raw ethers/JSON-RPC/MetaMask error — callers can rely on a stable
// `.code` and a human-readable `.message` regardless of which wallet or
// RPC provider actually produced the failure. The original error is
// always preserved on `.cause` for debugging/logging.

export class InayaError extends Error {
  constructor(message, { code, operation, cause } = {}) {
    super(message);
    this.name = "InayaError";
    this.code = code || "UNKNOWN";
    this.operation = operation;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Bad/missing arguments caught before anything touched a wallet or the network — always safe to retry immediately after fixing the call. */
export class InayaValidationError extends InayaError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "VALIDATION_ERROR" });
    this.name = "InayaValidationError";
  }
}

/** The connected wallet rejected, is missing, or can't cover the transaction — user-actionable, not a bug. */
export class InayaWalletError extends InayaError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "WALLET_ERROR" });
    this.name = "InayaWalletError";
  }
}

/** The contract reverted, or gas estimation failed because it would have. Never safe to retry as-is. */
export class InayaContractError extends InayaError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "CONTRACT_ERROR" });
    this.name = "InayaContractError";
  }
}

/** Transient RPC/network/IPFS-gateway failure — the same class withRetry() already retries automatically before ever surfacing one of these. */
export class InayaNetworkError extends InayaError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "NETWORK_ERROR" });
    this.name = "InayaNetworkError";
  }
}

/** A local AEAD decryption failed — wrong password, or a corrupted/tampered
 *  backup file (see passkeyBackup.js). Deliberately one error/message for
 *  both causes: AES-GCM makes them cryptographically indistinguishable by
 *  design, and telling them apart would leak a password-guessing oracle. */
export class InayaDecryptionError extends InayaError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "DECRYPTION_FAILED" });
    this.name = "InayaDecryptionError";
  }
}

/**
 * Translates a raw ethers/JSON-RPC/wallet error into a clean InayaError
 * subclass with a human-readable message. Idempotent — an error that's
 * already an InayaError (or one of its subclasses) passes through
 * unchanged rather than getting double-wrapped. Anything unrecognized
 * still becomes a generic InayaError wrapping the original, so callers
 * can always safely do `err instanceof InayaError`.
 */
export function translateError(err, operation) {
  if (err instanceof InayaError) return err;

  const code = err?.code;
  const rawMessage = err?.shortMessage || err?.reason || err?.info?.error?.message || err?.message || String(err);

  // EIP-1193 code 4001 / ethers "ACTION_REJECTED" — user closed the wallet
  // prompt or hit Reject. Not a failure worth alarming anyone about.
  if (code === "ACTION_REJECTED" || code === 4001 || /user rejected|user denied/i.test(rawMessage)) {
    return new InayaWalletError("The wallet request was rejected.", { code: "USER_REJECTED", operation, cause: err });
  }

  if (code === "INSUFFICIENT_FUNDS") {
    return new InayaWalletError("Insufficient funds to cover the transaction amount and gas.", { code: "INSUFFICIENT_FUNDS", operation, cause: err });
  }

  if (
    typeof err?.message === "string" &&
    /no provider|no signer|not ready|call connectwallet/i.test(err.message) &&
    !(err instanceof InayaError)
  ) {
    return new InayaWalletError(err.message, { code: "NO_CONNECTION", operation, cause: err });
  }

  // ethers throws this (code INVALID_ARGUMENT) when `connection` is truthy
  // but structurally not a real EIP-1193 provider or Signer — e.g. `{}` or
  // a plain object missing .request()/.getAddress(). Still a "bad
  // connection" problem from the caller's perspective, not a generic error.
  if (code === "INVALID_ARGUMENT" && /provider|signer/i.test(rawMessage)) {
    return new InayaWalletError(`Invalid wallet connection: ${rawMessage}`, { code: "INVALID_CONNECTION", operation, cause: err });
  }

  // Gas estimation/limit problems — this is the exact class of error the
  // mobile app's upload flow actually hit in production (MetaMask silently
  // picking a far more conservative default than an explicit estimate).
  if (
    code === "UNPREDICTABLE_GAS_LIMIT" ||
    /gas required exceeds allowance|out of gas|intrinsic gas too low|cannot estimate gas/i.test(rawMessage)
  ) {
    return new InayaContractError(
      "Gas estimation failed — the transaction would likely revert, or the gas limit was set too low.",
      { code: "GAS_ERROR", operation, cause: err }
    );
  }

  // Contract execution reverted — surface ethers' parsed revert reason
  // when it managed to decode one, rather than the raw low-level message.
  if (code === "CALL_EXCEPTION") {
    const reason = err?.reason || err?.shortMessage || "The transaction would revert.";
    return new InayaContractError(reason, { code: "CONTRACT_REVERTED", operation, cause: err });
  }

  if (
    code === "NETWORK_ERROR" ||
    code === "TIMEOUT" ||
    code === "SERVER_ERROR" ||
    /timeout|network|fetch failed|failed to fetch|econnreset|socket hang up/i.test(rawMessage)
  ) {
    return new InayaNetworkError(rawMessage, { code: code || "NETWORK_ERROR", operation, cause: err });
  }

  return new InayaError(rawMessage, { code: typeof code === "string" ? code : "UNKNOWN", operation, cause: err });
}
