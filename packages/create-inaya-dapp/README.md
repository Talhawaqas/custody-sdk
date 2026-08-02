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
| `vault` (default) | **Inaya Vault Template** — a decentralized personal storage app: wallet connect (wagmi/viem), passkey-based client-side encryption, drag-and-drop upload, on-chain anchoring. Fully wired and functional once you add a Pinata JWT. |
| `media` | **Inaya Media Viewer Template** — the read counterpart to `vault`: fetch an already-anchored asset by `fileHash`, decrypt it locally via `retrieveAndReconstruct()`, and render a type-appropriate preview (image/video/audio/PDF). No Pinata JWT needed — this one only reads. |

Both templates work together: anchor a file with `vault`, then view it back with `media` using the resulting `fileHash`.

## How this works

Deliberately dependency-free: `bin/create-inaya-dapp.js` copies `templates/<name>/` to your target directory via `fs.cpSync`, fills in your project name in the generated `package.json`, and copies `.env.example` to `.env.local`. No network calls, no template-engine dependency to install first.
