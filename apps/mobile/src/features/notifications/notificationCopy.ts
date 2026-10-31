import type { AppNotification } from '@pocketly/core-contract';
import { core } from '../../core';

/** What a notification says (ADR-0017 §3: the words are the app's, the amounts the core's). */
export interface NotificationText {
  title: string;
  body: string;
}

const NOUN = { TRANSFER_OUT: 'transfer', TOP_UP: 'top-up', QR_PAYMENT: 'payment' } as const;
const TITLE_DONE = { TRANSFER_OUT: 'Transfer sent', TOP_UP: 'Money added', QR_PAYMENT: 'Payment complete' } as const;
const TITLE_FAILED = {
  TRANSFER_OUT: 'Transfer failed',
  TOP_UP: 'Top-up failed',
  QR_PAYMENT: 'Payment failed',
} as const;

export function notificationText(n: AppNotification): NotificationText {
  const tx = n.transaction;
  const amount = core.formatMoney(tx.amount);
  const name = tx.counterparty?.name;
  if (n.kind === 'MONEY_RECEIVED') return { title: 'Money received', body: `+${amount} from ${name ?? 'a contact'}` };
  const kind = tx.type === 'TOP_UP' || tx.type === 'QR_PAYMENT' ? tx.type : 'TRANSFER_OUT';
  const ok = tx.status === 'SUCCESS';
  // A top-up names no person; a transfer or payment names who it went to.
  const what = kind === 'TOP_UP' ? `Your top-up of ${amount}` : `Your ${NOUN[kind]} of ${amount} to ${name ?? 'them'}`;
  return {
    title: ok ? TITLE_DONE[kind] : TITLE_FAILED[kind],
    body: ok ? `${what} went through` : `${what} didn't go through`,
  };
}

/** FR-NOTIF-03: the bell's badge. Nothing at 0, "9+" above 9. */
export function badgeLabel(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}
