import type { ErrorCode, Transaction, TransactionStatus } from '@pocketly/core-contract';
import { bind, migrate, type SqlCommand, type SqlDriver } from '../db/sqlDriver';
import { SERVER_MIGRATIONS, SERVER_SCHEMA, SERVER_SQL, SERVER_VERSION } from '../db/sql.generated';
import { rowToTransaction, transactionValues } from '../db/rows';

/** server_transfer_key: the request a key was first used for (FR-FAKE-02/03). */
export interface TransferKeyRow {
  recipientId: string;
  amount: number;
  note?: string;
  transactionId: string;
}

/**
 * The fake backend's database (pocketly-server.db, FR-FAKE-07). Only FakeWalletApi uses it.
 * Mirrors shared/.../data/fake/ServerStore.kt.
 */
export class ServerStore {
  constructor(private readonly db: SqlDriver) {}

  init(): Promise<void> {
    return migrate(this.db, SERVER_SCHEMA, SERVER_VERSION, SERVER_MIGRATIONS);
  }

  async replaceAll(transactions: readonly Transaction[], meta: Record<string, string>): Promise<void> {
    await this.db.run(SERVER_SQL.deleteAllTransactions.sql, []);
    await this.db.run(SERVER_SQL.deleteAllMeta.sql, []);
    await this.db.run(SERVER_SQL.deleteAllTransferKeys.sql, []);
    await this.db.run(SERVER_SQL.deleteAllSettlements.sql, []);
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

  async getTransferKey(key: string): Promise<TransferKeyRow | undefined> {
    const [row] = await this.db.query(SERVER_SQL.getTransferKey.sql, [key]);
    if (!row) return undefined;
    return {
      recipientId: row.recipient_id as string,
      amount: Number(row.amount),
      note: row.note === null ? undefined : (row.note as string),
      transactionId: row.transaction_id as string,
    };
  }

  /** A new transfer, its key, the meta that counts it, and its settlement: all or nothing. */
  async recordTransfer(
    tx: Transaction,
    key: TransferKeyRow,
    meta: Record<string, string>,
    settlement?: { resolveAt: number; fails: boolean },
  ): Promise<void> {
    const commands: SqlCommand[] = [
      { sql: SERVER_SQL.insertTransaction.sql, values: transactionValues(tx) },
      {
        sql: SERVER_SQL.insertTransferKey.sql,
        values: [tx.idempotencyKey, key.recipientId, key.amount, key.note ?? null, key.transactionId],
      },
      ...Object.entries(meta).map(([k, v]) => ({ sql: SERVER_SQL.setMeta.sql, values: [k, v] })),
    ];
    if (settlement) {
      commands.push({
        sql: SERVER_SQL.insertSettlement.sql,
        values: [tx.id, settlement.resolveAt, settlement.fails ? 1 : 0],
      });
    }
    await this.db.batch(commands);
  }

  async dueSettlements(now: number): Promise<{ transactionId: string; resolveAt: number; fails: boolean }[]> {
    return (await this.db.query(SERVER_SQL.dueSettlements.sql, [now])).map((r) => ({
      transactionId: r.transaction_id as string,
      resolveAt: Number(r.resolve_at),
      fails: Number(r.fails) !== 0,
    }));
  }

  /** Settles a held transfer: its new status, and the settlement row removed, together. */
  async settle(id: string, status: TransactionStatus, failureReason: ErrorCode | undefined, updatedAt: number): Promise<void> {
    await this.db.batch([
      { sql: SERVER_SQL.updateTransactionStatus.sql, values: [status, failureReason ?? null, updatedAt, id] },
      { sql: SERVER_SQL.deleteSettlement.sql, values: [id] },
    ]);
  }

  async getMeta(key: string): Promise<string | undefined> {
    const [row] = await this.db.query(SERVER_SQL.getMeta.sql, [key]);
    return row ? (row.value as string) : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run(SERVER_SQL.setMeta.sql, [key, value]);
  }
}
