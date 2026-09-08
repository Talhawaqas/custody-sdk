# Trust Fabric — Phase 0 (Architecture Discovery) & Phase 1 (Technical Design)

Internal doc for `Inaya_Network_Advanced_Trust_Compliance_Interoperability_Engineering_SOW.md`
(same three workstreams re-framed, with a scoring/cost model, in
`Inaya_Network_Strategic_Infrastructure_Expansion_SOW.md`). Same honesty convention as every
other architecture doc in this repo: every claim cites a real file or is explicitly marked
proposed/new. **Cost note per the user's own instruction**: any phase requiring paid infrastructure
(real TEE-capable cloud VMs, HSM/KMS services, paid RPC/indexing, relayer operating costs) is
built as far as it can go for free, then explicitly flagged DEFERRED — PENDING BUDGET, not skipped
silently.

---

## Phase 0 — Architecture Discovery (what actually exists today)

### Repo boundary
`custody-sdk` (npm workspaces monorepo) is the crypto/custody core. `packages/bridge-sdk` and
`packages/node-daemon` are **deliberately independent siblings**, not layered on `custody-sdk`.
New Trust Fabric capability belongs here, as new flat `src/*.js` modules exposed as new
`InayaKernel` sub-objects (`Attestation`, `ComplianceProofs`, `Intent`) — matching the pattern
`Staking`/`Payments`/`Metadata`/`Analytics`/`Backup`/`AppStore` already use (confirmed via direct
read of `src/index.js`'s real export shape; `Crypto`/`Custody` are legacy-flat, not sub-namespaced
— new additions since have consistently used the sub-object pattern instead).

### Crypto / key custody (`src/crypto.js`, `src/passkeyBackup.js`)
- `@noble/hashes` + `@noble/ciphers` + `@noble/curves` — pure JS, no native bindings, works
  identically in browser/Node/React Native. **`@noble/curves` is already a dependency** — the ZK
  workstream can reuse it directly rather than adding a new crypto dependency.
- `deriveVaultKey` (PBKDF2, 100k iterations) → AES-GCM-256 encrypt → `disperseAndSlice` (literal
  ciphertext bisection into two shards) → `reconstructAndDecrypt`.
- `deriveEncryptionKeypairFromSignature` — X25519 keypair deterministic from a wallet's
  `personal_sign`; secret key never leaves the device (no fetch/XHR anywhere in the module,
  enforced by a real network-call-inspection test in `passkeyBackup.test.mjs`).
- **Hard invariant**: `passkeyBackup.js`'s own header states Inaya never receives, stores, or can
  reconstruct the raw passkey/derived key. **Any TEE-based key-custody design must not violate
  this** — a TEE that could reconstruct a user's vault key would be a philosophical reversal of
  this SDK's core guarantee, not an extension of it. This SOW's TEE workstream is scoped to
  *workload attestation* and *new, separate* key material (attestation signing keys, intent
  co-signing keys) — never the existing per-file vault key.

### On-chain contracts (`src/contracts.js`)
Real deployed addresses on BSC Testnet: `InayaNetwork`, `InayaCustody`, `InayaToken`,
`InayaStaking`, `InayaBackupRegistry` (read-only from the SDK side). `InayaNodeRegistry`'s ABI
lives separately in `packages/node-daemon/src/constants.js`. **`InayaProofRegistry` does not
exist anywhere in this repo** (confirmed via full-tree + full-history grep) — any on-chain
attestation/proof anchoring is net-new.

### Bridge / interop (`packages/bridge-sdk`)
**Correction to the SOW's implicit assumption**: there is no adapter-per-chain architecture here
today. `InayaBridgeClient` (`packages/bridge-sdk/src/client.js`) is one flat class with ~6 methods
(`getSupportedChains`, `getTransferStatus`, `getStakingPosition`, `bridgeTransfer`, `stake`,
`unstake`/`claimRewards`), branching on `sourceChain.isHome` between two hardcoded ABI shapes. A
"chain" is a plain `{chainId, isHome, contracts}` object; a "transfer" is a `messageHash` from a
custom `MessageSent` event. This is a **custom home/spoke message-bridge**, not Wormhole, not a
generic interop protocol, and has no `getCapabilities/quote/simulate` step — the caller builds the
whole transfer intent itself today. Chains wired: BSC Testnet (home), Sepolia, Amoy, Fuji as
spokes (all free testnets — no cost to exercise). The Intent workstream's job is exactly to add
the missing `getCapabilities → quote → simulate` steps in front of this real, working execution
layer — not to replace it.

*(Separately, `inaya-network-dapp/src/lib/chain-adapters/` — a different repo from custody-sdk —
already has a closer-to-spec `ChainAdapter` abstract class with `validateAddress/estimateTransfer/
initiateTransfer/getTransferStatus/getFinalityStatus/healthCheck`, explicitly "not wired into any
live route yet." That's the app's own bridge UI layer, separate from custody-sdk's SDK surface;
noted here so the Intent workstream doesn't duplicate work already sketched there — worth aligning
method names across both.)*

