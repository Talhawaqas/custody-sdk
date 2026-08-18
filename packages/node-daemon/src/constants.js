// packages/node-daemon/src/constants.js

export const RPC_URL = process.env.INAYA_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545";
export const NODE_REGISTRY_ADDRESS =
  process.env.INAYA_NODE_REGISTRY_ADDRESS || "0xd12a38e8564d19797B19cF8F80b54DB09B3FD881";
export const API_BASE_URL = process.env.INAYA_API_BASE_URL || "https://www.inayanetwork.com";

// Only the two on-chain calls this daemon makes -- registration and nothing else. Commission
// settlement/release is verifier- and relayer-driven, not something the daemon itself touches.
export const NODE_REGISTRY_ABI = [
  "function registerNode(uint256 _capacityGB) external",
  "function nodes(address) view returns (address wallet, uint256 capacityGB, uint256 uptimeScore, uint8 tier, bool isRegistered, uint256 totalEarnedUsdt)",
];

export const HEARTBEAT_INTERVAL_MS = Number(process.env.INAYA_HEARTBEAT_INTERVAL_MS) || 5 * 60 * 1000; // 5 min default
