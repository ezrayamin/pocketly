import type { Transaction } from '@pocketly/core-contract';
import { CATEGORY_LABEL, STATUS_LABEL, TYPE_LABEL, counterpartyName, formatDateTime } from '../home/presentation';

/**
 * Plain-text receipt for the share sheet (FR-HIST-05). `amount` comes formatted from the
 * core (NFR-ARCH-01): no money formatting happens here.
 */
export function receiptText(tx: Transaction, amount: string): string {
  const lines = [
    'Pocketly receipt',
    '',
    `${TYPE_LABEL[tx.type]}: ${counterpartyName(tx)}`,
    `Amount: ${amount}`,
    `Status: ${STATUS_LABEL[tx.status]}`,
    `Category: ${CATEGORY_LABEL[tx.category]}`,
    `Date: ${formatDateTime(tx.createdAt)}`,
  ];
  if (tx.note) lines.push(`Note: ${tx.note}`);
  lines.push(`Transaction ID: ${tx.id}`);
  return lines.join('\n');
}
