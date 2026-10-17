import { CoreError } from '@pocketly/core-contract';
import type { BenchCore, Core, IngestResult, MinorUnits } from '@pocketly/core-contract';
import type { JsCore } from '@pocketly/core-js';
import { parseAndValidate } from '@pocketly/core-js/src/data/transactionIngestor';
import { formatMoney } from '@pocketly/core-js/src/domain/money';
import { purePbkdf2Sha256 } from './purePbkdf2';

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/**
 * BenchCore for a jsCore (benchmarking.md §5.2). Perf bundles only: the app reaches it through
 * `@pocketly/bench-impl`, which release bundles resolve to nothing (metro.config.js).
 *
 * It works on the core's own replica and timings: the private members it needs are read with
 * element access (`core['cache']`), which TypeScript allows and which costs nothing at run time.
 * The parse/validate step is the core's own (data/transactionIngestor.ts); only these entry
 * points are bench code.
 */
export function createBench(target: Core): BenchCore {
  const core = target as JsCore;
  let staged: string | undefined;

  function timed<T>(work: () => T): T {
    const start = now();
    try {
      return work();
    } finally {
      core.computeMs = now() - start;
    }
  }

  async function ingest(json: string): Promise<IngestResult> {
    await core['ready'];
    const parsed = timed(() => parseAndValidate(json));
    const start = now();
    const inserted = await core['cache'].insertIfAbsentMany(parsed.valid);
    core.storageMs = now() - start;
    return {
      accepted: inserted,
      rejected: parsed.rejected,
      duplicates: parsed.valid.length - inserted,
      errors: parsed.errors,
    };
  }

  return {
    echo: (value: number) => value,
    formatMoneyBatch(minors: MinorUnits[]): string[] {
      core.storageMs = 0;
      return timed(() => minors.map(formatMoney));
    },
    ingestTransactions: ingest,
    async stageIngestPayload(json: string): Promise<void> {
      staged = json;
    },
    ingestStaged(): Promise<IngestResult> {
      if (staged === undefined) return Promise.reject(new CoreError('INVALID_ARGUMENT', 'no ingest payload staged'));
      return ingest(staged);
    },
    lastComputeMs: () => core.computeMs,
    lastStorageMs: () => core.storageMs,
    pbkdf2WhatIf: purePbkdf2Sha256,
  };
}
