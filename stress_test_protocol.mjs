// stress_test_protocol.mjs
//
// Phase 3 Tier 1, Module 3 — Protocol Stress Testing (2026-08-03).
// A one-off diligence script, NOT a permanent SDK feature (matches
// test_crypto_roundtrip.mjs's existing convention of a loose root-level
// .mjs script rather than living under src/).
//
// Exercises the deployed InayaCustody contract on BNB Chain Testnet
// under real load: sequential batchRegisterAssets writes, concurrent
// batchRegisterAssets writes, and a much larger concurrent assets()
// read burst (reads are free — no gas — so they can go far higher
// than writes and are likelier to actually surface public-RPC
// rate-limiting, which the write tests' small volume might not hit).
//
// Requires TREASURY_WALLET_PRIVATE_KEY (already funded on testnet;
// read from env, never logged) via `node --env-file=.env.local`.
//
// Every number in the JSON/markdown output is from THIS run, not
// assumed or estimated — see the printed summary and the generated
// STRESS_TEST_REPORT.md for the actual results.

import { ethers } from "ethers";
import fs from "node:fs";

const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545";
const CUSTODY_ADDRESS = "0x7F5E6cF1353beEE4fc19FD46Dd6EaD0B3895a888";
const CUSTODY_ABI = [
  "function batchRegisterAssets(bytes32[] fileHashes, uint256[] fileSizes, string[] shardACIDs, string[] shardBCIDs) external",
  "function assets(bytes32) view returns (address owner, string shardACID, string shardBCID, uint256 timestamp)",
];

const SEQUENTIAL_COUNT = 25;
const CONCURRENT_WRITE_COUNT = 25;
const CONCURRENT_READ_COUNT = 200;
const RUN_ID = Date.now();

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(process.env.TREASURY_WALLET_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CUSTODY_ADDRESS, CUSTODY_ABI, wallet);

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

function classifyError(err) {
  const msg = (err?.shortMessage || err?.message || String(err)).toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) return "RATE_LIMITED";
  if (msg.includes("timeout") || msg.includes("timed out") || err?.code === "TIMEOUT") return "TIMEOUT";
  if (msg.includes("nonce")) return "NONCE_ERROR";
  if (msg.includes("insufficient funds")) return "INSUFFICIENT_FUNDS";
  return "OTHER: " + (err?.shortMessage || err?.message || String(err)).slice(0, 120);
}

// ---------------------------------------------------------------
// 1. Sequential writes
// ---------------------------------------------------------------
async function runSequentialWrites() {
  console.log(`\n=== Sequential writes: ${SEQUENTIAL_COUNT} calls ===`);
  const results = [];
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  const suiteStart = nowMs();

  for (let i = 0; i < SEQUENTIAL_COUNT; i++) {
    const fileHash = ethers.id(`stress-seq-${RUN_ID}-${i}`);
    const callStart = nowMs();
    try {
      const tx = await contract.batchRegisterAssets([fileHash], [1024], [`QmSeqTest${i}A`], [`QmSeqTest${i}B`], { nonce: nonce++ });
      const receipt = await tx.wait();
      const callEnd = nowMs();
      results.push({
        index: i, ok: true, txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        gasPriceWei: receipt.gasPrice?.toString() ?? null,
        latencyMs: callEnd - callStart,
      });
      console.log(`  [${i}] ok gasUsed=${receipt.gasUsed} latency=${callEnd - callStart}ms`);
    } catch (err) {
      const callEnd = nowMs();
      results.push({ index: i, ok: false, error: classifyError(err), latencyMs: callEnd - callStart });
      console.log(`  [${i}] FAILED: ${classifyError(err)}`);
    }
  }
  const suiteEnd = nowMs();
  return { totalDurationMs: suiteEnd - suiteStart, results };
}

// ---------------------------------------------------------------
// 2. Concurrent writes — nonces pre-assigned so all txs are valid to
//    submit simultaneously (ethers won't auto-sequence concurrent sends
//    from one wallet correctly on its own).
// ---------------------------------------------------------------
async function runConcurrentWrites() {
  console.log(`\n=== Concurrent writes: ${CONCURRENT_WRITE_COUNT} calls ===`);
  const startNonce = await provider.getTransactionCount(wallet.address, "pending");
  const suiteStart = nowMs();

  const promises = Array.from({ length: CONCURRENT_WRITE_COUNT }, async (_, i) => {
    const fileHash = ethers.id(`stress-conc-${RUN_ID}-${i}`);
    const callStart = nowMs();
    try {
      const tx = await contract.batchRegisterAssets([fileHash], [1024], [`QmConcTest${i}A`], [`QmConcTest${i}B`], { nonce: startNonce + i });
      const receipt = await tx.wait();
      const callEnd = nowMs();
      return { index: i, ok: true, txHash: receipt.hash, gasUsed: receipt.gasUsed.toString(), latencyMs: callEnd - callStart };
    } catch (err) {
      const callEnd = nowMs();
      return { index: i, ok: false, error: classifyError(err), latencyMs: callEnd - callStart };
    }
  });

  const results = await Promise.all(promises);
  const suiteEnd = nowMs();
  results.forEach((r) => console.log(r.ok ? `  [${r.index}] ok gasUsed=${r.gasUsed} latency=${r.latencyMs}ms` : `  [${r.index}] FAILED: ${r.error}`));
  return { totalDurationMs: suiteEnd - suiteStart, results };
}

