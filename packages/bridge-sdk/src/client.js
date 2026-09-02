import { ethers } from "ethers";

const BRIDGE_HOME_ABI = ["function bridgeOut(uint256 destChainId, bytes32 recipient, uint256 amount) external returns (bytes32)"];
const BRIDGE_SPOKE_ABI = ["function bridgeToHome(bytes32 recipient, uint256 amount) external returns (bytes32)"];
const STAKING_GATEWAY_SPOKE_ABI = ["function stakeCrossChain(uint256 amount, uint256 lockPeriodDays) external returns (bytes32)"];
const STAKING_ABI = [
  "function stake(uint256 amount, uint256 lockPeriodDays) external",
  "function withdrawTo(uint256 amount, uint256 destChainId, bytes32 destRecipient) external returns (bytes32)",
  "function claimRewardTo(uint256 destChainId, bytes32 destRecipient) external returns (bytes32)",
];
const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];
const MESSENGER_SENT_ABI = [
  "event MessageSent(bytes32 indexed messageId, tuple(uint256 sourceChainId, bytes32 sourceContract, uint256 destChainId, bytes32 destContract, uint256 nonce, uint8 msgType, bytes payload) message)",
];

/**
 * @typedef {Object} InayaBridgeClientOptions
 * @property {string} [apiBaseUrl]
 * @property {import('ethers').Signer} [signer]
 * @property {Object<number, {bridge?: string, inayaToken?: string, staking?: string, stakingGateway?: string}>} [pinnedContracts]
 *   Optional, keyed by chainId. getSupportedChains() intentionally fetches contract addresses
 *   from `apiBaseUrl` at runtime rather than hardcoding them (so this SDK doesn't go stale after a
 *   redeploy) -- but that also means a compromised/malicious `apiBaseUrl` could hand back an
 *   attacker's own contract address for bridgeTransfer()/stake() to approve() and call into. If
 *   you know your deployment's real addresses (recommended for production/mainnet use), pass them
 *   here; every mutating call below then verifies the chain object it was given against this
 *   allowlist before touching a signer, and throws rather than silently proceeding on a mismatch.
 */

