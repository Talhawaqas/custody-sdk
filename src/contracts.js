// ============================================================
// contracts.js — ABI fragments matching the deployed InayaNetwork /
// InayaToken / InayaStaking contracts exactly (see InayaNetwork.sol
// provided by the team). Only the functions/events the SDK actually
// calls are included — extend as new methods are wired in.
// ============================================================

// ============================================================
// contracts.js — ABI fragments matching the deployed InayaNetwork /
// InayaCustody / InayaToken / InayaStaking contracts.
//
// By design, upload and download run through two separate contracts:
//   - Write (upload):   InayaCustody.batchRegisterAssets  (custody address)
//   - Read (download):  InayaNetwork.getAsset              (network address)
// ============================================================

// InayaNetwork — read side. getAsset() here is the download path.
export const INAYA_NETWORK_ABI = [
  "function registerAsset(string memory assetId, string memory filename, string memory cidAlpha, string memory cidBeta) public",
  "function getAsset(string memory assetId) public view returns (string memory filename, string memory cidAlpha, string memory cidBeta, uint256 timestamp, address operator)",
  "function getTokenAddresses() public view returns (address token, address staking)",
  "function inayaToken() public view returns (address)",
  "function inayaStaking() public view returns (address)",
  "function uploadFee() public view returns (uint256)",
  "function owner() public view returns (address)",
  "event AssetArchived(string assetId, string filename, string cidAlpha, string cidBeta, address operator)",
];

// InayaCustody — write side. batchRegisterAssets() here is the upload path.
export const INAYA_CUSTODY_ABI = [
  "function batchRegisterAssets(bytes32[] fileHashes, uint256[] fileSizes, string[] shardACIDs, string[] shardBCIDs) external",
  "function assets(bytes32) public view returns (address owner, string shardACID, string shardBCID, uint256 timestamp)",
  "function usdtToken() public view returns (address)",
  "function inayaToken() public view returns (address)",
  "function usdtFeePerGB() public view returns (uint256)",
  "function inayaFeePerGB() public view returns (uint256)",
];

export const INAYA_TOKEN_ABI = [
  "function balanceOf(address) public view returns (uint256)",
  "function allowance(address owner, address spender) public view returns (uint256)",
  "function approve(address spender, uint256 value) public returns (bool)",
  "function transfer(address to, uint256 value) public returns (bool)",
  "function transferFrom(address from, address to, uint256 value) public returns (bool)",
  "function decimals() public view returns (uint8)",
  "function transferFee() public view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
];

export const INAYA_STAKING_ABI = [
  "function stake(uint256 amount) public",
  "function unstake() public",
  "function calculateReward(address user) public view returns (uint256)",
  "function stakedBalance(address) public view returns (uint256)",
  "function stakingTimestamp(address) public view returns (uint256)",
  "event Staked(address indexed user, uint256 amount)",
  "event Unstaked(address indexed user, uint256 amount, uint256 reward)",
];

// Live deployed addresses for the target network.
export const INAYA_ADDRESSES = {
  network: "0x9dA15C2908C9A87Ac5af8c116d4092cB6569488e", // InayaNetwork — used for getAsset() (download/read)
  custody: "0x7F5E6cF1353beEE4fc19FD46Dd6EaD0B3895a888",  // InayaCustody — used for batchRegisterAssets() (upload/write)
  token: "0x3966a3378c8d9e6bb34dd0b8458eef4b878ce94e",     // InayaToken ($INAYA) contract address
  staking: "0xc465279444Cb0E10c69D0769CDae31E457eA660f",  // InayaStaking contract address
};