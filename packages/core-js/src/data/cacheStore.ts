import { CoreError } from '@pocketly/core-contract';
import type { Transaction, TransactionPage, TxFilter, Wallet } from '@pocketly/core-contract';
import { CACHE_SCHEMA, CACHE_SQL } from './db/sql.generated';
import { rowToTransaction, transactionValues } from './db/rows';
import { bind, migrate, type SqlDriver } from './db/sqlDriver';

const CURSOR = /^(\d+):(.+)$/;
const META_SYNC_TOKEN = 'syncToken';
const META_LAST_SYNCED_AT = 'lastSyncedAt';
const META_INSTALL_ID = 'installId';

/** ",A,B," for the shared SQL's instr() filter; '' = no filter. */
function filterList(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? `,${values.join(',')},` : '';
}

/**
 * The app's local replica (pocketly-cache.db, FR-HIST-04, ADR-0009). Never written by the
 * fake backend. Mirrors shared/.../data/CacheStore.kt.
 */
export class CacheStore {
  private cleared = 0;

  constructor(private readonly db: SqlDriver) {}

  /**
   * Changes with every clear(). Work that fetched from the server before a clear (logout,
   * NFR-SEC-05) compares it before writing, so it can't put the old data back.
   */
  get generation(): number {
    return this.cleared;
  }

  init(): Promise<void> {
    return migrate(this.db, CACHE_SCHEMA);
  }

  async clear(): Promise<void> {
    this.cleared++;
    await this.db.run(CACHE_SQL.deleteAllTransactions.sql, []);
    await this.db.run(CACHE_SQL.deleteWallet.sql, []);
    await this.db.run(CACHE_SQL.deleteSyncMeta.sql, []);
  }

  async upsertMany(transactions: readonly Transaction[]): Promise<void> {
    await this.db.runMany(CACHE_SQL.upsertTransaction.sql, transactions.map(transactionValues));
  }

  /** BM-04 write step: inserts rows whose id isn't cached yet; returns how many were inserted. */
  insertIfAbsentMany(transactions: readonly Transaction[]): Promise<number> {
    return this.db.runMany(CACHE_SQL.insertTransactionIfAbsent.sql, transactions.map(transactionValues));
  }

  async get(id: string): Promise<Transaction | undefined> {
    const [row] = await this.db.query(CACHE_SQL.getTransaction.sql, [id]);
    return row ? rowToTransaction(row) : undefined;
  }

  /** FR-HIST-01: newest first, cursor = (createdAt, id) of the last row; no offsets. */
  async page(cursor: string | undefined, limit: number, filter?: TxFilter): Promise<TransactionPage> {
    const types = filterList(filter?.types);
    const statuses = filterList(filter?.statuses);
    let rows;
    if (cursor === undefined) {
      const q = CACHE_SQL.pageFirst;
      rows = await this.db.query(q.sql, bind(q, { types, statuses, limit: limit + 1 }));
    } else {
      const m = CURSOR.exec(cursor);
      if (m === null) throw new CoreError('INVALID_ARGUMENT', 'Malformed cursor');
      const q = CACHE_SQL.pageAfter;
      rows = await this.db.query(
        q.sql,
        bind(q, { afterCreatedAt: Number(m[1]), afterId: m[2], types, statuses, limit: limit + 1 }),
      );
    }
    const items = rows.slice(0, limit).map(rowToTransaction);
    if (rows.length > limit) {
      const last = items[items.length - 1];
      return { items, nextCursor: `${last.createdAt}:${last.id}` };
    }
    return { items };
  }

  /** BM-03 storage step: the whole replica, newest first. */
  async all(): Promise<Transaction[]> {
    return (await this.db.query(CACHE_SQL.allTransactions.sql, [])).map(rowToTransaction);
  }

  async upsertWallet(wallet: Wallet, cachedAt: number): Promise<void> {
    await this.db.run(CACHE_SQL.upsertWallet.sql, [
      wallet.id,
      wallet.balance,
      wallet.dailyLimit,
      wallet.usedToday,
      wallet.updatedAt,
      cachedAt,
    ]);
  }

  async getWallet(): Promise<{ wallet: Wallet; cachedAt: number } | undefined> {
    const [r] = await this.db.query(CACHE_SQL.getWallet.sql, []);
    if (!r) return undefined;
    return {
      wallet: {
        id: r.id as string,
        balance: r.balance as number,
        dailyLimit: r.daily_limit as number,
        usedToday: r.used_today as number,
        updatedAt: r.updated_at as number,
      },
      cachedAt: r.cached_at as number,
    };
  }

  async syncToken(): Promise<string | undefined> {
    return this.getMeta(META_SYNC_TOKEN);
  }

  async lastSyncedAt(): Promise<number | undefined> {
    const v = await this.getMeta(META_LAST_SYNCED_AT);
    return v === undefined ? undefined : Number(v);
  }

  /** One write, so a clear() can't land between the token and the time. */
  async markSynced(token: string | undefined, at: number): Promise<void> {
    const rows: string[][] = [[META_LAST_SYNCED_AT, String(at)]];
    if (token !== undefined) rows.unshift([META_SYNC_TOKEN, token]);
    await this.db.runMany(CACHE_SQL.setMeta.sql, rows);
  }

  /** ADR-0010: identifies this install. clear() keeps it; only uninstalling the app removes it. */
  installId(): Promise<string | undefined> {
    return this.getMeta(META_INSTALL_ID);
  }

  setInstallId(id: string): Promise<void> {
    return this.setMeta(META_INSTALL_ID, id);
  }

  private async getMeta(key: string): Promise<string | undefined> {
    const [row] = await this.db.query(CACHE_SQL.getMeta.sql, [key]);
    return row ? (row.value as string) : undefined;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    await this.db.run(CACHE_SQL.setMeta.sql, [key, value]);
  }
}
