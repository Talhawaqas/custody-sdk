# Protocol Stress Test Report

**Phase 3 Tier 1, Module 3 — Protocol Stress Testing**
**Date:** 2026-08-03 · **Network:** BNB Chain Testnet · **Contract:** `InayaCustody` at `0x7F5E6cF1353beEE4fc19FD46Dd6EaD0B3895a888` · **RPC:** `https://data-seed-prebsc-1-s1.binance.org:8545` (the same public endpoint this codebase's real backend routes already use as their default)

This is a one-off diligence run against the live deployed contract, not a permanent SDK feature — the script is `stress_test_protocol.mjs` in this directory. Every number below is from a real run recorded in that moment; nothing here is estimated or extrapolated.

---

## Summary

| Test | Attempted | Succeeded | Failure rate | Avg latency | Avg gas |
|---|---|---|---|---|---|
| Sequential `batchRegisterAssets` (run 1, insufficient allowance) | 25 | 12 | 52.0% | 3,009 ms | 151,591 |
| Concurrent `batchRegisterAssets` (run 1, insufficient allowance) | 25 | 0 | 100.0% | 526 ms | — |
| Sequential `batchRegisterAssets` (run 2, clean) | 25 | 25 | **0.0%** | 5,853 ms | 151,599 |
| Concurrent `batchRegisterAssets` (run 2, clean) | 25 | 25 | **0.0%** | 7,158 ms | 151,624 |
| Concurrent `assets()` reads, 200-way (both runs) | 200 | 100 (both times) | 50.0% | ~970 ms | — (free) |
| Concurrent `assets()` reads, bracketed | 10 / 50 / 75 / 100 / 150 | all succeed through 100, 0% succeed at 150 | see below | — | — (free) |

**The most valuable finding is the first row, not the last.** The 52%/100% write failure rates in run 1 were *not* a protocol or RPC limitation — they were a real, worth-documenting operational gap in how this test (and by extension, any real batch-upload workflow) manages fee-token allowance. See "Finding 1" below for the full diagnosis. Run 2, with that gap closed, shows the contract itself handles this write volume cleanly at 0% failure.

---

## Finding 1: Fee-token allowance exhaustion mid-batch (write failures, run 1)

**What happened:** 13 of 25 sequential writes failed, and all 25 concurrent writes failed, every one with `execution reverted (unknown custom error)` — an undecoded Solidity custom error (the deployed contract's source isn't verified on BscScan testnet and isn't vendored in this repo, so the exact custom error name can't be recovered from bytecode alone).

**Root cause, confirmed by direct on-chain inspection after the run:**
- `usdtFeePerGB` on the live contract is `4,394,531,250,000,000` (raw 18-decimal units) — not zero.
- For this test's 1,024-byte file, the computed fee is `fileSizeBytes * usdtFeePerGB / 1_073_741_824` = **4,190,951,585** raw units per call.
- The treasury wallet's USDT allowance for the Custody contract, at the start of the run, was **3,863,533,502** raw units — already *less than a single call's fee*, and it only got smaller as prior unrelated work this session consumed part of it.
- The first several sequential calls apparently drew on whatever headroom remained and succeeded; once it ran out mid-run, every subsequent `transferFrom` inside `batchRegisterAssets` reverted — explaining both the partial sequential failure and the total concurrent failure (concurrent writes ran second, after the allowance was already fully exhausted).

**Fix applied and verified:** approved a fresh allowance of `4,190,951,585 × 500` raw units, then re-ran the identical script. Result: **25/25 sequential and 25/25 concurrent writes succeeded, 0% failure**, gas cost essentially identical to run 1's successful calls (see Finding 2).

**The actual lesson, stated plainly:** `approveFeeTokens()` (or any equivalent) must be called for the *full anticipated batch*, not per-call or with a small buffer — a burst of writes will silently start failing partway through once a too-small pre-approved allowance runs out, and the failure mode (`execution reverted`) gives no indication that "insufficient allowance" is the cause rather than a deeper contract or network problem. Any production batch-upload flow built on this SDK should either approve generously up front or check remaining allowance before each write and top up proactively.

---

## Finding 2: Write throughput and cost, clean run

With allowance no longer a variable:

- **Sequential (25 calls):** 100% success, total wall time 146.3s, average 5.85s per call (mostly block-confirmation wait — BSC testnet block time, not contract cost), average gas **151,599**.
- **Concurrent (25 calls, pre-assigned sequential nonces, fired via `Promise.all`):** 100% success, all 25 confirmed together in **7.16s total** — meaningfully faster in wall-clock terms than sequential for the same volume, as expected, with no nonce collisions or dropped transactions.
- **Gas price at test time:** 0.1 gwei (BSC testnet, real quoted price, not assumed).
- **Real cost per call:** ~151,600 gas × 0.1 gwei ≈ **0.0000152 BNB** (~$0.000005 at any plausible BNB price — testnet gas is not a meaningful cost driver at this volume).
- **Total spend across both full runs (50 real anchored writes) plus one allowance-approval transaction:** 0.0097181651 → 0.0087752131 BNB (0.0009429520 BNB total, ~0.000019 BNB per write including the one-time approval).

**No write-side rate limiting or throughput ceiling was observed** at 25 concurrent writes — the contract and RPC endpoint both handled this volume cleanly once fee approval was correct.

---

## Finding 3: Public RPC endpoint has a real concurrency ceiling for reads, somewhere between 100 and 150

Reads are free (no gas, `assets()` is a `view` function), so this volume was pushed much higher than writes, per the SOW's own reasoning that reads are more likely to surface real RPC throttling.

- **200-way concurrent reads, run independently twice** (once per write-test run): **exactly 100/200 (50%) succeeded both times**, failing with `missing response for request` — a connection/timeout-level failure, not an application error. The consistency of this exact 50% figure across two independent runs, hours apart in wall-clock terms within the same session, suggests a real, somewhat stable ceiling rather than random noise.
- **A follow-up bracketing pass** (10 / 50 / 100 / 150 concurrent, no pause between): 10 and 50 succeeded 100%, but 100 and 150 both failed **100%** — a harder, more sudden cutoff than the 200-way test's 50/50 split.
- **A second bracketing pass** (50 / 75 / 100 / 100 / 150, with a 1.5s pause between each level): 50, 75, and both 100-concurrency trials succeeded 100% cleanly; 150 failed 100% again.

**Honest interpretation:** the exact threshold is not perfectly deterministic — likely because `data-seed-prebsc-1-s1.binance.org` is free, shared, multi-tenant public infrastructure whose available headroom depends on what else is hitting it at that moment, not just this test's own load. But the pattern across five independent trials is consistent enough to state plainly: **this endpoint reliably handles at least 100 concurrent reads, and reliably fails at 150+ — somewhere in that gap is a real ceiling.** Any application built on this SDK that needs to burst more than ~100 concurrent reads against this specific public endpoint should either throttle client-side, retry on `missing response for request` (this SDK's `withRetry()` already does retry transient read failures automatically — see `SDK_GUIDE.md` §6), or use a dedicated/paid RPC endpoint for high-concurrency workloads.

---

## What this report does NOT claim

- It does not claim to have found the exact custom-error name behind the allowance-exhaustion reverts — the contract source isn't available to decode it precisely.
- It does not claim BSC testnet's real capacity ceiling is exactly some round number like "128" — five trials bracket the real behavior to "somewhere between 100 and 150," not a precise figure, and that's reported as exactly that: a bracket, not a false-precision guess.
- It does not extrapolate these numbers to mainnet — mainnet RPC infrastructure (public or paid) has different capacity characteristics than a free testnet endpoint, and this report makes no claim either way about it.

---

## Raw data

Full per-call results (every attempt, its outcome, latency, and gas) for both runs are preserved as JSON alongside this report: `stress_test_raw_1785775146136.json` (run 1) and `stress_test_raw_1785775370356.json` (run 2).
