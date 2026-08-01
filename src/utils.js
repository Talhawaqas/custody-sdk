// src/utils.js
//
// Shared robustness helpers: retry-with-backoff for genuinely transient
// failures, and a minimal zero-dependency event emitter so consumers can
// subscribe to lifecycle events instead of (or alongside) using the
// per-call onProgress callbacks.

/**
 * Retries an async operation with exponential backoff — but ONLY for
 * errors classified as transient (network/RPC issues). Never retries a
 * reverted transaction or a user's wallet rejection: blindly resubmitting
 * either wastes gas on a call that will fail again, or risks double-
 * spending if the "failed" transaction actually succeeded on-chain.
 */
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, isRetryable = defaultIsRetryable, onRetry } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      onRetry?.({ attempt: attempt + 1, maxRetries: retries, delayMs: delay, error: err });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Default retryable-error classifier. Deliberately conservative: contract
 * reverts (CALL_EXCEPTION) and user rejections (ACTION_REJECTED) are never
 * retried, since retrying those doesn't help and could be actively harmful.
 * Only genuine network/timeout/RPC-flakiness errors are retried.
 */
export function defaultIsRetryable(err) {
  const code = err?.code;
  if (code === "CALL_EXCEPTION" || code === "ACTION_REJECTED" || code === "INSUFFICIENT_FUNDS") return false;
  // HTTP_5xx (payments.js/metadata.js's own backend-route errors) are server-side and
  // typically transient — retry them. HTTP_4xx (bad request, unauthorized, not found, etc.)
  // is a client-side problem retrying can't fix, so those deliberately fall through to false.
  if (typeof code === "string" && /^HTTP_5\d\d$/.test(code)) return true;
  const msg = (err?.message || "").toLowerCase();
  return (
    code === "NETWORK_ERROR" ||
    code === "TIMEOUT" ||
    code === "SERVER_ERROR" ||
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  );
}

/**
 * Minimal event emitter — zero dependencies, works identically in the
 * browser and in Node. InayaKernel.events is one shared instance of this,
 * emitting lifecycle events (e.g. "anchor:progress", "retrieve:complete",
 * "error") alongside the promise-based return values, for consumers who
 * prefer subscribing once rather than threading a callback through every call.
 */
export class InayaEventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return this; // chainable
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
    return this;
  }

  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        // A listener throwing should never break the actual SDK operation it's observing.
        console.error(`InayaKernel: listener for "${event}" threw:`, err);
      }
    });
  }
}