// ---------------------------------------------------------------
// 3. Concurrent reads — free, so run at much higher concurrency;
//    reads the fileHashes just written above (a real mix of existing
//    and, for the tail beyond what writes produced, nonexistent hashes)
//    plus wraps around if CONCURRENT_READ_COUNT exceeds available real hashes.
// ---------------------------------------------------------------
async function runConcurrentReads(knownHashes) {
  console.log(`\n=== Concurrent reads: ${CONCURRENT_READ_COUNT} calls ===`);
  const suiteStart = nowMs();

  const promises = Array.from({ length: CONCURRENT_READ_COUNT }, async (_, i) => {
    const fileHash = knownHashes.length ? knownHashes[i % knownHashes.length] : ethers.id(`stress-read-${RUN_ID}-${i}`);
    const callStart = nowMs();
    try {
      const [owner] = await contract.assets(fileHash);
      const callEnd = nowMs();
      return { index: i, ok: true, found: owner !== ethers.ZeroAddress, latencyMs: callEnd - callStart };
    } catch (err) {
      const callEnd = nowMs();
      return { index: i, ok: false, error: classifyError(err), latencyMs: callEnd - callStart };
    }
  });

  const results = await Promise.all(promises);
  const suiteEnd = nowMs();
  const failed = results.filter((r) => !r.ok);
  console.log(`  ${results.length - failed.length}/${results.length} succeeded`);
  if (failed.length) console.log(`  failures:`, [...new Set(failed.map((f) => f.error))]);
  return { totalDurationMs: suiteEnd - suiteStart, results };
}

// ---------------------------------------------------------------
function summarize(label, suite) {
  const ok = suite.results.filter((r) => r.ok);
  const failed = suite.results.filter((r) => !r.ok);
  const latencies = suite.results.map((r) => r.latencyMs);
  const gasUsed = ok.filter((r) => r.gasUsed).map((r) => BigInt(r.gasUsed));
  return {
    label,
    attempted: suite.results.length,
    succeeded: ok.length,
    failed: failed.length,
    failureRate: (failed.length / suite.results.length).toFixed(4),
    totalDurationMs: suite.totalDurationMs,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    avgGasUsed: gasUsed.length ? (gasUsed.reduce((a, b) => a + b, 0n) / BigInt(gasUsed.length)).toString() : null,
    failureReasons: [...new Set(failed.map((f) => f.error))],
  };
}

(async () => {
  const startBalance = await provider.getBalance(wallet.address);
  const feeData = await provider.getFeeData();
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Starting BNB balance: ${ethers.formatEther(startBalance)}`);
  console.log(`Current gas price: ${ethers.formatUnits(feeData.gasPrice, "gwei")} gwei`);

  const seq = await runSequentialWrites();
  const conc = await runConcurrentWrites();

  const knownHashes = [
    ...seq.results.filter((r) => r.ok).map((r, i) => ethers.id(`stress-seq-${RUN_ID}-${i}`)),
    ...conc.results.filter((r) => r.ok).map((r, i) => ethers.id(`stress-conc-${RUN_ID}-${i}`)),
  ];
  const reads = await runConcurrentReads(knownHashes);

  const endBalance = await provider.getBalance(wallet.address);
  const bnbSpent = startBalance - endBalance;

  const report = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    rpcUrl: RPC_URL,
    wallet: wallet.address,
    gasPriceGwei: ethers.formatUnits(feeData.gasPrice, "gwei"),
    bnbSpent: ethers.formatEther(bnbSpent),
    startBalanceBnb: ethers.formatEther(startBalance),
    endBalanceBnb: ethers.formatEther(endBalance),
    sequentialWrites: summarize("Sequential batchRegisterAssets", seq),
    concurrentWrites: summarize("Concurrent batchRegisterAssets", conc),
    concurrentReads: summarize("Concurrent assets() reads", reads),
  };

  fs.writeFileSync(`stress_test_raw_${RUN_ID}.json`, JSON.stringify({ report, seq, conc, reads }, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(report, null, 2));
})();
