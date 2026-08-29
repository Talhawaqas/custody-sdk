// Mirrors inaya-network-dapp/src/lib/chains.js's shape (deliberate duplication, matching this
// codebase's own small-per-package-copy-over-shared-coupling convention) -- consumers should
// prefer fetching /api/bridge/supported-chains at runtime over hardcoding these, since contract
// addresses can be redeployed.
export const CHAIN_IDS = {
  BSC_TESTNET: 97,
  SEPOLIA: 11155111,
  AMOY: 80002,
  FUJI: 43113,
};

export const SOLANA_DEVNET_CHAIN_ID = 1_000_000_002;