export class InayaBridgeClient {
  /** @param {InayaBridgeClientOptions} options */
  constructor({ apiBaseUrl = "https://inayanetwork.com", signer, pinnedContracts } = {}) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.signer = signer;
    this.pinnedContracts = pinnedContracts || null;
  }

  /** Throws if `address` isn't even well-formed, and (when pinning is configured for this
   *  chainId) throws unless it exactly matches the pinned address for `contractKey`. Called right
   *  before every approve()/contract-call site below uses an address sourced from a chain config
   *  object, whether that object came from getSupportedChains() or was constructed by the caller. */
  _verifyContractAddress(chainId, contractKey, address) {
    if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
      throw new Error(`InayaBridgeClient: "${contractKey}" for chain ${chainId} is not a valid address.`);
    }
    const pinned = this.pinnedContracts?.[chainId]?.[contractKey];
    if (pinned && ethers.getAddress(pinned) !== ethers.getAddress(address)) {
      throw new Error(`InayaBridgeClient: "${contractKey}" for chain ${chainId} (${address}) doesn't match the pinned address (${pinned}) -- refusing to sign.`);
    }
  }

  async _fetch(path, options) {
    const res = await fetch(`${this.apiBaseUrl}${path}`, options);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || `Request to ${path} failed`);
    return data;
  }

  async getSupportedChains() {
    const data = await this._fetch("/api/bridge/supported-chains");
    return data.chains;
  }

  async getTransferStatus(messageHash) {
    const data = await this._fetch(`/api/bridge/transfer-status/${messageHash}`);
    return data.transfer;
  }

  async getStakingPosition(address) {
    const data = await this._fetch(`/api/bridge/staking-position/${address}`);
    return data.position;
  }

  _requireSigner() {
    if (!this.signer) throw new Error("InayaBridgeClient requires a signer for this method");
    return this.signer;
  }

  async _extractMessageSent(receipt) {
    const iface = new ethers.Interface(MESSENGER_SENT_ABI);
    const event = receipt.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "MessageSent");
    if (!event) throw new Error("MessageSent event not found in transaction receipt");
    return { messageHash: event.args.messageId, message: event.args.message };
  }

  /**
   * Bridges $INAYA from `sourceChain` (isHome + inaya token + bridge address) to `destChainId`.
   * @param {{ sourceChain: object, destChainId: number, amountWei: bigint, recipient: string, userAddress: string }} params
   */
  async bridgeTransfer({ sourceChain, destChainId, amountWei, recipient, userAddress }) {
    const signer = this._requireSigner();
    const recipientBytes32 = ethers.zeroPadValue(recipient, 32);
    let tx;

    if (sourceChain.isHome) {
      this._verifyContractAddress(sourceChain.chainId, "inayaToken", sourceChain.contracts.inayaToken);
      this._verifyContractAddress(sourceChain.chainId, "bridge", sourceChain.contracts.bridge);
      const fee = 100000000000000n; // InayaToken's flat 0.0001-token transfer fee, home side only
      const token = new ethers.Contract(sourceChain.contracts.inayaToken, ERC20_ABI, signer);
      await (await token.approve(sourceChain.contracts.bridge, amountWei + fee)).wait();
      const bridge = new ethers.Contract(sourceChain.contracts.bridge, BRIDGE_HOME_ABI, signer);
      tx = await bridge.bridgeOut(destChainId, recipientBytes32, amountWei);
    } else {
      this._verifyContractAddress(sourceChain.chainId, "bridge", sourceChain.contracts.bridge);
      const bridge = new ethers.Contract(sourceChain.contracts.bridge, BRIDGE_SPOKE_ABI, signer);
      tx = await bridge.bridgeToHome(recipientBytes32, amountWei);
    }

    const receipt = await tx.wait();
    const { messageHash, message } = await this._extractMessageSent(receipt);

    await this._fetch("/api/bridge/initiate-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageHash,
        sourceChainId: sourceChain.chainId,
        destChainId,
        amount: amountWei.toString(),
        userAddress,
        sourceTxHash: tx.hash,
        message: {
          sourceChainId: message.sourceChainId.toString(),
          sourceContract: message.sourceContract,
          destChainId: message.destChainId.toString(),
          destContract: message.destContract,
          nonce: message.nonce.toString(),
          msgType: message.msgType,
          payload: message.payload,
        },
      }),
    });

    return { messageHash, sourceTxHash: tx.hash };
  }

  /** Stakes on the home chain directly, or cross-chain from a spoke via its staking gateway. */
  async stake({ chain, amountWei, lockPeriodDays }) {
    const signer = this._requireSigner();
    if (chain.isHome) {
      this._verifyContractAddress(chain.chainId, "staking", chain.contracts.staking);
      const staking = new ethers.Contract(chain.contracts.staking, STAKING_ABI, signer);
      const tx = await staking.stake(amountWei, lockPeriodDays);
      return tx.wait();
    }
    this._verifyContractAddress(chain.chainId, "stakingGateway", chain.contracts.stakingGateway);
    const gateway = new ethers.Contract(chain.contracts.stakingGateway, STAKING_GATEWAY_SPOKE_ABI, signer);
    const tx = await gateway.stakeCrossChain(amountWei, lockPeriodDays);
    return tx.wait();
  }

  /** Unstakes on home, paid out to `destChainId` (use the home chainId for a local payout). */
  async unstake({ homeChain, amountWei, destChainId, destRecipient, userAddress }) {
    const signer = this._requireSigner();
    this._verifyContractAddress(homeChain.chainId, "staking", homeChain.contracts.staking);
    const staking = new ethers.Contract(homeChain.contracts.staking, STAKING_ABI, signer);
    const tx = await staking.withdrawTo(amountWei, destChainId, ethers.zeroPadValue(destRecipient, 32));
    const receipt = await tx.wait();
    const { messageHash, message } = await this._extractMessageSent(receipt);
    await this._fetch("/api/bridge/unstake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageHash, destChainId, amount: amountWei.toString(), userAddress, sourceTxHash: tx.hash, message }),
    });
    return { messageHash, sourceTxHash: tx.hash };
  }

  /** Claims rewards on home, paid out to `destChainId`. */
  async claimRewards({ homeChain, destChainId, destRecipient, userAddress }) {
    const signer = this._requireSigner();
    this._verifyContractAddress(homeChain.chainId, "staking", homeChain.contracts.staking);
    const staking = new ethers.Contract(homeChain.contracts.staking, STAKING_ABI, signer);
    const tx = await staking.claimRewardTo(destChainId, ethers.zeroPadValue(destRecipient, 32));
    const receipt = await tx.wait();
    const { messageHash, message } = await this._extractMessageSent(receipt);
    await this._fetch("/api/bridge/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageHash, destChainId, amount: "0", userAddress, sourceTxHash: tx.hash, message }),
    });
    return { messageHash, sourceTxHash: tx.hash };
  }
}
