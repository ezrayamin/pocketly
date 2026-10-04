import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Transaction } from '@pocketly/core-contract';
import { Skeleton } from '../../../components/Skeleton';
import { ChevronRight } from '../../../components/icons';
import { colors, radius, type } from '../../../theme/tokens';
import { RECENT_COUNT } from '../useHomeData';
import { TransactionRow } from './TransactionRow';

/**
 * FR-HOME-04: last 5 transactions. Five fixed rows, so a plain View list, not a
 * virtualized list. "See All" opens History once F4 exists.
 */
export function RecentActivity({ items, now }: { items: Transaction[] | null; now: number }) {
  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Recent Activity
        </Text>
        <Pressable style={styles.seeAll} accessibilityRole="button" accessibilityLabel="See all transactions" accessibilityHint="Coming soon">
          <Text style={styles.seeAllText}>See All</Text>
          <ChevronRight color={colors.primary} size={16} />
        </Pressable>
      </View>
      <View style={styles.list}>
        {items === null
          ? Array.from({ length: RECENT_COUNT }, (_, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.skeletonRow}>
                <Skeleton width={44} height={44} style={styles.round} />
                <View style={styles.skeletonText}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="75%" height={11} />
                </View>
                <Skeleton width={64} height={14} />
                </View>
              </View>
            ))
          : items.length === 0
            ? <Text style={styles.empty}>No transactions yet.</Text>
            : items.map((tx, i) => (
                <View key={tx.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <TransactionRow tx={tx} now={now} />
                </View>
              ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { ...type.section, color: colors.textPrimary },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  skeletonText: { flex: 1, gap: 6 },
  round: { borderRadius: 22 },
  empty: { color: colors.textSecondary, padding: 20, textAlign: 'center' },
});
