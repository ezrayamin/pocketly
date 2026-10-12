import React, { useEffect, useRef } from 'react';
import { RefreshControl, ScrollView, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FullyDrawnMarker } from '../../FullyDrawnMarker';
import { AppHeader } from '../../components/AppHeader';
import { NoticeBanner } from '../../components/NoticeBanner';
import { TAB_BAR_HEIGHT } from '../../components/TabBar';
import { colors, spacing } from '../../theme/tokens';
import { BalanceCard } from './components/BalanceCard';
import { IncomingBanner } from './components/IncomingBanner';
import { QuickActions } from './components/QuickActions';
import { RecentActivity } from './components/RecentActivity';
import { staleNotice } from '../errors';
import { useHomeData } from './useHomeData';

/**
 * Home (F3). Real: balance card, hide/show (FR-HOME-02), recent transactions (FR-HOME-04),
 * pull to refresh (FR-HOME-05). Static placeholders: header actions, incoming banner,
 * quick actions (their features come later). No live price card: Invest (F10)
 * is a stretch feature, hidden until it ships (product.md §7.1).
 */
export function HomeScreen({ refreshToken = 0, onSeeAll }: { refreshToken?: number; onSeeAll?: () => void }) {
  const { data, error, refreshing, balanceHidden, refresh, toggleBalanceHidden } = useHomeData();

  // Reload when asked from outside (e.g. after the developer menu changed the backend).
  const firstToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken !== firstToken.current) refresh();
  }, [refreshToken, refresh]);
  const latestIncoming = data?.recent.find((tx) => tx.type === 'TRANSFER_IN' && tx.status === 'SUCCESS');
  // A failed refresh, or a load the core answered from its replica (product §6.3).
  const notice = error ?? (data?.stale ? staleNotice(data.stale) : null);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surfaceRaised}
          />
        }
        testID="home-scroll"
      >
        <AppHeader subtitle="Wallet" />
        {latestIncoming && <IncomingBanner transaction={latestIncoming} />}

        {notice && (
          <NoticeBanner
            notice={notice}
            syncedAt={data?.syncedAt}
            retrying={refreshing}
            onRetry={refresh}
            testIdPrefix="home"
          />
        )}

        <BalanceCard
          data={data}
          hidden={balanceHidden}
          refreshing={refreshing}
          onToggleHidden={toggleBalanceHidden}
          onRefresh={refresh}
        />
        <QuickActions />
        <RecentActivity items={data?.recent ?? null} now={data?.wallet.updatedAt ?? 0} onSeeAll={onSeeAll} />

        {/* BM-01: Home is "fully drawn" once it shows real data. */}
        {data && <FullyDrawnMarker />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: TAB_BAR_HEIGHT + spacing.xl },
});