### Node daemon (`packages/node-daemon`)
Pure heartbeat/registration client — `registerNode()` on-chain, then a `setInterval` loop that
POSTs telemetry. **Deliberately, explicitly reports `usedCapacityGB: 0`/`shardsStored: 0` on every
beat** — it does not store or serve shards. **There is currently no computational workload on a
node for TEE attestation to attest to.** The only sensitive runtime artifact is the decrypted
wallet private key held in-process to sign heartbeats (`resolveWallet.js`) — a key-custody
concern, not a workload-integrity one. Workstream A's node-attestation angle (§6.11 of the
Engineering SOW) has nothing to attest to yet; flagged as a real gap, not solved by this pass.

### Identity / authorization (only real pattern in the codebase)
No policy/role/permission abstraction exists in custody-sdk. The **only** authorization mechanism,
reused consistently across `metadata.js` and `node-daemon/nodeAuth.js`:

```
buildXMessage({action, resourceId, extra}) → "Inaya X Action\naction: ...\nresourceId: ...\n...\ntimestamp: T"
  → wallet.signMessage(message)  // personal_sign, not EIP-712
  → {address, message, signature, timestamp}
  → server: ethers.verifyMessage(message, signature) === claimed address, timestamp fresh (<5min)
```

For on-chain writes, authorization is simply "whoever controls the signer" — no separate layer.
**This is the building block the Intent workstream's signature/nonce/expiration/replay-protection
requirements (§8.4) should reuse**, not reinvent — it's proven, tested, and already the app's own
convention for "prove you authorized this specific action, right now, once."

### Zero footprint confirmed
Grepped the full tree + full git history for `attestation|SGX|TDX|SEV|enclave|zk-snark|circuit|
\bintent\b|\bsolver\b` — zero real hits (only false positives: npm provenance "build attestation,"
minified Storybook assets). **Workstreams A, B, C are 100% greenfield** — nothing to migrate
around, only new build. This matches both SOWs' own stated assumption.

### Existing R&D relevant to this SOW
Two prior research docs in the sibling `inaya-network-dapp` repo (`FHE_MPC_RESEARCH.md`,
`CROSS_TENANT_ANALYTICS_RESEARCH.md`) already investigated adjacent confidential-computing
questions and reached a real, specific finding worth inheriting rather than re-deriving:

> Structured business data (invoices, expenses, HR records) is **not** client-side encrypted —
> Inaya's own backend already has full plaintext access by design. Only Documents get client-side
> AES-GCM. A TEE (or MPC) "protects data in use" claim is **only meaningful, not theater, for
> structured-data processing that the backend currently sees in plaintext** — TEE adds nothing
> over the existing model for Documents, which are already solved by client-side encryption.

This directly resolves Workstream A's "where does TEE actually earn its cost" question: the
justified target is confidential processing of structured business/compliance data (e.g., Business
Insights aggregation, a future compliance-evidence classifier), not file storage.

---

## Phase 1 — Technical Design (per workstream)

### Workstream A — TEE Attestation

**Target architecture** (per the Engineering SOW's §6.4, confirmed buildable without hardware for
the verification/policy half):

```
Workload → Provider Adapter → Normalized Evidence → Attestation Verifier → Policy Engine → Trust Decision → (PASS) Key Broker → Protected Key Release
```

- **Provider adapter interface**: `{ getAttestationReport(nonce), verifyReport(report) }`, one
  adapter per TEE technology. **No real hardware-backed provider is buildable in this pass without
  paid confidential-computing infrastructure (Azure/GCP/AWS confidential VMs, or physical
  SGX/SEV-SNP hardware) — DEFERRED, PENDING BUDGET.** What ships now: a `SoftwareSimAdapter` that
  produces a real, structurally-correct evidence object (measurement hash of the actual running
  code, a real nonce, a real timestamp, a real Ed25519 signature over the evidence) but whose
  "hardware root of trust" is a locally-held key, not silicon — **explicitly labeled
  `hardwareBacked: false` in every evidence object it produces**, so no caller can mistake it for
  real attestation. This is the honest mock boundary §23 requires naming, not hiding.
