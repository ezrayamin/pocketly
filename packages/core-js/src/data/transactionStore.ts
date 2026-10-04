import { CoreError } from '@pocketly/core-contract';
import type { Transaction, TransactionPage, TxFilter } from '@pocketly/core-contract';
import { countsTowardDailyLimit, ledgerEffect } from '../domain/ledger';

/**
 * Local transaction cache (FR-HIST-04). In-memory for now; SQLite comes with BM-04
 * storage work (BM-PAR-03, see ADR-0004). Mirrors shared/.../data/TransactionStore.kt.
 */
export interface TransactionStore {
  replaceAll(transactions: Transaction[]): void;
  /** Inserts and re-sorts. Callers must have filtered out existing ids. */
  insertAll(transactions: Transaction[]): void;
  has(id: string): boolean;
  get(id: string): Transaction | undefined;
  /** Newest first. */
  all(): readonly Transaction[];
  page(cursor: string | undefined, limit: number, filter?: TxFilter): TransactionPage;
  balance(): number;
  /** Outgoing money counting toward the daily limit (FR-TRF-10) created at or after `from`. */
  usedSince(from: number): number;
}

/** Newest first; ties broken by id descending so the order is total. */
function compareNewestFirst(a: Transaction, b: Transaction): number {
  if (a.createdAt !== b.createdAt) {
    return b.createdAt - a.createdAt;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

const CURSOR_PATTERN = /^(\d+):(.+)$/;

function encodeCursor(tx: Transaction): string {
  return `${tx.createdAt}:${tx.id}`;
}

function matches(tx: Transaction, filter: TxFilter | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter.types !== undefined && filter.types.length > 0 && !filter.types.includes(tx.type)) {
    return false;
  }
  if (filter.statuses !== undefined && filter.statuses.length > 0 && !filter.statuses.includes(tx.status)) {
    return false;
  }
  return true;
}

export class InMemoryTransactionStore implements TransactionStore {
  private items: Transaction[] = [];
  private byId = new Map<string, Transaction>();
  private runningBalance = 0;

  replaceAll(transactions: Transaction[]): void {
    this.items = [];
    this.byId.clear();
    this.runningBalance = 0;
    this.insertAll(transactions);
  }

  insertAll(transactions: Transaction[]): void {
    for (const tx of transactions) {
      this.items.push(tx);
      this.byId.set(tx.id, tx);
      this.runningBalance += ledgerEffect(tx);
    }
    this.items.sort(compareNewestFirst);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): Transaction | undefined {
    return this.byId.get(id);
  }

  all(): readonly Transaction[] {
    return this.items;
  }

  balance(): number {
    return this.runningBalance;
  }

  usedSince(from: number): number {
    // Newest first, so stop at the first older entry.
    let used = 0;
    for (const tx of this.items) {
      if (tx.createdAt < from) break;
      if (countsTowardDailyLimit(tx)) used += tx.amount;
    }
    return used;
  }

  page(cursor: string | undefined, limit: number, filter?: TxFilter): TransactionPage {
    let index = 0;
    if (cursor !== undefined) {
      const match = CURSOR_PATTERN.exec(cursor);
      if (match === null) {
        throw new CoreError('INVALID_ARGUMENT', 'Malformed cursor');
      }
      index = this.firstAfter(Number(match[1]), match[2]);
    }

    const items: Transaction[] = [];
    for (; index < this.items.length; index++) {
      const tx = this.items[index];
      if (!matches(tx, filter)) {
        continue;
      }
      if (items.length === limit) {
        return { items, nextCursor: encodeCursor(items[items.length - 1]) };
      }
      items.push(tx);
    }
    return { items };
  }

  /** Binary search: first index whose item sorts strictly after (createdAt, id). */
  private firstAfter(createdAt: number, id: string): number {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const tx = this.items[mid];
      const after = tx.createdAt < createdAt || (tx.createdAt === createdAt && tx.id < id);
      if (after) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return lo;
  }
}
