import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Bell, Wallet } from './icons';

/**
 * Top bar of the tab screens: brand, the screen's name, notifications, avatar.
 * Notifications (F9) and Profile are not built yet: bell and avatar are static placeholders.
 */
export function AppHeader({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Wallet color={colors.primary} size={20} />
        </View>
        <View>
          <Text style={styles.title} accessibilityRole="header">
            Pocketly
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Notifications" accessibilityHint="Coming soon">
          <Bell color={colors.textPrimary} size={20} />
          <View style={styles.dot} />
        </Pressable>
        <Avatar id="me" name="Rina Wijaya" size={36} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.title, color: colors.textPrimary },
  subtitle: { ...type.caption, color: colors.textSecondary, marginTop: -2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
});
