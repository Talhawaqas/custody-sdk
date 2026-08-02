# create-inaya-dapp

`npx create-inaya-dapp` — the "Day-1" onboarding experience: a pre-wired Next.js app instead of starting from a blank folder.

## Usage

```bash
npx create-inaya-dapp my-app
cd my-app
npm install
npm run dev
```

Pick a template with `--template`:

```bash
npx create-inaya-dapp my-app --template vault
```

## Available templates

| Name | What it is |
|---|---|
| `vault` | **Inaya Vault Template** — a decentralized personal storage app: wallet connect (wagmi/viem), passkey-based client-side encryption, drag-and-drop upload, on-chain anchoring. Fully wired and functional once you add a Pinata JWT. |

**Not yet built:** the "Inaya Media dApp" template (fetch + decrypt assets for viewing) from the original scope of work. Rather than ship a half-working second template alongside a solid first one, it's left as a clearly-scoped follow-up — it would reuse this same template's wallet/SDK wiring, plus `InayaKernel.retrieveAndReconstruct()` for the fetch/decrypt/render side.

## How this works

Deliberately dependency-free: `bin/create-inaya-dapp.js` copies `templates/<name>/` to your target directory via `fs.cpSync`, fills in your project name in the generated `package.json`, and copies `.env.example` to `.env.local`. No network calls, no template-engine dependency to install first.
