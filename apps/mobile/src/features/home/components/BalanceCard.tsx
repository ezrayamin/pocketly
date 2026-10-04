import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Skeleton } from '../../../components/Skeleton';
import { Eye, EyeOff, RefreshCw, TrendingUp } from '../../../components/icons';
import { core } from '../../../core';
import { colors, radius, spacing, type } from '../../../theme/tokens';
import { formatTime } from '../presentation';
import type { HomeData } from '../useHomeData';

const MASK = '••••••'; // FR-HOME-02

interface Props {
  data: HomeData | null;
  hidden: boolean;
  refreshing: boolean;
  onToggleHidden: () => void;
  onRefresh: () => void;
}

export function BalanceCard({ data, hidden, refreshing, onToggleHidden, onRefresh }: Props) {
  const wallet = data?.wallet;
  const net = data?.month.net;
  const usedRatio = wallet && wallet.dailyLimit > 0 ? Math.min(1, wallet.usedToday / wallet.dailyLimit) : 0;
  // Explicit pixel size: react-native-svg on Android doesn't resolve % sizes inside absoluteFill.
  const [size, setSize] = useState({ width: 0, height: 0 });

  return (
    <View style={styles.card} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      <Svg style={StyleSheet.absoluteFill} width={size.width} height={size.height}>
        <Defs>
          <LinearGradient id="balanceBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1B2E2A" />
            <Stop offset="1" stopColor="#111722" />
          </LinearGradient>
        </Defs>
        <Rect width={size.width} height={size.height} fill="url(#balanceBg)" />
      </Svg>

      <View style={styles.topRow}>
        <View style={styles.labelRow}>
          <Text style={styles.overline}>TOTAL BALANCE</Text>
          <Pressable
            onPress={onToggleHidden}
            hitSlop={12}
            accessibilityRole="switch"
            accessibilityLabel="Hide balance"
            accessibilityState={{ checked: hidden }}
            testID="balance-toggle"
          >
            {hidden ? <EyeOff color={colors.textSecondary} size={18} /> : <Eye color={colors.textSecondary} size={18} />}
          </Pressable>
        </View>
        <Pressable
          style={styles.syncChip}
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh balance"
        >
          <RefreshCw color={colors.textPrimary} size={12} />
          <Text style={styles.syncText}>{refreshing ? 'Syncing…' : 'Pull to sync'}</Text>
        </Pressable>
      </View>

      {wallet ? (
        <View style={styles.amountRow} accessible accessibilityLabel={hidden ? 'Balance hidden' : `Balance ${core.formatMoney(wallet.balance)}`}>
          <Text style={styles.amount} testID="balance" numberOfLines={1} adjustsFontSizeToFit>
            {hidden ? MASK : core.formatMoney(wallet.balance)}
          </Text>
          {!hidden && <Text style={styles.currency}>USD</Text>}
        </View>
      ) : (
        <Skeleton width="65%" height={44} style={styles.amountSkeleton} />
      )}

      {net !== undefined ? (
        <View style={styles.monthRow}>
          <View style={[styles.pill, net < 0 && styles.pillNegative]}>
            <TrendingUp color={net < 0 ? colors.danger : colors.primary} size={14} />
            <Text style={[styles.pillText, net < 0 && styles.pillTextNegative]}>
              {hidden ? '••••' : `${net >= 0 ? '+' : ''}${core.formatMoney(net)}`}
            </Text>
          </View>
          <Text style={styles.caption}>this month</Text>
        </View>
      ) : (
        <Skeleton width="45%" height={22} style={styles.monthSkeleton} />
      )}

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <View style={styles.updated}>
            <View style={styles.liveDot} />
            <Text style={styles.caption}>
              {data ? `Last updated ${formatTime(data.loadedAt)}` : 'Updating…'}
            </Text>
          </View>
          <Text style={styles.limitLabel}>DAILY LIMIT</Text>
        </View>
        <View
          style={styles.track}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={
            wallet ? `Used ${core.formatMoney(wallet.usedToday)} of ${core.formatMoney(wallet.dailyLimit)} daily limit` : 'Daily limit'
          }
        >
          <View style={[styles.fill, { width: `${usedRatio * 100}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A3B37',
    backgroundColor: '#151F22', // shown until the gradient is measured
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overline: { ...type.overline, color: colors.textSecondary },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  syncText: { color: colors.textPrimary, fontSize: 11, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: spacing.lg },
  amount: { ...type.balance, color: colors.textPrimary, flexShrink: 1 },
  currency: { color: colors.textSecondary, fontSize: 16, fontWeight: '700' },
  amountSkeleton: { marginTop: spacing.lg },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  monthSkeleton: { marginTop: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryDim,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillNegative: { backgroundColor: colors.dangerDim },
  pillText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  pillTextNegative: { color: colors.danger },
  caption: { ...type.caption, color: colors.textSecondary },
  footer: { marginTop: spacing.xl, gap: 8 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  updated: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  limitLabel: { ...type.overline, fontSize: 10, color: colors.primary },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
});
