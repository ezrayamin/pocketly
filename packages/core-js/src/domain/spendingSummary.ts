import { CoreError } from '@pocketly/core-contract';
import type { Category, CategoryTotal, DayTotal, SpendingSummary, Transaction } from '@pocketly/core-contract';
import { MILLIS_PER_DAY, isoDate } from './calendar';
import { isOutgoing, ledgerEffect } from './ledger';
import { segmentOffset, type ZonedMonth } from './zonedCalendar';

/**
 * BM-03: group by category and day, totals, balance check. `range` is the month in the
 * user's time zone (zonedCalendar.ts); days are local days.
 * Mirrors shared/.../domain/SpendingCalculator.kt — same single pass, same maps, same sorts.
 */
export function computeSpendingSummary(
  month: string,
  range: ZonedMonth | undefined,
  transactions: readonly Transaction[],
  walletBalance: number,
): SpendingSummary {
  if (range === undefined) {
    throw new CoreError('INVALID_ARGUMENT', `month must be YYYY-MM, got "${month}"`);
  }

  let totalSpent = 0;
  let totalIncome = 0;
  let transactionCount = 0;
  let ledgerBalance = 0;
  const byCategory = new Map<Category, CategoryTotal>();
  const byDay = new Map<number, { spent: number; income: number }>();

  for (const tx of transactions) {
    ledgerBalance += ledgerEffect(tx);

    if (tx.createdAt < range.start || tx.createdAt >= range.end) {
      continue;
    }
    transactionCount++;
    if (tx.status !== 'SUCCESS') {
      continue;
    }

    const dayKey = Math.floor((tx.createdAt + segmentOffset(range.segments, tx.createdAt)) / MILLIS_PER_DAY);
    let day = byDay.get(dayKey);
    if (day === undefined) {
      day = { spent: 0, income: 0 };
      byDay.set(dayKey, day);
    }

    if (isOutgoing(tx.type)) {
      totalSpent += tx.amount;
      day.spent += tx.amount;
      let cat = byCategory.get(tx.category);
      if (cat === undefined) {
        cat = { category: tx.category, total: 0, count: 0 };
        byCategory.set(tx.category, cat);
      }
      cat.total += tx.amount;
      cat.count++;
    } else {
      totalIncome += tx.amount;
      day.income += tx.amount;
    }
  }

  const categories = [...byCategory.values()].sort(
    (a, b) => b.total - a.total || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );
  const days: DayTotal[] = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, v]) => ({ date: isoDate(key), spent: v.spent, income: v.income }));

  return {
    month,
    totalSpent,
    totalIncome,
    net: totalIncome - totalSpent,
    transactionCount,
    byCategory: categories,
    byDay: days,
    balanceCheck: {
      ledgerBalance,
      walletBalance,
      consistent: ledgerBalance === walletBalance,
    },
  };
}
