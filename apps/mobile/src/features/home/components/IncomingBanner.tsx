import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Transaction } from '@pocketly/core-contract';
import { ArrowDownLeft, X } from '../../../components/icons';
import { core } from '../../../core';
import { colors, radius, type } from '../../../theme/tokens';

/**
 * STATIC PLACEHOLDER for F9 (in-app notification when money arrives). It shows the most
 * recent incoming transfer from the data already loaded; "View" does nothing yet and
 * dismissing is not remembered.
 */
export function IncomingBanner({ transaction }: { transaction: Transaction }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const amount = `+${core.formatMoney(transaction.amount)}`;
  const from = transaction.counterparty?.name ?? 'a contact';
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLabel={`Received ${amount} from ${from}`}>
      <View style={styles.icon}>
        <ArrowDownLeft color={colors.primary} size={18} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        <Text style={styles.amount}>{amount}</Text> from {from}
      </Text>
      <Pressable style={styles.view} accessibilityRole="button" accessibilityLabel="View" accessibilityHint="Coming soon">
        <Text style={styles.viewText}>View</Text>
      </Pressable>
      <Pressable hitSlop={10} onPress={() => setDismissed(true)} accessibilityRole="button" accessibilityLabel="Dismiss">
        <X color={colors.textSecondary} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { ...type.body, flex: 1, color: colors.textSecondary, fontWeight: '500' },
  amount: { color: colors.textPrimary, fontWeight: '700' },
  view: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  viewText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
});
