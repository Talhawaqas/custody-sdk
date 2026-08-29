# @inaya-network/bridge-sdk

Cross-chain `$INAYA` transfer + cross-chain staking SDK (SOW-1). Separate from
`@inaya-network/custody-sdk` (file custody/upload) so that package's payload stays unchanged
for existing consumers.

## 1. Installation

```bash
npm install @inaya-network/bridge-sdk ethers
```

## 2. What This SDK Does

Wraps the on-chain bridge/staking-gateway contracts + the Inaya Network backend API
(`/api/bridge/*`) so you don't hand-build ABIs or poll Mongo-backed status yourself. It does
**not** run a relayer or hold validator keys — signing/quorum/destination-chain delivery is
handled by Inaya's own backend cron jobs.

## 3. Quick Start — Transfer

```js
import { ethers } from "ethers";
import { InayaBridgeClient, CHAIN_IDS } from "@inaya-network/bridge-sdk";

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const client = new InayaBridgeClient({ signer });

const chains = await client.getSupportedChains();
const home = chains.find((c) => c.chainId === CHAIN_IDS.BSC_TESTNET);

const { messageHash } = await client.bridgeTransfer({
  sourceChain: home,
  destChainId: CHAIN_IDS.SEPOLIA,
  amountWei: ethers.parseUnits("100", 18),
  recipient: await signer.getAddress(),
  userAddress: await signer.getAddress(),
});

// Poll until status is 'completed' or 'failed'.
const status = await client.getTransferStatus(messageHash);
```

## 4. Quick Start — Cross-Chain Stake

```js
const sepolia = chains.find((c) => c.chainId === CHAIN_IDS.SEPOLIA);
await client.stake({ chain: sepolia, amountWei: ethers.parseUnits("50", 18), lockPeriodDays: 30 });
```

## 5. Transfer Status Polling

`getTransferStatus(messageHash)` reflects the backend's Mongo record, which is the actual
source of truth for pending/completed/failed — not on-chain state alone (see
`CROSS_CHAIN_BRIDGE_GUIDE.md`'s design note on why). Poll every few seconds; there is no
webhook/push mechanism yet.

## 6. Error Handling

Every method throws a plain `Error` with the backend's `error` message, or ethers' own error
for on-chain failures (insufficient allowance, reverts, etc.) — check `err.message`.

## 7. Supported Chains Reference

Call `getSupportedChains()` rather than hardcoding addresses — contracts can be redeployed
(e.g. a v2 staking migration) and this is the single source of truth the dApp itself reads from.

## 8. TypeScript

`src/index.d.ts` ships basic types; contract/chain shapes are currently typed as `any` — refine
once the chain-config shape stabilizes.

## 9. Known Limitations

- No mobile wallet integration bundled — bring your own signer.
- No Solana support (see the separate `solana/` Anchor program; this SDK is EVM-only for now).
- `unstake`/`claimRewards` require the home chain's staking contract; cross-chain-initiated
  unstake/claim always settle from home, per the single-canonical-ledger design.
