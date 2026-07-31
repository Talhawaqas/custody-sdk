// src/payments.d.ts
// Type definitions matching payments.js exactly. IMPORTANT — every function
// here calls a backend route that must already be deployed on your own
// server (see the backend-demo folder for the actual route implementations).
// This module never contains Stripe secret keys, the treasury wallet's
// private key, or database credentials — those can't safely ship to a browser.

export interface CheckoutResult {
  checkoutUrl: string;
}

export interface StartCorporateReserveCheckoutParams {
  tier: string;
  /** @default "" (same-origin relative paths) */
  apiBaseUrl?: string;
}

export interface StartPaygCheckoutParams {
  filename: string;
  sizeBytes: number | string;
  cidAlpha: string;
  cidBeta: string;
  fileHash: string;
  apiBaseUrl?: string;
}

export interface StartPaygCheckoutResult extends CheckoutResult {
  quotedUsd: string;
}

export interface StartEgressCheckoutParams {
  fileHash: string;
  filename: string;
  sizeBytes: number | string;
  apiBaseUrl?: string;
}

export interface StartEgressCheckoutResult extends CheckoutResult {
  quotedUsd: string;
  inayaPriceUsdt: number;
}

export interface ResolveCheckoutSessionParams {
  sessionId: string;
  apiBaseUrl?: string;
}

export interface WhoAmIResult {
  email: string | null;
}

export interface ApiBaseUrlParams {
  apiBaseUrl?: string;
}

export interface CorporatePlanStatusParams extends ApiBaseUrlParams {
  /** Optional if the identifying cookie from resolveCheckoutSession() is already set. */
  email?: string;
}

export interface CorporatePlanStatusResult {
  active: boolean;
  tier?: string;
  activatedAt?: number;
  expiresAt?: number;
  routerTxHash?: string;
  escrowTxHash?: string;
}

export interface PaygAsset {
  filename: string;
  fileHash: string;
  sizeBytes: number;
  txHash: string;
  uploadedAt: number;
}

export interface PaygAssetsResult {
  assets: PaygAsset[];
}

export interface EgressUnlockStatusParams extends ApiBaseUrlParams {
  fileHash: string;
  email?: string;
}

export interface EgressUnlockStatusResult {
  unlocked: boolean;
}

export function startCorporateReserveCheckout(params: StartCorporateReserveCheckoutParams): Promise<CheckoutResult>;
export function startPaygCheckout(params: StartPaygCheckoutParams): Promise<StartPaygCheckoutResult>;
export function startEgressCheckout(params: StartEgressCheckoutParams): Promise<StartEgressCheckoutResult>;
export function resolveCheckoutSession(params: ResolveCheckoutSessionParams): Promise<WhoAmIResult>;
export function whoAmI(params?: ApiBaseUrlParams): Promise<WhoAmIResult>;
export function getCorporatePlanStatus(params?: CorporatePlanStatusParams): Promise<CorporatePlanStatusResult>;
export function getPaygAssets(params?: CorporatePlanStatusParams): Promise<PaygAssetsResult>;
export function getEgressUnlockStatus(params: EgressUnlockStatusParams): Promise<EgressUnlockStatusResult>;

export interface PaymentsAPI {
  startCorporateReserveCheckout: typeof startCorporateReserveCheckout;
  startPaygCheckout: typeof startPaygCheckout;
  startEgressCheckout: typeof startEgressCheckout;
  resolveCheckoutSession: typeof resolveCheckoutSession;
  whoAmI: typeof whoAmI;
  getCorporatePlanStatus: typeof getCorporatePlanStatus;
  getPaygAssets: typeof getPaygAssets;
  getEgressUnlockStatus: typeof getEgressUnlockStatus;
}

export const Payments: PaymentsAPI;