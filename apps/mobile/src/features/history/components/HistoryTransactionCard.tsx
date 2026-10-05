import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Transaction } from '@pocketly/core-contract';
import { Clock, type LucideIcon } from '../../../components/icons';
import { core } from '../../../core';
import { colors, radius, spacing } from '../../../theme/tokens';
import { TYPE_ICON, TransactionLeading } from '../../home/components/TransactionRow';
import { STATUS_LABEL, TYPE_LABEL, counterpartyName, formatTime, isIncoming } from '../../home/presentation';

/** Small badge on the avatar: what kind of transaction this is (pending wins). */
function badge(tx: Transaction): { Icon: LucideIcon; color: string; background: string } {
  if (tx.status === 'PENDING') return { Icon: Clock, color: colors.onPrimary, background: colors.tertiary };
  if (isIncoming(tx.type)) return { Icon: TYPE_ICON[tx.type], color: colors.onPrimary, background: colors.primary };
  return { Icon: TYPE_ICON[tx.type], color: colors.textPrimary, background: colors.surfaceRaised };
}

function statusColor(tx: Transaction): string {
  switch (tx.status) {
    case 'PENDING':
      return colors.tertiary;
    case 'FAILED':
      return colors.danger;
    case 'REVERSED':
      return colors.textMuted;
    case 'SUCCESS':
      return isIncoming(tx.type) ? colors.primary : colors.textSecondary;
  }
}

/**
 * One History row as a card: avatar with a type badge, name, "time · note" (or the type
 * when there's no note), amount, and the status in words (NFR-A11Y-03).
 */
export function HistoryTransactionCard({ tx }: { tx: Transaction }) {
  const incoming = isIncoming(tx.type);
  const amount = `${incoming ? '+' : '-'}${core.formatMoney(tx.amount)}`;
  const name = counterpartyName(tx);
  const time = formatTime(tx.createdAt);
  const detail = tx.note ?? TYPE_LABEL[tx.type];
  const status = STATUS_LABEL[tx.status];
  const { Icon, color, background } = badge(tx);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${name}, ${TYPE_LABEL[tx.type]}, ${amount}, ${status}, ${time}${tx.note ? `, ${tx.note}` : ''}`}
      testID={`tx-${tx.id}`}
    >
      <View>
        <TransactionLeading tx={tx} />
        <View style={[styles.badge, { backgroundColor: background }]}>
          <Icon color={color} size={10} strokeWidth={3} />
        </View>
      </View>
      <View style={styles.middle}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {time} ·{' '}
          <Text style={tx.note ? (tx.status === 'PENDING' ? styles.notePending : styles.note) : undefined}>{detail}</Text>
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, incoming && styles.amountIn, tx.status === 'FAILED' && styles.amountFailed]}>
          {amount}
        </Text>
        <View style={styles.status}>
          {tx.status === 'PENDING' && <View style={[styles.dot, { backgroundColor: colors.tertiary }]} />}
          <Text style={[styles.statusText, { color: statusColor(tx) }]}>{status}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  middle: { flex: 1, gap: 3 },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 12 },
  note: { color: colors.primary },
  notePending: { color: colors.tertiary },
  right: { alignItems: 'flex-end', gap: 3 },
  amount: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  amountIn: { color: colors.primary },
  amountFailed: { color: colors.textMuted, textDecorationLine: 'line-through' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
});
