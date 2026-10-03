import type { Transaction, TransactionType } from '@pocketly/core-contract';

/** Mirrors shared/.../domain/Ledger.kt. */

export function isOutgoing(type: TransactionType): boolean {
  return type === 'TRANSFER_OUT' || type === 'QR_PAYMENT';
}

/**
 * FR-FAKE-06: the balance is derived from ledger entries.
 * Successful entries move money; pending outgoing entries hold funds; failed/reversed do nothing.
 */
export function ledgerEffect(tx: Transaction): number {
  switch (tx.status) {
    case 'SUCCESS':
      return isOutgoing(tx.type) ? -tx.amount : tx.amount;
    case 'PENDING':
      return isOutgoing(tx.type) ? -tx.amount : 0;
    default:
      return 0;
  }
}

/** Counts toward the daily transfer limit (FR-TRF-10). */
export function countsTowardDailyLimit(tx: Transaction): boolean {
  return isOutgoing(tx.type) && (tx.status === 'SUCCESS' || tx.status === 'PENDING');
}
