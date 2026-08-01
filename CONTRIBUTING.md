# Contributing to @inaya-network/custody-sdk

Thanks for considering a contribution. This is a small, focused SDK — the goal of this guide is to help you get oriented fast and land a PR that fits how the rest of the codebase already works.

## Getting started

```bash
git clone https://github.com/Talhawaqas/custody-sdk.git
cd custody-sdk
npm install
```

No build step — this is plain ES modules (`"type": "module"` in `package.json`), consumed directly by both Node.js and bundlers. `ethers` (v6) is a peer dependency; install it too if you're running the examples or test harness.

## Repo layout

| Path | What it is |
|---|---|
| `src/crypto.js` | Encryption/sharding — pure JS, no `crypto.subtle`, works in browsers/Node/React Native alike. |
| `src/index.js` | `InayaKernel` — wraps the on-chain contracts (`InayaCustody`, `InayaStaking`). |
| `src/contracts.js` | ABI fragments + deployed addresses. |
| `src/payments.js` / `src/metadata.js` | Typed `fetch()` clients for backend routes *you* deploy — no secrets live here. |
| `src/errors.js` | The `InayaError` hierarchy + `translateError()`. |
| `src/utils.js` | `withRetry()` and the event emitter. |
| `src/*.d.ts` | Hand-written type definitions, one per matching `.js` file — kept in sync manually, not generated. |
| `examples/` | Runnable, complete usage examples — React, Next.js, plain Node.js. |
| `SDK_GUIDE.md` | The real documentation. If your change affects behavior, it almost certainly needs a matching update here. |

## Before you open a PR

1. **Type-check.** Every `.d.ts` change (or any change to a function signature) must still pass:
   ```bash
   npx tsc --noEmit --strict --target es2020 type_check_test.ts
   ```
   If you're adding a new exported function, add a small usage snippet to `type_check_test.ts` exercising it — that file is the only thing that actually catches `.d.ts`/`.js` drift.
2. **Run the test scripts that touch your change:**
   - `node test_crypto_roundtrip.mjs` — if you touched `crypto.js`.
   - `node diagnostic_check.mjs` — if you touched contract addresses/ABIs/RPC config; checks the live testnet is reachable and correctly wired.
   - `test_harness.html` (serve with `npx serve .`, open over `http://localhost`) — for anything touching the full browser + wallet flow.
3. **Don't just trust that a test passes because the file exists.** Actually run it. (A stale test in this repo once silently bypassed the exact function it claimed to cover — see `SDK_GUIDE.md`'s known-limitations entry from 2026-08-01 for the story. Don't repeat that.)

## Conventions this codebase already follows — please match them

- **Every thrown error is an `InayaError` subclass**, produced via `translateError()` or a direct `InayaValidationError`/etc. constructor — never a bare `throw new Error(...)`. See `src/errors.js`.
- **New backend-dependent features are a typed `fetch()` client, not a database wrapper.** Look at `src/payments.js` and `src/metadata.js` before adding anything that talks to a server: the SDK itself carries zero secrets and zero storage; the real logic lives in routes the consumer deploys. Add a matching example under `examples/` showing what that backend route needs to do.
- **Mutating on-chain calls are never auto-retried; read-only calls always are**, via `withRetry()` from `src/utils.js`. If you're not sure which bucket a new call falls into, ask: "could retrying this duplicate a side effect?" If yes, don't retry it.
- **Long-running operations support both an `onProgress` callback and the shared `events` emitter** — see any function in `src/index.js` for the `emitProgress()` pattern.
- **No comments explaining *what* code does** — names should do that. Comments here explain *why*, especially non-obvious constraints (e.g. "this has to be a `Uint8Array`, not a `CryptoKey`, because...").
- **Every `.js` file with a public API has a matching `.d.ts`** kept in sync by hand. If you change a function's parameters or return shape, update both in the same PR.
- **`SDK_GUIDE.md`'s "Known Limitations" section is an honest changelog, not a place to hide problems.** If you find or fix something non-obvious, add a dated entry there (see the existing entries for the tone/format).

## Commit messages

Imperative, present tense, one focused change per commit (`git log --oneline` shows the existing style, e.g. "Fix `INAYA_STAKING_ABI` to match the actually-deployed contract"). Explain *why* in the body when it's not obvious from the diff.

## Finding something to work on

Issues labeled [`good first issue`](https://github.com/Talhawaqas/custody-sdk/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) are scoped to be approachable without deep context on the rest of the SDK. If nothing's labeled yet, open an issue describing what you'd like to work on before starting — for anything touching the contract ABIs or addresses, please verify against the live deployed bytecode/`eth_call` rather than assuming pasted source is current; this codebase has been burned by stale ABIs more than once.

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md) — please read it before participating.
