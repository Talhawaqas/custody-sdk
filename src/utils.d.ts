// src/utils.d.ts
// Type definitions matching utils.js exactly — see that file for implementation.

export interface RetryOptions {
  /** @default 3 */
  retries?: number;
  /** @default 500 */
  baseDelayMs?: number;
  /** @default defaultIsRetryable */
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (info: { attempt: number; maxRetries: number; delayMs: number; error: unknown }) => void;
}

/** Retries an async operation with exponential backoff, but only for transient errors — never contract reverts or wallet rejections. */
export function withRetry<T>(fn: (attempt: number) => Promise<T>, options?: RetryOptions): Promise<T>;

/** Default retryable-error classifier — network/timeout/RPC errors only, never CALL_EXCEPTION/ACTION_REJECTED/INSUFFICIENT_FUNDS. */
export function defaultIsRetryable(err: unknown): boolean;

export type EventHandler<T = unknown> = (payload: T) => void;

/** Minimal zero-dependency event emitter used internally as InayaKernel.events. */
export class InayaEventEmitter<EventMap extends object = Record<string, unknown>> {
  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this;
  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this;
  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this;
  emit<K extends keyof EventMap>(event: K, payload?: EventMap[K]): void;
}