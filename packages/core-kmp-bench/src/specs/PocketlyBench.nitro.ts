import type { HybridObject } from 'react-native-nitro-modules';
// Struct types come from the contract, as in core-kmp (NFR-ARCH-05).
import type { IngestResult } from '@pocketly/core-contract';

/**
 * Benchmark-only entry points of the running kmpCore (BenchCore, core-contract/src/bench.ts),
 * as a second Nitro object with its own native library (libPocketlyCoreKmpBench.so), linked
 * into kmpCorePerf only. Implemented by `HybridPocketlyBench` over shared/bench's
 * `PocketlyBench`, which works on the same core instance as `PocketlyCore`.
 *
 * A call here crosses JS → Nitro → Kotlin exactly like a call to `PocketlyCore`, so BM-06's
 * `echo` measures the same crossing as before. Android only: iOS has no perf build yet.
 */
export interface PocketlyBench extends HybridObject<{ android: 'kotlin' }> {
  echo(value: number): number;
  formatMoneyBatch(minors: number[]): string[];
  ingestTransactions(json: string): Promise<IngestResult>;
  stageIngestPayload(json: string): Promise<void>;
  ingestStaged(): Promise<IngestResult>;
  lastComputeMs(): number;
  lastStorageMs(): number;
  pbkdf2WhatIf(password: string, saltHex: string, iterations: number): Promise<string>;
}
