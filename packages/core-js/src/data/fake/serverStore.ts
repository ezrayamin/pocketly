import type { ErrorCode, Transaction, TransactionStatus } from '@pocketly/core-contract';
import { bind, migrate, type SqlCommand, type SqlDriver, type SqlRow } from '../db/sqlDriver';
import { SERVER_MIGRATIONS, SERVER_SCHEMA, SERVER_SQL, SERVER_VERSION } from '../db/sql.generated';
import { rowToTransaction, transactionValues } from '../db/rows';

/** server_transfer_key: the request a key was first used for (FR-FAKE-02/03). */
export interface TransferKeyRow {
  /** A transfer's recipient, a top-up's payment method, a QR payment's merchant. */
  recipientId: string;
  amount: number;
  note?: string;
  transactionId: string;
  /** A QR payment's payment request (ADR-0016 §4). */
  requestId?: string;
}

/** server_event: one entry of the event log the client catches up from (ADR-0017 §1). */
export interface EventRow {
  seq: number;
  kind: 'MONEY_RECEIVED' | 'TRANSACTION_SETTLED';
  transactionId: string;
  createdAt: number;
}

/** server_payment_request: a dynamic QR code's request (ADR-0016 §4). */
export interface PaymentRequestRow {
  id: string;
  merchantId: string;
  amount: number;
  expiresAt: number;
  /** The transaction that paid it, 'external' for a seeded paid one; absent while open. */
  paidBy?: string;
}

/** server_pending_settlement: a held transfer or a top-up being processed, and how it ends. */
export interface SettlementRow {
  transactionId: string;
  resolveAt: number;
  fails: boolean;
  /** The code a failing row settles with; absent means SERVER_ERROR (rows from schema 2). */
  failureReason?: ErrorCode;
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

  async replaceAll(
    transactions: readonly Transaction[],
    paymentRequests: readonly PaymentRequestRow[],
    meta: Record<string, string>,
  ): Promise<void> {
    await this.db.run(SERVER_SQL.deleteAllTransactions.sql, []);
    await this.db.run(SERVER_SQL.deleteAllMeta.sql, []);
    await this.db.run(SERVER_SQL.deleteAllTransferKeys.sql, []);
    await this.db.run(SERVER_SQL.deleteAllSettlements.sql, []);
    await this.db.run(SERVER_SQL.deleteAllPaymentRequests.sql, []);
    await this.db.run(SERVER_SQL.deleteAllEvents.sql, []);
    await this.db.runMany(SERVER_SQL.insertTransaction.sql, transactions.map(transactionValues));
    await this.db.runMany(
      SERVER_SQL.insertPaymentRequest.sql,
      paymentRequests.map((r) => [r.id, r.merchantId, r.amount, r.expiresAt, r.paidBy ?? null]),
    );
    for (const [key, value] of Object.entries(meta)) await this.setMeta(key, value);
  }

  /** An incoming transfer, the meta that counts it, and its MONEY_RECEIVED event: all or nothing (ADR-0017 §1). */
  async insertIncoming(tx: Transaction, meta: Record<string, string>): Promise<void> {
    await this.db.batch([
      { sql: SERVER_SQL.insertTransaction.sql, values: transactionValues(tx) },
      ...Object.entries(meta).map(([k, v]) => ({ sql: SERVER_SQL.setMeta.sql, values: [k, v] })),
      { sql: SERVER_SQL.insertEvent.sql, values: ['MONEY_RECEIVED', tx.id, tx.createdAt] },
    ]);
  }

