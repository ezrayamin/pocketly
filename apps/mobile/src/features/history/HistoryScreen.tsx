import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/AppHeader';
import { NoticeBanner } from '../../components/NoticeBanner';
import { Skeleton } from '../../components/Skeleton';
import { TAB_BAR_HEIGHT } from '../../components/TabBar';
import { Inbox } from '../../components/icons';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { staleNotice } from '../errors';
import { FilterBar } from './components/FilterBar';
import { HistoryTransactionCard } from './components/HistoryTransactionCard';
import { MonthSummaryCard } from './components/MonthSummaryCard';
import { toRows, type HistoryRow } from './rows';
import { NO_FILTER, useHistory } from './useHistory';

const SKELETON_ROWS = 7;

/**
 * History (F4): every transaction, newest first, 20 per page with infinite scroll
 * (FR-HIST-01), grouped by day (FR-HIST-02), filterable (FR-HIST-03), readable offline
 * from the replica with a banner (FR-HIST-04). Tapping a row opens its detail (FR-HIST-05).
 */
export function HistoryScreen({ reloadToken = 0, scrollToTopToken = 0 }: { reloadToken?: number; scrollToTopToken?: number }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const history = useHistory(reloadToken);
  const { items, filter, setFilter, refresh, refreshing, loadMore } = history;
  const list = useRef<FlashListRef<HistoryRow>>(null);

  // "Today" is evaluated when the list changes, like Home's relative days.
  const { rows, dayIndices } = useMemo(() => toRows(items ?? [], Date.now()), [items]);

  // product.md §7.3 rule 5: tapping the active tab again scrolls to the top.
  const firstScrollToken = useRef(scrollToTopToken);
  useEffect(() => {
    if (scrollToTopToken !== firstScrollToken.current) list.current?.scrollToTop({ animated: true });
  }, [scrollToTopToken]);

  // The replica answered (FR-HIST-04), or a refresh failed with the old list still shown.
  const notice = items !== null ? (history.error ?? (history.stale ? staleNotice(history.stale) : null)) : null;

  const renderItem = useCallback(
    ({ item }: { item: HistoryRow }) =>
      item.kind === 'day' ? (
        <Text style={styles.day} accessibilityRole="header">
          {item.title}
        </Text>
      ) : (
        <Pressable
          onPress={() => navigation.navigate('TransactionDetail', { id: item.tx.id, tx: item.tx })}
          accessibilityRole="button"
          accessibilityHint="Opens the transaction details"
          style={({ pressed }) => pressed && styles.pressed}
          testID={`history-row-${item.tx.id}`}
        >
          <HistoryTransactionCard tx={item.tx} />
        </Pressable>
      ),
    [navigation],
  );

  const filtered = filter.type !== null || filter.status !== null;

  // The list stays mounted while a filter loads, so its header (summary card) doesn't jump.
  const empty =
    items === null ? (
      history.error ? (
        <View style={styles.padded}>
          <NoticeBanner notice={history.error} retrying={refreshing} onRetry={refresh} testIdPrefix="history" />
        </View>
      ) : (
        <View testID="history-loading">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={44} height={44} style={styles.round} />
              <View style={styles.skeletonText}>
                <Skeleton width="55%" height={14} />
                <Skeleton width="35%" height={11} />
              </View>
              <Skeleton width={64} height={14} />
            </View>
          ))}
        </View>
      )
    ) : (
      <View style={styles.empty} testID="history-empty">
        <Inbox color={colors.textMuted} size={32} />
        <Text style={styles.emptyText}>{filtered ? 'No transactions match these filters.' : 'No transactions yet.'}</Text>
        {filtered && (
          <Pressable onPress={() => setFilter(NO_FILTER)} accessibilityRole="button" testID="history-clear-filters">
            <Text style={styles.link}>Clear filters</Text>
          </Pressable>
        )}
      </View>
    );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <AppHeader subtitle="Activity" />
      </View>
      <View style={styles.filters}>
        <FilterBar filter={filter} onChange={setFilter} />
      </View>

      <FlashList
        ref={list}
        data={rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        stickyHeaderIndices={dayIndices}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={styles.listContent}
        testID="history-list"
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {notice && (
              <View style={styles.padded}>
                <NoticeBanner
                  notice={notice}
                  syncedAt={history.stale?.cachedAt}
                  retrying={refreshing}
                  onRetry={refresh}
                  testIdPrefix="history"
                />
              </View>
            )}
            <MonthSummaryCard month={history.month} />
          </View>
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          history.loadingMore ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : history.loadMoreError ? (
            <Pressable onPress={() => loadMore(true)} accessibilityRole="button" style={styles.footer} testID="history-load-more-retry">
              <Text style={styles.footerError}>{history.loadMoreError.message}</Text>
              <Text style={styles.link}>Retry</Text>
            </Pressable>
          ) : items && items.length > 0 && !history.hasMore ? (
            // Also BM-02's "bottom reached" marker (benchmarks/maestro/bm-02-scroll.yaml).
            <Text style={styles.end} testID="history-end">
              That's everything
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  filters: { paddingBottom: spacing.lg },
  listHeader: { gap: spacing.md, paddingBottom: spacing.xs },
  listContent: { paddingBottom: TAB_BAR_HEIGHT + spacing.xl },
  padded: { paddingHorizontal: spacing.lg },
  day: {
    ...type.overline,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  pressed: { opacity: 0.7 },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  skeletonText: { flex: 1, gap: 6 },
  round: { borderRadius: 22 },
  empty: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl * 2 },
  emptyText: { color: colors.textSecondary, textAlign: 'center' },
  link: { color: colors.primary, fontWeight: '700' },
  footer: { alignItems: 'center', gap: spacing.xs, padding: spacing.xl },
  footerError: { color: colors.textSecondary, textAlign: 'center' },
  end: { color: colors.textMuted, textAlign: 'center', padding: spacing.xl, fontSize: 12 },
});
