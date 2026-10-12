import type { Transaction } from '@pocketly/core-contract';
import { bind, migrate, type SqlDriver } from '../db/sqlDriver';
import { SERVER_SCHEMA, SERVER_SQL } from '../db/sql.generated';
import { rowToTransaction, transactionValues } from '../db/rows';

/**
 * The fake backend's database (pocketly-server.db, FR-FAKE-07). Only FakeWalletApi uses it.
 * Mirrors shared/.../data/fake/ServerStore.kt.
 */
export class ServerStore {
  constructor(private readonly db: SqlDriver) {}

  init(): Promise<void> {
    return migrate(this.db, SERVER_SCHEMA);
  }

  async replaceAll(transactions: readonly Transaction[], meta: Record<string, string>): Promise<void> {
    await this.db.run(SERVER_SQL.deleteAllTransactions.sql, []);
    await this.db.run(SERVER_SQL.deleteAllMeta.sql, []);
    await this.db.runMany(SERVER_SQL.insertTransaction.sql, transactions.map(transactionValues));
    for (const [key, value] of Object.entries(meta)) await this.setMeta(key, value);
  }

  async insert(tx: Transaction): Promise<void> {
    await this.db.run(SERVER_SQL.insertTransaction.sql, transactionValues(tx));
  }

  async get(id: string): Promise<Transaction | undefined> {
    const [row] = await this.db.query(SERVER_SQL.getTransaction.sql, bind(SERVER_SQL.getTransaction, [id]));
    return row ? rowToTransaction(row) : undefined;
  }

  async changesSince(afterUpdatedAt: number, afterId: string, limit: number): Promise<Transaction[]> {
    const q = SERVER_SQL.changesSince;
    return (await this.db.query(q.sql, bind(q, { afterUpdatedAt, afterId, limit }))).map(rowToTransaction);
  }

  async balance(): Promise<number> {
    const [row] = await this.db.query(SERVER_SQL.balance.sql, []);
    return Number(row.balance);
  }

  async usedSince(from: number): Promise<number> {
    const [row] = await this.db.query(SERVER_SQL.usedSince.sql, [from]);
    return Number(row.used);
  }

  async getMeta(key: string): Promise<string | undefined> {
    const [row] = await this.db.query(SERVER_SQL.getMeta.sql, [key]);
    return row ? (row.value as string) : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run(SERVER_SQL.setMeta.sql, [key, value]);
  }
}
