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

## Module 4

### Storybook — done

`packages/react` now has a full Storybook setup: Vite builder, Tailwind v4 wired into the preview (verified by inspecting the actual built CSS output for real compiled utility classes, not just "it didn't crash"), and a story per component. `.github/workflows/storybook.yml` builds and deploys it to GitHub Pages automatically on every push to `main` that touches `packages/react`.

**The one manual step:** go to this repo's **Settings → Pages → Source → GitHub Actions** (one-time, ~10 seconds, no credentials involved). After that, every push publishes the latest Storybook to `https://talhawaqas.github.io/custody-sdk/`.

### NPM publishing — ready, needs your go-ahead per package

All three packages have real `package.json` metadata (`repository`, `license`, `files` where relevant) and are ready for `npm publish --access public` from each package directory. You've already logged in (`npm whoami` confirms `inaya-network`), so the remaining step is just running each publish with your explicit confirmation:
```bash
cd packages/react && npm publish --access public
cd packages/cli && npm publish --access public
cd packages/create-inaya-dapp && npm publish --access public
```
**Before publishing `inaya-cli` specifically:** its `@inaya-network/custody-sdk` dependency needs to change from `file:../..` (a workspace-local path that only works inside this monorepo) to `github:Talhawaqas/custody-sdk` (the same git dependency `inaya-mobile` already uses) — a `file:` path would break for anyone installing the published package.
