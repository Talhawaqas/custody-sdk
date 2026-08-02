# Inaya Network — open-source ecosystem packages

This monorepo (npm workspaces) hosts the SDK's surrounding ecosystem, alongside `@inaya-network/custody-sdk` itself at the repo root:

| Package | What it is |
|---|---|
| [`react`](./react) | `@inaya-network/react` — drop-in React + Tailwind components (`InayaConnect`, `InayaUploader`, `InayaFileBrowser`). |
| [`cli`](./cli) | `inaya-cli` — terminal/CI-CD tool (`inaya login` / `upload` / `list`). |
| [`create-inaya-dapp`](./create-inaya-dapp) | `npx create-inaya-dapp` scaffolding tool + the Inaya Vault starter template. |

All three are wired to the root SDK via workspace-local dependencies (`file:../..` for `cli`, workspace auto-linking for `react`), verified working with real end-to-end tests, not just "it typechecks":

- `react`: bundle-checked with esbuild.
- `cli`: a full `login` → encrypt-at-rest → decrypt round trip was actually run against a throwaway test wallet (never a real key), including a deliberate wrong-password case to confirm it fails safely.
- `create-inaya-dapp`: actually scaffolded a project into a temp directory and verified the name substitution, `.env.local` copy, and both error paths (existing directory, missing project name).

## Module 4 — what's left, and why it's not done yet

Two things here need **your** direct involvement — not because the code isn't ready, but because they're inherently actions only you can take:

1. **Publishing to the public npm registry.** All three packages have real `package.json` metadata (`repository`, `license`, `files` where relevant) and are ready for `npm publish --access public` from each package directory — but that needs your npm account logged in (`npm login`) and 2FA/OTP if you have it enabled. I won't run a publish command with your credentials; this is a one-command step once you're ready:
   ```bash
   cd packages/react && npm publish --access public
   cd packages/cli && npm publish --access public
   cd packages/create-inaya-dapp && npm publish --access public
   ```
   **Before publishing `inaya-cli` specifically:** change its `@inaya-network/custody-sdk` dependency from `file:../..` (a workspace-local path that only works inside this monorepo) to `github:Talhawaqas/custody-sdk` (the same git dependency `inaya-mobile` already uses) — a `file:` path would break for anyone installing the published package.

2. **Storybook deployment.** Not set up yet — genuinely deferred, not attempted-and-broken. Adding Storybook to `packages/react` means a real decision (Vite vs. webpack builder, whether to also wire up Tailwind's build just for Storybook's own preview) and a hosting choice (Vercel vs. GitHub Pages) before it's worth building — rather than half-configure it and call it done. Happy to build this out fully once you'd like to prioritize it.
