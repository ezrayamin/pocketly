import { DEFAULT_DATASET, DEFAULT_NOW_MILLIS, MAX_PAGE_SIZE } from '@pocketly/core-contract';
import type { DatasetConfig, Transaction } from '@pocketly/core-contract';
import { core } from '../core';

/**
 * In-app benchmark harness (docs/benchmarking.md §5.2): runs core operations N times in the
 * app process and reports, per run, the end-to-end time measured here in JS and the core's
 * own compute and storage times (`lastComputeMs`, `lastStorageMs`). For kmpCore,
 * end-to-end − compute − storage is the bridge overhead.
 *
 * Inputs are built through the `Core` API, not from bundled files: the contract suites
 * guarantee both cores return the same data, so both builds get byte-identical inputs and
 * neither bundle carries the other core's code (BM-08). Each result includes a checksum of its
 * input and of its output so collect.ts can confirm both builds did the same work.
 */
export const BENCH_SCENARIOS = ['BM-03', 'BM-04', 'BM-06'] as const;
export type BenchScenario = (typeof BENCH_SCENARIOS)[number];

/** One measured run. Keys depend on the scenario; all values are milliseconds. */
export type BenchRun = Record<string, number>;

export interface BenchResult {
  scenario: BenchScenario;
  build: 'js' | 'kmp';
  warmup: number;
  runs: BenchRun[];
  /** What was measured, and checksums that must match across builds. */
  input: { description: string; checksum: string };
  output: { description: string; checksum: string };
  setupMs: number;
}

export interface BenchOptions {
  runs: number;
  warmup: number;
  /** Tests only: smaller datasets. */
  scale?: number;
  onProgress?: (done: number, total: number) => void;
}

/** BM-03: 10,000 ledger entries (benchmarks/fixtures/tx-10k.json), September 2026. */
const BM03_DATASET: DatasetConfig = { seed: 7, transactionCount: 10_000, nowMillis: DEFAULT_NOW_MILLIS };
const BM03_MONTH = '2026-09';
/** BM-04: 5,000 entries (benchmarks/fixtures/ingest-5k.json: seed 2026, ids "in-…"). */
const BM04_SOURCE: DatasetConfig = { seed: 2026, transactionCount: 5_000, nowMillis: DEFAULT_NOW_MILLIS };
/** BM-06: amounts to format. */
const BM06_COUNT = 10_000;

// Hermes provides the High Resolution Time API; the app's TS lib config doesn't declare it.
declare const performance: { now(): number };
const now = () => performance.now();

/** FNV-1a, 32-bit, hex: enough to tell whether two builds saw the same bytes. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line no-bitwise -- FNV-1a is defined on 32-bit integers
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // eslint-disable-next-line no-bitwise -- unsigned 32-bit
  return (h >>> 0).toString(16).padStart(8, '0') + `:${text.length}`;
}

/** Every transaction in the replica, oldest first. */
async function allTransactions(): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let cursor: string | undefined;
  do {
    const page = await core.getTransactions(cursor, MAX_PAGE_SIZE);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all.reverse();
}

/** Fixed key order, absent optionals omitted: the same JSON text from either core. */
function canonical(tx: Transaction): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: tx.id,
    idempotencyKey: tx.idempotencyKey,
    type: tx.type,
    category: tx.category,
    amount: tx.amount,
  };
  if (tx.counterparty) {
    const c = tx.counterparty;
    out.counterparty = c.phone === undefined ? { kind: c.kind, id: c.id, name: c.name } : { kind: c.kind, id: c.id, name: c.name, phone: c.phone };
  }
  if (tx.note !== undefined) out.note = tx.note;
  out.status = tx.status;
  if (tx.failureReason !== undefined) out.failureReason = tx.failureReason;
  out.createdAt = tx.createdAt;
  out.updatedAt = tx.updatedAt;
  return out;
}

function scaled(config: DatasetConfig, scale = 1): DatasetConfig {
  return { ...config, transactionCount: Math.max(2, Math.round(config.transactionCount * scale)) };
}

/** Deterministic amounts for BM-06 (no Math.random: both builds format the same numbers). */
function amounts(count: number): number[] {
  const out: number[] = [];
  let x = 12345;
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-bitwise -- 32-bit LCG
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out.push(x % 100_000_000); // up to 999,999.99
  }
  return out;
}

