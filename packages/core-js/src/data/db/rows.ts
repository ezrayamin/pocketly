import type { Counterparty, ErrorCode, Transaction } from '@pocketly/core-contract';
import type { SqlRow, SqlValue } from './sqlDriver';

/** Column order of server_transaction / cache_transaction (the .sq INSERT statements). */
export function transactionValues(tx: Transaction): SqlValue[] {
  const cp = tx.counterparty;
  return [
    tx.id,
    tx.idempotencyKey,
    tx.type,
    tx.category,
    tx.amount,
    cp?.kind ?? null,
    cp?.id ?? null,
    cp?.name ?? null,
    cp?.phone ?? null,
    tx.note ?? null,
    tx.status,
    tx.failureReason ?? null,
    tx.createdAt,
    tx.updatedAt,
  ];
}

/** Row → Transaction, fields in the contract's order, absent optionals omitted (matches the fixtures). */
export function rowToTransaction(r: SqlRow): Transaction {
  const present = (v: SqlValue | undefined): v is string => v !== null && v !== undefined;
  const counterparty: Counterparty | undefined = present(r.counterparty_kind)
    ? {
        kind: r.counterparty_kind as Counterparty['kind'],
        id: r.counterparty_id as string,
        name: r.counterparty_name as string,
        ...(present(r.counterparty_phone) ? { phone: r.counterparty_phone } : {}),
      }
    : undefined;
  return {
    id: r.id as string,
    idempotencyKey: r.idempotency_key as string,
    type: r.type as Transaction['type'],
    category: r.category as Transaction['category'],
    amount: r.amount as number,
    ...(counterparty ? { counterparty } : {}),
    ...(present(r.note) ? { note: r.note } : {}),
    status: r.status as Transaction['status'],
    ...(present(r.failure_reason) ? { failureReason: r.failure_reason as ErrorCode } : {}),
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}
