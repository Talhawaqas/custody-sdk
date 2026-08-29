import type { Signer } from "ethers";

export interface InayaBridgeClientOptions {
  apiBaseUrl?: string;
  signer?: Signer;
}

export declare class InayaBridgeClient {
  constructor(options?: InayaBridgeClientOptions);
  getSupportedChains(): Promise<any[]>;
  getTransferStatus(messageHash: string): Promise<any>;
  getStakingPosition(address: string): Promise<any>;
  bridgeTransfer(params: {
    sourceChain: any;
    destChainId: number;
    amountWei: bigint;
    recipient: string;
    userAddress: string;
  }): Promise<{ messageHash: string; sourceTxHash: string }>;
  stake(params: { chain: any; amountWei: bigint; lockPeriodDays: number }): Promise<any>;
  unstake(params: {
    homeChain: any;
    amountWei: bigint;
    destChainId: number;
    destRecipient: string;
    userAddress: string;
  }): Promise<{ messageHash: string; sourceTxHash: string }>;
  claimRewards(params: {
    homeChain: any;
    destChainId: number;
    destRecipient: string;
    userAddress: string;
  }): Promise<{ messageHash: string; sourceTxHash: string }>;
}

export declare const CHAIN_IDS: { BSC_TESTNET: number; SEPOLIA: number; AMOY: number; FUJI: number };
export declare const SOLANA_DEVNET_CHAIN_ID: number;
