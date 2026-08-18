# @inaya-network/node-daemon

Minimal node operator daemon for the Inaya Network. Registers your node on-chain and reports
heartbeat/telemetry to the coordinator backend. Runs as a plain Node.js process — no Docker.

**This daemon does not store or serve shards.** It only handles registration, wallet/key
custody, and heartbeat telemetry. Shard storage/serving is a separate, not-yet-built piece of
the system.

## Install

```bash
npm install -g @inaya-network/node-daemon
```

Requires Node.js 18+. Works on Windows, macOS, and Linux.

## Usage

```bash
# 1. Store your node operator wallet (encrypted at rest with a password you choose)
inaya-node-daemon login

# 2. Register on-chain + with the coordinator backend, declaring your capacity
inaya-node-daemon register 500

# 3. Start reporting heartbeats (foreground -- Ctrl+C to stop)
inaya-node-daemon start
```

For unattended/CI use, `login` accepts `INAYA_PRIVATE_KEY` and `INAYA_DAEMON_PASSWORD` from
the environment instead of interactive prompts.

## Running unattended (background service)

`start` above runs in the foreground. To keep it running across reboots/logouts without a
terminal window open, install it as a native background service:

```bash
inaya-node-daemon service install
```

This uses each OS's own service manager — a real Windows Service via
[node-windows](https://github.com/coreybutler/node-windows), a systemd unit via `node-linux`,
or a launchd agent via `node-mac` (the latter two are not bundled by default; install them
yourself with `npm install node-linux` / `npm install node-mac` first if you're not on
Windows). You'll be prompted for your daemon password once, at install time — it's stored in
the service's own environment config so it can decrypt the wallet on unattended restarts, the
same trust boundary any CI secret store uses.

```bash
inaya-node-daemon service uninstall
```

## Config

Stored at `~/.inaya/node-daemon/config.json` (mode 0600), private key always encrypted
(PBKDF2 + AES-256-GCM), never in plaintext. Separate from `@inaya-network/cli`'s own
`~/.inaya/config.json` so the two can run different wallets on the same machine.

| Env var | Purpose |
|---|---|
| `INAYA_PRIVATE_KEY` | Wallet private key for `login` (skips the interactive prompt) |
| `INAYA_DAEMON_PASSWORD` | Password to encrypt/decrypt the stored key (skips the interactive prompt; required for unattended/service use) |
| `INAYA_RPC_URL` | BSC Testnet RPC (default: Binance's public endpoint) |
| `INAYA_NODE_REGISTRY_ADDRESS` | Override the InayaNodeRegistry contract address |
| `INAYA_API_BASE_URL` | Override the coordinator backend base URL (default: production) |
| `INAYA_HEARTBEAT_INTERVAL_MS` | Heartbeat interval in ms (default 300000 / 5 min) |
