import type { Transaction } from '@pocketly/core-contract';
import { dayLabel, localDayKey } from '../home/presentation';

export type HistoryRow =
  | { kind: 'day'; key: string; title: string }
  | { kind: 'tx'; key: string; tx: Transaction };

/**
 * Flattens newest-first transactions into rows with a header per local day (FR-HIST-02).
 * `dayIndices` are the header rows, for sticky headers.
 */
export function toRows(items: readonly Transaction[], now: number): { rows: HistoryRow[]; dayIndices: number[] } {
  const rows: HistoryRow[] = [];
  const dayIndices: number[] = [];
  let day: string | null = null;
  for (const tx of items) {
    const key = localDayKey(tx.createdAt);
    if (key !== day) {
      day = key;
      dayIndices.push(rows.length);
      rows.push({ kind: 'day', key: `day-${key}`, title: dayLabel(tx.createdAt, now) });
    }
    rows.push({ kind: 'tx', key: tx.id, tx });
  }
  return { rows, dayIndices };
}
