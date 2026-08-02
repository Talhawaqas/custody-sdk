// packages/react/src/index.d.ts
import type { ComponentType } from "react";
import type { WalletConnection, VaultKey } from "@inaya-network/custody-sdk";

export interface InayaConnectReadyPayload {
  connection: WalletConnection;
  vaultKey: VaultKey;
  /** Persist this yourself (e.g. keyed by wallet address) and pass it back in as the `salt` prop
   *  on future connects — a fresh random salt every session makes prior uploads undecryptable. */
  salt: Uint8Array;
  address: string;
}

export interface InayaConnectProps {
  onReady?: (payload: InayaConnectReadyPayload) => void;
  onError?: (err: unknown) => void;
  /** Reuse a previously-persisted salt instead of generating a new one. */
  salt?: Uint8Array;
  label?: string;
  className?: string;
}

export const InayaConnect: ComponentType<InayaConnectProps>;

export interface InayaUploaderProps {
  connection: WalletConnection;
  vaultKey: VaultKey;
  /** Pins one already-encrypted shard to your own IPFS backend and resolves with its CID. */
  pinShard: (shardContent: string, filename: string, tag: "Alpha" | "Beta") => Promise<string>;
  onComplete?: (receipt: { transactionHash: string; assetId: string; fileHash: string }) => void;
  onError?: (err: unknown) => void;
  className?: string;
}

export const InayaUploader: ComponentType<InayaUploaderProps>;

export interface InayaFileBrowserProps {
  connection: WalletConnection;
  owner: string;
  apiBaseUrl?: string;
  className?: string;
}

export const InayaFileBrowser: ComponentType<InayaFileBrowserProps>;
