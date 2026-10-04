import React from 'react';
import { Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FullyDrawnMarker } from '../../FullyDrawnMarker';
import { TAB_BAR_HEIGHT, TabBar } from '../../components/TabBar';
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
export function HomeScreen() {
  const { data, error, refreshing, balanceHidden, refresh, toggleBalanceHidden } = useHomeData();
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
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={refresh} accessibilityRole="button">
              <Text style={styles.retry}>Retry</Text>
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
      <TabBar />
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
  errorText: { color: colors.danger, flex: 1, fontWeight: '600' },
  retry: { color: colors.textPrimary, fontWeight: '700', marginLeft: spacing.md },
});
