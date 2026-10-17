import type { Core } from './core';
import type { IngestResult, MinorUnits } from './types';

/**
 * Benchmark-only entry points (benchmarking.md §5.2), next to a {@link Core}, never part of it.
 * Implementations live in their own packages (`core-js-bench`; `core-kmp-bench` with its own
 * Nitro object and native library) and ship in perf builds only: release builds contain none of
 * this (CI checks it). The benchmarks still time the real core where that is the point (BM-03
 * times `Core.computeSpendingSummary`); this only adds helpers and test-only entry points.
 *
 * Each BenchCore is bound to one Core and reads and writes that core's own replica and timings.
 */
export interface BenchCore {
  /**
   * Returns its argument and does nothing else: BM-06 times it to get the pure cost of a call.
   * In kmpCore it crosses JS → Nitro → Kotlin through the bench's Nitro object, the same
   * mechanism as any core call; in jsCore it is a plain function call.
   */
  echo(value: number): number;
  /** BM-06 batched: the core's formatMoney over every amount, in one call. Timed (lastComputeMs). */
  formatMoneyBatch(minors: MinorUnits[]): string[];
  /**
   * BM-04: parse a JSON array of transactions with the core's validator and write the valid ones
   * to the core's local replica (not the server: balances are unaffected). Existing ids are
   * duplicates. Compute and storage are timed separately.
   */
  ingestTransactions(json: string): Promise<IngestResult>;
  /**
   * BM-04b: hands the core side a payload to ingest later, as if it had arrived there (in a real
   * app, from the network). Not timed by the harness. Replaces any staged payload; resetData
   * leaves it alone.
   */
  stageIngestPayload(json: string): Promise<void>;
  /**
   * BM-04b: ingestTransactions on the staged payload, so no data crosses into the core during
   * the call. The payload stays staged. Throws INVALID_ARGUMENT if nothing is staged.
   */
  ingestStaged(): Promise<IngestResult>;
  /**
   * Time spent *inside* the core by the most recent Core.computeSpendingSummary,
   * ingestTransactions or formatMoneyBatch call. For kmpCore it is measured in Kotlin, so
   * end-to-end minus this = bridge overhead.
   */
  lastComputeMs(): number;
  /**
   * Database time of that same call (reading the replica for a summary, writing it for an
   * ingest). Reported separately because the two builds use different SQLite engines (ADR-0009).
   */
  lastStorageMs(): number;
  /**
   * BM-10 what-if (ADR-0010 §8), never used by the PIN: PBKDF2-HMAC-SHA256 (32 bytes) in the
   * core's own language with no native crypto library. jsCore: @noble/hashes, on the JS thread.
   * kmpCore: KotlinCrypto's pure-Kotlin HMAC, off the JS thread. `password` is ASCII, `saltHex`
   * lowercase hex, `iterations` 1..BM10_MAX_ITERATIONS, else INVALID_ARGUMENT. Lowercase hex out.
   */
  pbkdf2WhatIf(password: string, saltHex: string, iterations: number): Promise<string>;
}
