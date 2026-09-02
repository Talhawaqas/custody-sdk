# inaya-cli

Command-line interface for [`@inaya-network/custody-sdk`](../../README.md) — encrypt, shard, and anchor files to the Inaya DePIN network from a terminal or a CI/CD pipeline, no browser or wallet extension involved.

## Install

```bash
npm install -g inaya-cli
```

(Or, inside this monorepo during development: `node packages/cli/bin/inaya.js <command>`.)

## Commands

### `inaya login`

```bash
inaya login
```

Prompts for a wallet private key and a CLI password, then stores the key **encrypted** (AES-256-GCM, PBKDF2-derived from your CLI password) at `~/.inaya/config.json` — never in plaintext.

**Non-interactive (CI/CD) use:** set `INAYA_PRIVATE_KEY` and `INAYA_CLI_PASSWORD` as environment variables (e.g. CI secrets) and `inaya login` skips the prompts entirely. Never commit either value to a repo or paste a real private key anywhere outside your own terminal/CI secret store.

### `inaya upload <path>`

```bash
inaya upload ./report.pdf
```

Prompts for an encryption passkey (or reads `INAYA_PASSKEY` from the environment for non-interactive/CI use — never pass it as a command-line flag; unlike environment variables, arguments are visible to other users on a shared machine via `ps`/process listing and persist in shell history). Encrypts and shards the file locally, pins both shards to IPFS (requires `PINATA_JWT` in your environment — get one from app.pinata.cloud), and anchors the record on-chain using the logged-in wallet.

Pass `--api-base-url <url>` to also register the upload in your deployed Metadata backend, so `inaya list` can find it afterward (see `examples/nextjs-metadata-api-routes.js` in the SDK repo for what that backend needs to implement).

### `inaya list`

```bash
inaya list --api-base-url https://your-backend.example
```

Prints every file registered for the logged-in wallet.

**Why `--api-base-url` is required:** `InayaCustody` has no on-chain enumeration function — confirmed directly via live `eth_call` testing (see `custody-sdk/SDK_GUIDE.md` §12). The contract only supports looking up one already-known `fileHash` at a time, not "list everything this address owns." `inaya list` therefore reads from the same off-chain Metadata backend the SDK's `Metadata` client uses — there's no other source of truth for "all my files."

## CI/CD example

```yaml
- name: Back up build artifact to Inaya
  env:
    INAYA_PRIVATE_KEY: ${{ secrets.INAYA_PRIVATE_KEY }}
    INAYA_CLI_PASSWORD: ${{ secrets.INAYA_CLI_PASSWORD }}
    PINATA_JWT: ${{ secrets.PINATA_JWT }}
    INAYA_PASSKEY: ${{ secrets.INAYA_PASSKEY }}
  run: |
    npx inaya-cli login
    npx inaya-cli upload ./dist/build.tar.gz
```

## Security notes

- The private key is only ever decrypted in-memory, for the duration of one command.
- `~/.inaya/config.json` is written with `0600` permissions (owner read/write only) and the directory with `0700`.
- This CLI never sends your private key or CLI password anywhere over the network — they're used only to sign locally and derive the local encryption key.
