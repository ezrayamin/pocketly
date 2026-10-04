import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight, CreditCard, QrCode, ScanLine, type LucideIcon } from '../../../components/icons';
import { colors } from '../../../theme/tokens';

/**
 * STATIC PLACEHOLDERS for FR-HOME-03. Send (F5), Top-Up (F6), Pay (F7) and Receive (F8)
 * open their flows once those features exist; for now they do nothing.
 */
const ACTIONS: { label: string; Icon: LucideIcon; primary?: boolean }[] = [
  { label: 'Send', Icon: ArrowUpRight, primary: true },
  { label: 'Top-Up', Icon: CreditCard },
  { label: 'Pay (QR)', Icon: ScanLine },
  { label: 'Receive', Icon: QrCode },
];

export function QuickActions() {
  return (
    <View style={styles.row}>
      {ACTIONS.map(({ label, Icon, primary }) => (
        <Pressable
          key={label}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Coming soon"
        >
          <View style={[styles.circle, primary && styles.circlePrimary]}>
            <Icon color={primary ? colors.onPrimary : colors.textPrimary} size={primary ? 26 : 22} />
          </View>
          <Text style={styles.label}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { alignItems: 'center', gap: 8, flex: 1 },
  circle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circlePrimary: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});
