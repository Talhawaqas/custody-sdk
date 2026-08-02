# @inaya-network/react

Drop-in React + Tailwind components for [`@inaya-network/custody-sdk`](../../README.md) — you don't need to build your own upload widget, file browser, or wallet-connect button from scratch.

**Requires Tailwind already configured in your app** — this package ships utility-class-styled JSX, not compiled CSS. Add this package's path to your `tailwind.config.js`'s `content` array so Tailwind picks up the classes:
```js
content: ["./src/**/*.{js,jsx}", "./node_modules/@inaya-network/react/src/**/*.{js,jsx}"]
```

## Install

```bash
npm install @inaya-network/react @inaya-network/custody-sdk ethers react react-dom
```

## Components

### `<InayaConnect />`

Wallet connect button that also derives the vault key — one component instead of wiring `connectWallet()` + `deriveVaultKey()` yourself.

```jsx
import { InayaConnect } from "@inaya-network/react";

function App() {
  const [ready, setReady] = useState(null); // { connection, vaultKey, salt, address }
  return <InayaConnect onReady={setReady} />;
}
```

**Read this before shipping:** a vault key is derived from `passkey + salt`. If you don't persist the `salt` this component surfaces in `onReady` (e.g. keyed by wallet address, in your own backend), a fresh random salt gets generated every session and files encrypted in one session become permanently undecryptable the next. Pass a previously-persisted salt back in as the `salt` prop.

### `<InayaUploader />`

Drag-and-drop upload, wired to the SDK's real progress callbacks.

```jsx
import { InayaUploader } from "@inaya-network/react";

<InayaUploader
  connection={connection}
  vaultKey={vaultKey}
  pinShard={(shardContent, filename, tag) => yourPinningApi(shardContent, filename, tag)}
  onComplete={(receipt) => console.log(receipt.fileHash)}
/>
```

`pinShard` is required, not hardcoded — pinning is backend-specific (every app deploys its own IPFS pinning route), same reasoning as the SDK's `Payments`/`Metadata` clients being bring-your-own-backend.

### `<InayaFileBrowser />`

A decentralized-Drive-style browser over the SDK's `Metadata` client (folders, rename, move, delete, share). See `custody-sdk/SDK_GUIDE.md` §9 for why this is an off-chain layer — `InayaCustody` itself is write-once, confirmed by live `eth_call` testing.

```jsx
import { InayaFileBrowser } from "@inaya-network/react";

<InayaFileBrowser connection={connection} owner={address} apiBaseUrl="https://your-backend.example" />
```

Needs the same reference backend routes documented in `custody-sdk/examples/nextjs-metadata-api-routes.js` deployed on your end.

## What this package does NOT do

Same as the SDK it wraps: no secrets, no bundled backend. `InayaUploader` needs a `pinShard` implementation you provide; `InayaFileBrowser` needs the Metadata backend routes deployed. This package is the UI layer only.

## Storybook

```bash
npm run storybook        # live dev server at localhost:6006
npm run build-storybook  # static site -> storybook-static/
```

Every push to `main` that touches this package auto-deploys the latest Storybook to GitHub Pages via `.github/workflows/storybook.yml`. Stories intentionally show each component's real initial/idle state rather than mocking a live wallet or backend — `InayaFileBrowser`'s story, for instance, shows its actual "failed to fetch" error state when no real `apiBaseUrl` is configured, which is expected in isolation, not a bug.