- **Evidence model**: attestationId, provider, hardwareBacked, workloadMeasurement (sha256 of the
  workload's canonical source), platformIdentity, nonce, timestamp, expiresAt, signature.
- **Verifier**: checks signature validity, measurement against an approved allowlist, freshness
  (nonce not reused, timestamp within window), expiry. Returns `VALID | INVALID | EXPIRED |
  UNKNOWN` (REVOKED/DEGRADED need a real revocation service — deferred with hardware).
- **Policy engine**: versioned rules (`measurement ∈ APPROVED_SET AND hardwareBacked === policy.
  requireHardware AND age < maxAge`) → `ALLOW | DENY | REQUIRE_REATTESTATION`.
- **Key release**: a `KeyBroker` that only releases a (new, attestation-scoped — never the real
  vault key, per the hard invariant above) protected value after a `PASS` decision. POC proves an
  application **cannot** obtain the protected value by skipping attestation or presenting a
  tampered evidence object.

### Workstream B — Zero-Knowledge Compliance Proofs

**Selective-use principle honored**: not building a general circuit-compiler pipeline (circom/
snarkjs need a native toolchain and a trusted-setup ceremony — real infra cost/complexity
disproportionate to one narrow statement, per §7.2's own "don't introduce ZK complexity where
conventional mechanisms suffice" rule). Instead: a **real, sound, non-interactive zero-knowledge
proof** built directly on `@noble/curves` (already a dependency, pure JS, zero native toolchain) —
a Schnorr identification protocol made non-interactive via Fiat-Shamir. This is genuine ZK
cryptography (a real interactive sigma-protocol, this exact construction underlies real production
proof systems), not a circuit — appropriate for the one narrowly-scoped statement below.

**Selected proof statement** (per §7.4/§5's "only formally expressible statements should proceed"):
**"Authorized access"** — prove knowledge of the private key controlling a specific, publicly-known
address (an org-membership or role commitment) **without revealing the private key**, binding the
proof to a specific policy/action/timestamp so it can't be replayed for a different purpose.

```
Prover knows: sk (private key)                Public: P = sk·G (the committed identity), policy, action, timestamp
1. r ←$ random scalar;  R = r·G
2. c = H(R ‖ P ‖ policy ‖ action ‖ timestamp)      (Fiat-Shamir challenge — makes it non-interactive)
3. s = r + c·sk  (mod n)
Proof = (R, s).  Verifier checks: s·G == R + c·P
```

- **Zero-knowledge**: `s` is statistically indistinguishable from random without `sk`; verifier
  learns nothing about `sk`.
- **Soundness**: forging a valid `(R,s)` without knowing `sk` is as hard as the discrete-log
  problem on the chosen curve.
- **Policy binding** (this SOW's §7.5 requirement): the challenge `c` is computed over
  `policy‖action‖timestamp`, so a proof generated for one policy/action is cryptographically
  invalid for any other — the exact anti-replay/anti-substitution property §7.7 requires.
- **On-chain footprint**: the proof `(R, s)` is ~64 bytes, verifiable in milliseconds — no
  sensitive data ever leaves the prover's device, and if optional on-chain anchoring is wanted
  later, only the tiny proof (not the underlying secret) would ever be posted.

### Workstream C — Intent-Based Multi-Chain Routing

**Not a replacement for `bridge-sdk`** — an orchestration layer in front of it, per §8.7. Reuses:
- `bridge-sdk`'s real `InayaBridgeClient` as the only execution backend for now (one "route" =
  BSC ⇄ {Sepolia, Fuji, Amoy}, all free testnets already wired and working).
- The existing signed-message pattern (`buildXMessage`/`personal_sign`) for intent
  authorization — an intent is signed exactly like a metadata action is today, with
  `{intentId, asset, amount, recipient, maxFee, deadline, nonce}` in the message.
- The guarded-execution shape already proven in `inaya-network-dapp/src/lib/ai-action-requests.js`
  (`PENDING_APPROVAL → APPROVED → EXECUTED`, idempotency key, atomic claim) for §8.10's "AI
  proposes intent → human approval → execute" flow — same pattern, new domain.

```
CREATE (signed intent) → VALIDATE (schema + signature + nonce fresh) → DISCOVER ROUTES (today:
the one real bridge route) → SIMULATE (dry-run: balance check, fee estimate, no state change) →
RISK CHECK (maxFee/recipient/deadline still hold) → APPROVE (human, if AI-originated) → EXECUTE
(delegates to bridge-sdk's real bridgeTransfer) → SETTLE/CONFIRM (poll bridge-sdk's real
getTransferStatus) → AUDIT (append an evidence record)
```

No new chains, no new bridge protocol, no solver/relayer network (that's real infra cost —
**DEFERRED, PENDING BUDGET** if a permissionless solver market is ever wanted; the POC uses
Inaya's own existing bridge as the only "solver," which is free since it's already deployed and
already used for real testnet transfers).

---

## What's deferred, pending budget (per the user's explicit instruction)

| Item | Why it costs money | What ships instead now |
|---|---|---|
| Real hardware-backed TEE (SGX/SEV-SNP/confidential VM) | Cloud confidential-computing instances or physical hardware | `SoftwareSimAdapter` — same verifier/policy/key-release pipeline, explicitly `hardwareBacked:false` |
| A revocation service for attestation evidence | A real, hosted, monitored service | `REVOKED` status modeled but always returns unreachable/unknown honestly |
| A permissionless solver/relayer network for Intent routing | Relayer operating costs, incentive design | Intent execution delegates to Inaya's own already-deployed, already-free bridge |
| On-chain ZK proof verification / anchoring | Gas costs, a verifier contract deployment | Off-chain verification only (still real, still sound) — anchoring is a one-line addition once budget allows deploying a verifier contract |

Everything else in Phase 2 (POC), Phase 3 (adversarial validation), and Phase 4 (economics of what
*was* built) proceeds now, for free.
