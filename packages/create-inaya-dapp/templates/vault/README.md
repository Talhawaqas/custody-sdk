# Inaya Vault Template

A decentralized personal storage app, pre-wired with:

- **@inaya-network/custody-sdk** (via git dependency, same as `inaya-mobile`) — encryption, sharding, on-chain anchoring.
- **wagmi + viem**, configured for BNB Chain Testnet — drives the wallet-connect UX; the SDK itself still takes a plain `{ provider: window.ethereum, address }` object once connected, same as the real Inaya web dApp.
- **Tailwind CSS**, already configured.
- A working `/api/upload` route that pins to Pinata — you only need to add your own `PINATA_JWT`.

## Get started

```bash
npm install
cp .env.example .env.local   # already done for you by create-inaya-dapp, just fill in PINATA_JWT
npm run dev
```

## About `@inaya-network/react`

This template's `app/page.js` is hand-rolled (drag/drop input, passkey field, progress states) rather than using `@inaya-network/react`'s `<InayaConnect/>`/`<InayaUploader/>` components — that package isn't published anywhere outside the `custody-sdk` monorepo yet (see that repo's Module 4: NPM Publishing). Once it is, swap in:

```jsx
import { InayaUploader } from "@inaya-network/react";
```

and delete most of the hand-rolled upload logic in this page.

## Retrieval

This template doesn't yet include a retrieve/download page — `InayaKernel.retrieveAndReconstruct()` is exactly what you'd wire up next, following the same pattern the SDK's own `examples/node-script.mjs` demonstrates.
