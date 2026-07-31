// src/contracts.d.ts
// Type definitions matching contracts.js exactly — see that file for the
// actual ABI fragments, which are kept as plain string arrays (ethers v6
// parses human-readable ABI strings directly).

export const INAYA_NETWORK_ABI: readonly string[];
export const INAYA_CUSTODY_ABI: readonly string[];
export const INAYA_TOKEN_ABI: readonly string[];
export const INAYA_STAKING_ABI: readonly string[];

export interface InayaAddresses {
  /** InayaNetwork — registerAsset/getAsset (currently unused by the default SDK flow; see index.js comments). */
  network: string;
  /** InayaCustody — batchRegisterAssets/assets, the contract anchorToLedger() and retrieveAndReconstruct() actually use. */
  custody: string;
  /** InayaToken ($INAYA). */
  token: string;
  /** InayaStaking. */
  staking: string;
}

export const INAYA_ADDRESSES: InayaAddresses;