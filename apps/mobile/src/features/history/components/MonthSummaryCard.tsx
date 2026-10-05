import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpendingSummary } from '@pocketly/core-contract';
import { Skeleton } from '../../../components/Skeleton';
import { TrendingUp } from '../../../components/icons';
import { core } from '../../../core';
import { colors, radius, spacing } from '../../../theme/tokens';
import { FULL_MONTHS } from '../../home/presentation';

function signed(minor: number): string {
  return `${minor >= 0 ? '+' : ''}${core.formatMoney(minor)}`;
}

/** The month at a glance above the list: net flow, money in and out. Amounts come from the core. */
export function MonthSummaryCard({ month }: { month: SpendingSummary | null }) {
  const name = month ? FULL_MONTHS[Number(month.month.slice(5, 7)) - 1] : '';
  return (
    <View style={styles.card} testID="history-month">
      <View style={styles.icon}>
        <TrendingUp color={month && month.net < 0 ? colors.danger : colors.primary} size={20} />
      </View>
      <View style={styles.main}>
        <Text style={styles.label}>Net {name.slice(0, 3)} cash flow</Text>
        {month ? (
          <Text style={styles.net} accessibilityLabel={`Net ${name} cash flow ${signed(month.net)}`}>
            {signed(month.net)}
          </Text>
        ) : (
          <Skeleton width={110} height={22} />
        )}
      </View>
      {month && (
        <View style={styles.side}>
          <Text style={[styles.flow, styles.flowIn]}>+{core.formatMoney(month.totalIncome)} in</Text>
          <Text style={styles.flow}>-{core.formatMoney(month.totalSpent)} out</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { flex: 1, gap: 2 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  net: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  side: { alignItems: 'flex-end', gap: 4 },
  flow: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  flowIn: { color: colors.primary },
});