  /** The log after `seq`, oldest first. */
  async eventsAfter(seq: number, limit: number): Promise<EventRow[]> {
    return (await this.db.query(SERVER_SQL.eventsAfter.sql, [seq, limit])).map((r) => ({
      seq: Number(r.seq),
      kind: r.kind as EventRow['kind'],
      transactionId: r.transaction_id as string,
      createdAt: Number(r.created_at),
    }));
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
      ...(row.request_id != null ? { requestId: row.request_id as string } : {}),
    };
  }

  /**
   * A new transfer, top-up or QR payment, its key, the meta that counts it, its settlement, and
   * the payment request it pays: all or nothing.
   */
  async recordTransfer(
    tx: Transaction,
    key: TransferKeyRow,
    meta: Record<string, string>,
    settlement?: Omit<SettlementRow, 'transactionId'>,
    paysRequest?: string,
  ): Promise<void> {
    const commands: SqlCommand[] = [
      { sql: SERVER_SQL.insertTransaction.sql, values: transactionValues(tx) },
      {
        sql: SERVER_SQL.insertTransferKey.sql,
        values: [
          tx.idempotencyKey,
          key.recipientId,
          key.amount,
          key.note ?? null,
          key.transactionId,
          key.requestId ?? null,
        ],
      },
      ...Object.entries(meta).map(([k, v]) => ({ sql: SERVER_SQL.setMeta.sql, values: [k, v] })),
    ];
    if (paysRequest !== undefined) {
      commands.push({ sql: SERVER_SQL.markPaymentRequestPaid.sql, values: [tx.id, paysRequest] });
    }
    if (settlement) {
      commands.push({
        sql: SERVER_SQL.insertSettlement.sql,
        values: [tx.id, settlement.resolveAt, settlement.fails ? 1 : 0, settlement.failureReason ?? null],
      });
    }
    await this.db.batch(commands);
  }

  async dueSettlements(now: number): Promise<SettlementRow[]> {
    return (await this.db.query(SERVER_SQL.dueSettlements.sql, [now])).map(rowToSettlement);
  }

  async getSettlement(transactionId: string): Promise<SettlementRow | undefined> {
    const [row] = await this.db.query(SERVER_SQL.getSettlement.sql, [transactionId]);
    return row ? rowToSettlement(row) : undefined;
  }

  /**
   * Settles a held transaction: its new status, the settlement row removed, and the
   * TRANSACTION_SETTLED event (ADR-0017 §1), together. A failed QR payment gives its payment request
   * back (ADR-0016 §4).
   */
  async settle(id: string, status: TransactionStatus, failureReason: ErrorCode | undefined, updatedAt: number): Promise<void> {
    await this.db.batch([
      { sql: SERVER_SQL.updateTransactionStatus.sql, values: [status, failureReason ?? null, updatedAt, id] },
      { sql: SERVER_SQL.deleteSettlement.sql, values: [id] },
      { sql: SERVER_SQL.insertEvent.sql, values: ['TRANSACTION_SETTLED', id, updatedAt] },
      ...(status === 'FAILED' ? [{ sql: SERVER_SQL.reopenPaymentRequest.sql, values: [id] }] : []),
    ]);
  }

  async getPaymentRequest(id: string): Promise<PaymentRequestRow | undefined> {
    const [r] = await this.db.query(SERVER_SQL.getPaymentRequest.sql, [id]);
    if (!r) return undefined;
    return {
      id: r.id as string,
      merchantId: r.merchant_id as string,
      amount: Number(r.amount),
      expiresAt: Number(r.expires_at),
      ...(r.paid_by != null ? { paidBy: r.paid_by as string } : {}),
    };
  }

  async getMeta(key: string): Promise<string | undefined> {
    const [row] = await this.db.query(SERVER_SQL.getMeta.sql, [key]);
    return row ? (row.value as string) : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run(SERVER_SQL.setMeta.sql, [key, value]);
  }
}

function rowToSettlement(r: SqlRow): SettlementRow {
  return {
    transactionId: r.transaction_id as string,
    resolveAt: Number(r.resolve_at),
    fails: Number(r.fails) !== 0,
    ...(r.failure_reason != null ? { failureReason: r.failure_reason as ErrorCode } : {}),
  };
}
