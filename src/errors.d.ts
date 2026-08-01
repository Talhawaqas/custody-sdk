// src/errors.d.ts
// Type definitions matching errors.js exactly.

export interface InayaErrorOptions {
  code?: string;
  operation?: string;
  cause?: unknown;
}

export class InayaError extends Error {
  readonly code: string;
  readonly operation?: string;
  readonly cause?: unknown;
  constructor(message: string, opts?: InayaErrorOptions);
}

export class InayaValidationError extends InayaError {
  constructor(message: string, opts?: InayaErrorOptions);
}

export class InayaWalletError extends InayaError {
  constructor(message: string, opts?: InayaErrorOptions);
}

export class InayaContractError extends InayaError {
  constructor(message: string, opts?: InayaErrorOptions);
}

export class InayaNetworkError extends InayaError {
  constructor(message: string, opts?: InayaErrorOptions);
}

/** Translates a raw ethers/JSON-RPC/wallet error into a clean InayaError subclass. Idempotent. */
export function translateError(err: unknown, operation?: string): InayaError;
