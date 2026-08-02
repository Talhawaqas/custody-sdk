# Inaya Network — open-source ecosystem packages

This monorepo (npm workspaces) hosts the SDK's surrounding ecosystem, alongside `@inaya-network/custody-sdk` itself at the repo root:

| Package | What it is | Published |
|---|---|---|
| [`react`](./react) | `@inaya-network/react` — drop-in React + Tailwind components (`InayaConnect`, `InayaUploader`, `InayaFileBrowser`). | [npm](https://www.npmjs.com/package/@inaya-network/react) |
| [`cli`](./cli) | `inaya-cli` — terminal/CI-CD tool (`inaya login` / `upload` / `list`). | [npm](https://www.npmjs.com/package/inaya-cli) |
| [`create-inaya-dapp`](./create-inaya-dapp) | `npx create-inaya-dapp` scaffolding tool + the Inaya Vault starter template. | [npm](https://www.npmjs.com/package/create-inaya-dapp) |

All three are live on the public npm registry as of 2026-08-02, verified working with real end-to-end tests, not just "it typechecks":

- `react`: bundle-checked with esbuild.
- `cli`: a full `login` → encrypt-at-rest → decrypt round trip was actually run against a throwaway test wallet (never a real key), including a deliberate wrong-password case to confirm it fails safely.
- `create-inaya-dapp`: actually scaffolded a project into a temp directory and verified the name substitution, `.env.local` copy, and both error paths (existing directory, missing project name).

## Module 4 — done

### Storybook

`packages/react` has a full Storybook setup: Vite builder, Tailwind v4 wired into the preview (verified by inspecting the actual built CSS output for real compiled utility classes, not just "it didn't crash"), and a story per component. `.github/workflows/storybook.yml` builds and deploys it to GitHub Pages automatically on every push to `main` that touches `packages/react`, once GitHub Pages is enabled under **Settings → Pages → Source → GitHub Actions** for this repo.

### NPM publishing

All three packages are live on the public registry (see the table above). Install any of them the normal way now:
```bash
npm install @inaya-network/react
npm install -g inaya-cli
npx create-inaya-dapp my-app
```

**Note for future version bumps:** publishing from this account requires either an interactive terminal (for TOTP-based accounts) or a granular access token with "bypass 2FA" enabled and "All packages" read/write permission scoped to a short expiration, generated fresh each time and revoked immediately after use — exactly the flow used for this initial publish. Never paste a live token into chat; set it directly via `npm config set //registry.npmjs.org/:_authToken <token>` in your own terminal, from the repo root (not from inside a workspace package directory, which throws `ENOWORKSPACES`).