async function repeat(options: BenchOptions, body: () => Promise<BenchRun>): Promise<BenchRun[]> {
  const total = options.warmup + options.runs;
  const runs: BenchRun[] = [];
  for (let i = 0; i < total; i++) {
    const run = await body();
    if (i >= options.warmup) runs.push(run);
    options.onProgress?.(i + 1, total);
  }
  return runs;
}

export async function runBench(scenario: BenchScenario, options: BenchOptions): Promise<BenchResult> {
  const build = core.impl;
  const setupStart = now();
  switch (scenario) {
    case 'BM-03': {
      await core.resetData(scaled(BM03_DATASET, options.scale)); // also syncs the replica
      const month = BM03_MONTH;
      const setupMs = now() - setupStart;
      let last = '';
      const runs = await repeat(options, async () => {
        const t0 = now();
        const summary = await core.computeSpendingSummary(month);
        const endToEndMs = now() - t0;
        last = JSON.stringify(summary);
        return { endToEndMs, computeMs: core.lastComputeMs(), storageMs: core.lastStorageMs() };
      });
      return {
        scenario,
        build,
        warmup: options.warmup,
        runs,
        input: { description: `seed ${BM03_DATASET.seed} × ${scaled(BM03_DATASET, options.scale).transactionCount}, month ${month}`, checksum: checksum(JSON.stringify(await allTransactions())) },
        output: { description: 'SpendingSummary JSON', checksum: checksum(last) },
        setupMs,
      };
    }
    case 'BM-04': {
      await core.resetData(scaled(BM04_SOURCE, options.scale));
      const payload = JSON.stringify((await allTransactions()).map((tx) => canonical({ ...tx, id: tx.id.replace(/^tx-/, 'in-') })));
      const setupMs = now() - setupStart;
      let last = '';
      const runs = await repeat(options, async () => {
        await core.resetData(DEFAULT_DATASET); // same starting replica for every run (not timed)
        const t0 = now();
        const result = await core.ingestTransactions(payload);
        const endToEndMs = now() - t0;
        last = JSON.stringify(result);
        return { endToEndMs, computeMs: core.lastComputeMs(), storageMs: core.lastStorageMs() };
      });
      return {
        scenario,
        build,
        warmup: options.warmup,
        runs,
        input: { description: `ingest payload: seed ${BM04_SOURCE.seed} × ${scaled(BM04_SOURCE, options.scale).transactionCount}, ids "in-…", onto DEFAULT_DATASET`, checksum: checksum(payload) },
        output: { description: 'IngestResult JSON', checksum: checksum(last) },
        setupMs,
      };
    }
    case 'BM-06': {
      const minors = amounts(Math.max(2, Math.round(BM06_COUNT * (options.scale ?? 1))));
      const echoTotal = minors.reduce((a, b) => a + b, 0);
      const setupMs = now() - setupStart;
      let last = '';
      const runs = await repeat(options, async () => {
        const t0 = now();
        const one: string[] = new Array(minors.length);
        for (let i = 0; i < minors.length; i++) one[i] = core.formatMoney(minors[i]);
        const chattyEndToEndMs = now() - t0;
        const t1 = now();
        const batch = core.formatMoneyBatch(minors);
        const batchEndToEndMs = now() - t1;
        // Pure call cost: the same number of calls as the chatty loop, with no work in the core.
        const t2 = now();
        let echoed = 0;
        for (let i = 0; i < minors.length; i++) echoed += core.echo(minors[i]);
        const echoEndToEndMs = now() - t2;
        const formatted = one.join('|') === batch.join('|') ? batch.join('|') : 'MISMATCH';
        last = echoed === echoTotal ? formatted : 'MISMATCH';
        return { chattyEndToEndMs, batchEndToEndMs, batchComputeMs: core.lastComputeMs(), echoEndToEndMs };
      });
      return {
        scenario,
        build,
        warmup: options.warmup,
        runs,
        input: { description: `${minors.length} amounts, LCG seed 12345`, checksum: checksum(minors.join(',')) },
        output: { description: 'formatted amounts (chatty and batch must match; echo must return its inputs)', checksum: checksum(last) },
        setupMs,
      };
    }
  }
}

/** logcat entries are capped at ~4 KB; results go out in numbered chunks the runner joins. */
export function logResult(result: BenchResult): void {
  const json = JSON.stringify(result);
  const size = 3000;
  const parts = Math.ceil(json.length / size);
  for (let i = 0; i < parts; i++) {
    console.info(`[Pocketly] bench-chunk ${i + 1}/${parts} ${json.slice(i * size, (i + 1) * size)}`);
  }
  console.info(`[Pocketly] bench-done ${result.scenario} ${result.build}`);
}
