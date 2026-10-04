import React, { useEffect, useRef } from 'react';
import { Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FullyDrawnMarker } from '../../FullyDrawnMarker';
import { TAB_BAR_HEIGHT } from '../../components/TabBar';
import { colors, radius, spacing } from '../../theme/tokens';
import { BalanceCard } from './components/BalanceCard';
import { HomeHeader } from './components/HomeHeader';
import { IncomingBanner } from './components/IncomingBanner';
import { QuickActions } from './components/QuickActions';
import { RecentActivity } from './components/RecentActivity';
import { useHomeData } from './useHomeData';

/**
 * Home (F3). Real: balance card, hide/show (FR-HOME-02), recent transactions (FR-HOME-04),
 * pull to refresh (FR-HOME-05). Static placeholders: header actions, incoming banner,
 * quick actions and tab bar (their features come later). No live price card: Invest (F10)
 * is a stretch feature, hidden until it ships (product.md §7.1).
 */
export function HomeScreen({ refreshToken = 0 }: { refreshToken?: number }) {
  const { data, error, refreshing, balanceHidden, refresh, toggleBalanceHidden } = useHomeData();

  // Reload when asked from outside (e.g. after the developer menu changed the backend).
  const firstToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken !== firstToken.current) refresh();
  }, [refreshToken, refresh]);
  const latestIncoming = data?.recent.find((tx) => tx.type === 'TRANSFER_IN' && tx.status === 'SUCCESS');

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
        <HomeHeader />
        {latestIncoming && <IncomingBanner transaction={latestIncoming} />}

        {error && (
          <View style={[styles.error, error.offline && styles.offline]} accessibilityRole="alert" testID="home-error">
            <View style={styles.errorBody}>
              <Text style={[styles.errorText, error.offline && styles.offlineText]}>{error.message}</Text>
              {data && (
                <Text style={styles.staleText}>
                  Showing data from {new Date(data.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
            </View>
            <Pressable onPress={refresh} accessibilityRole="button" disabled={refreshing}>
              <Text style={styles.retry}>{refreshing ? '…' : 'Retry'}</Text>
            </Pressable>
          </View>
        )}

        <BalanceCard
          data={data}
          hidden={balanceHidden}
          refreshing={refreshing}
          onToggleHidden={toggleBalanceHidden}
          onRefresh={refresh}
        />
        <QuickActions />
        <RecentActivity items={data?.recent ?? null} now={data?.wallet.updatedAt ?? 0} />

        {/* BM-01: Home is "fully drawn" once it shows real data. */}
        {data && <FullyDrawnMarker />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: TAB_BAR_HEIGHT + spacing.xl },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dangerDim,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  offline: { backgroundColor: colors.tertiaryDim },
  errorBody: { flex: 1, gap: 2 },
  errorText: { color: colors.danger, fontWeight: '600' },
  offlineText: { color: colors.tertiary },
  staleText: { color: colors.textSecondary, fontSize: 12 },
  retry: { color: colors.textPrimary, fontWeight: '700', marginLeft: spacing.md },
});
