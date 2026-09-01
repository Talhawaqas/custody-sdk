// src/appStore.d.ts
// Type definitions matching appStore.js exactly.

import type { WalletConnection } from "./index";

export type AppStoreHostType = "ipfs" | "iframe";
export type AppStoreListingStatus = "pending" | "approved" | "rejected";

export interface SubmitListingParams {
  connection: WalletConnection;
  name: string;
  description: string;
  category?: string;
  hostType: AppStoreHostType;
  cid?: string;
  embedUrl?: string;
  apiBaseUrl?: string;
}

export interface AppStoreThreatCheck {
  checked: boolean;
  indicator?: string;
  known?: boolean;
  statusLabel?: string;
  category?: number | null;
  error?: string;
}

export interface AppStoreListing {
  slug: string;
  name: string;
  description: string;
  category: string;
  hostType: AppStoreHostType;
  cid: string | null;
  embedUrl: string | null;
  submitterAddress: string;
  status: AppStoreListingStatus;
  threatCheck: AppStoreThreatCheck;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByAdmin: boolean;
  reviewNote: string | null;
}

export interface GetListingsParams {
  apiBaseUrl?: string;
}

export interface GetListingsResult {
  listings: AppStoreListing[];
}

export interface GetMyListingsParams {
  address: string;
  apiBaseUrl?: string;
}

export interface AppStoreAPI {
  submitListing(params: SubmitListingParams): Promise<{ slug: string; status: AppStoreListingStatus }>;
  getListings(params?: GetListingsParams): Promise<GetListingsResult>;
  getMyListings(params: GetMyListingsParams): Promise<GetListingsResult>;
}

export const AppStore: AppStoreAPI;
