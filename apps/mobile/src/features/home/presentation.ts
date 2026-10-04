import type { Category, Transaction, TransactionStatus, TransactionType } from '@pocketly/core-contract';

/**
 * Display mapping only: labels, tones and dates. Amounts are formatted by the core
 * (core.formatMoney) and nothing here does money arithmetic (NFR-ARCH-01).
 */

export const TYPE_LABEL: Record<TransactionType, string> = {
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'P2P Transfer',
  QR_PAYMENT: 'QR Pay',
  TOP_UP: 'Account Top-Up',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  FOOD: 'Food & Drink',
  TRANSPORT: 'Transport',
  SHOPPING: 'Shopping',
  BILLS: 'Bills',
  ENTERTAINMENT: 'Entertainment',
  TRANSFER: 'Transfer',
  TOP_UP: 'Top-Up',
};

/** Money coming in shows a leading "+" and the positive tone. */
export function isIncoming(type: TransactionType): boolean {
  return type === 'TRANSFER_IN' || type === 'TOP_UP';
}

export type Tone = 'neutral' | 'positive' | 'warning' | 'danger';

export interface StatusBadge {
  label: string;
  tone: Tone;
  /** Pill for states that need attention; plain caption otherwise. */
  pill: boolean;
}

const ATTENTION: Partial<Record<TransactionStatus, StatusBadge>> = {
  PENDING: { label: 'Pending', tone: 'warning', pill: true },
  FAILED: { label: 'Failed', tone: 'danger', pill: true },
  REVERSED: { label: 'Reversed', tone: 'neutral', pill: true },
};

/** NFR-A11Y-03: every status has a text label, never color alone. */
export function statusBadge(tx: Transaction): StatusBadge {
  const attention = ATTENTION[tx.status];
  if (attention) return attention;
  if (tx.type === 'QR_PAYMENT') return { label: CATEGORY_LABEL[tx.category], tone: 'neutral', pill: false };
  if (tx.type === 'TOP_UP') return { label: 'Settled', tone: 'positive', pill: false };
  return { label: 'Completed', tone: 'positive', pill: false };
}

export function counterpartyName(tx: Transaction): string {
  return tx.counterparty?.name ?? TYPE_LABEL[tx.type];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/**
 * "Today, 09:40 AM" / "Yesterday" / "Oct 2" (FR-HIST-02 wording), in the device's zone.
 * `now` is the backend's clock (wallet.updatedAt), which in the app is the device clock.
 */
export function relativeDay(ms: number, now: number): string {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(ms)) / 86_400_000);
  if (days <= 0) return `Today, ${formatTime(ms)}`;
  if (days === 1) return 'Yesterday';
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Local `YYYY-MM` of a timestamp: the month the core resolves in the same device zone. */
export function localMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Stable pastel-ish avatar color per counterparty id. */
const AVATAR_COLORS = ['#3B5BDB', '#7048E8', '#0CA678', '#E8590C', '#C2255C', '#1098AD', '#5C940D', '#AE3EC9'];
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
