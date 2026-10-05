import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Category, Transaction, TransactionType } from '@pocketly/core-contract';
import { Avatar } from '../../../components/Avatar';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Car,
  CirclePlus,
  Clapperboard,
  Coffee,
  Landmark,
  ScanLine,
  ShoppingBag,
  Zap,
  type LucideIcon,
} from '../../../components/icons';
import { core } from '../../../core';
import { colors, radius } from '../../../theme/tokens';
import { TYPE_LABEL, counterpartyName, isIncoming, relativeDay, statusBadge, type Tone } from '../presentation';

const CATEGORY_ICON: Partial<Record<Category, LucideIcon>> = {
  FOOD: Coffee,
  TRANSPORT: Car,
  SHOPPING: ShoppingBag,
  BILLS: Zap,
  ENTERTAINMENT: Clapperboard,
};

export const TYPE_ICON: Record<TransactionType, LucideIcon> = {
  TRANSFER_IN: ArrowDownLeft,
  TRANSFER_OUT: ArrowUpRight,
  QR_PAYMENT: ScanLine,
  TOP_UP: CirclePlus,
};

const TONE_COLOR: Record<Tone, string> = {
  neutral: colors.textSecondary,
  positive: colors.primary,
  warning: colors.tertiary,
  danger: colors.danger,
};

const TONE_BG: Record<Tone, string> = {
  neutral: 'rgba(255,255,255,0.08)',
  positive: colors.primaryDim,
  warning: colors.tertiaryDim,
  danger: colors.dangerDim,
};

/** The counterparty's avatar, or an icon for merchants and payment methods. */
export function TransactionLeading({ tx }: { tx: Transaction }) {
  const cp = tx.counterparty;
  if (cp?.kind === 'USER') return <Avatar id={cp.id} name={cp.name} />;
  const Icon = tx.type === 'TOP_UP' ? Landmark : CATEGORY_ICON[tx.category] ?? ScanLine;
  return (
    <View style={styles.iconCircle}>
      <Icon color={colors.textPrimary} size={20} />
    </View>
  );
}

/**
 * One History/Recent row (FR-HOME-04). Pending items are visibly marked (pill + label).
 * `when` replaces the relative day, e.g. with just the time under a History day header.
 */
export function TransactionRow({ tx, now, when: whenOverride }: { tx: Transaction; now: number; when?: string }) {
  const incoming = isIncoming(tx.type);
  const amount = `${incoming ? '+' : '-'}${core.formatMoney(tx.amount)}`;
  const badge = statusBadge(tx);
  const TypeIcon = TYPE_ICON[tx.type];
  const name = counterpartyName(tx);
  const when = whenOverride ?? relativeDay(tx.createdAt, now);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${name}, ${TYPE_LABEL[tx.type]}, ${amount}, ${badge.label}, ${when}`}
      testID={`tx-${tx.id}`}
    >
      <TransactionLeading tx={tx} />
      <View style={styles.middle}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.meta}>
          <TypeIcon color={colors.textSecondary} size={12} />
          <Text style={styles.metaText} numberOfLines={1}>
            {TYPE_LABEL[tx.type]} · {when}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, incoming && styles.amountIn, tx.status === 'FAILED' && styles.amountFailed]}>
          {amount}
        </Text>
        {badge.pill ? (
          <View style={[styles.pill, { backgroundColor: TONE_BG[badge.tone] }]}>
            <View style={[styles.pillDot, { backgroundColor: TONE_COLOR[badge.tone] }]} />
            <Text style={[styles.pillText, { color: TONE_COLOR[badge.tone] }]}>{badge.label}</Text>
          </View>
        ) : (
          <Text style={[styles.badgeText, { color: TONE_COLOR[badge.tone] }]}>{badge.label}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: 3 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  amountIn: { color: colors.primary },
  amountFailed: { color: colors.textMuted, textDecorationLine: 'line-through' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
});
