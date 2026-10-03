/**
 * Writes the benchmark datasets (benchmarking.md §3.1 `benchmarks/fixtures/`):
 * tx-200.json, tx-1k.json, tx-10k.json, plus ingest-5k.json for BM-04.
 * Both cores can also regenerate these in-process from the same seed (BM-PAR-04).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DATASET } from '@pocketly/core-contract';
import { generateTransactions } from '../src/data/seedData';

const dir = join(__dirname, '../../../benchmarks/fixtures');
mkdirSync(dir, { recursive: true });

const sets: [string, number, number][] = [
  ['tx-200.json', 42, 200],
  ['tx-1k.json', 42, 1_000],
  ['tx-10k.json', 7, 10_000],
  // Distinct seed + id prefix so the BM-04 payload never collides with the seeded ledger.
  ['ingest-5k.json', 2026, 5_000],
];

for (const [file, seed, transactionCount] of sets) {
  let txs = generateTransactions({ ...DEFAULT_DATASET, seed, transactionCount });
  if (file.startsWith('ingest')) {
    txs = txs.map((t) => ({ ...t, id: t.id.replace('tx-', 'in-') }));
  }
  writeFileSync(join(dir, file), JSON.stringify(txs));
  console.log(`${file}: ${txs.length} transactions`);
}
