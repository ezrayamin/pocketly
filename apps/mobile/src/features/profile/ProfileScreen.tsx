import React, { useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../components/Avatar';
import { TAB_BAR_HEIGHT } from '../../components/TabBar';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { core } from '../../core';
import { version } from '../../../package.json';

import { DEV_TOOLS_ENABLED } from '../../devtools';
const TAPS_TO_OPEN = 7;
const TAP_WINDOW_MS = 3_000;

/**
 * Profile (minimal for now: identity + app version). Security, Settings and My QR arrive
 * with their features. Tapping the version 7× opens the Developer Menu (FR-DEV-01).
 */
export function ProfileScreen({ onOpenDevMenu }: { onOpenDevMenu: () => void }) {
  const taps = useRef<number[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const onVersionPress = () => {
    if (!DEV_TOOLS_ENABLED) return;
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < TAP_WINDOW_MS), now];
    const left = TAPS_TO_OPEN - taps.current.length;
    if (left <= 0) {
      taps.current = [];
      setHint(null);
      onOpenDevMenu();
    } else if (left <= 3) {
      setHint(`${left} more ${left === 1 ? 'tap' : 'taps'} to open the developer menu`);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Profile
        </Text>
        <View style={styles.card}>
          <Avatar id="me" name="Rina Wijaya" size={56} />
          <View>
            <Text style={styles.name}>Rina Wijaya</Text>
            <Text style={styles.caption}>+1 555 000 0000</Text>
          </View>
        </View>
        <Text style={styles.soon}>Security, settings and My QR arrive with their features.</Text>
        <Pressable onPress={onVersionPress} style={styles.versionRow} accessibilityRole="text" testID="app-version">
          <Text style={styles.caption}>App version</Text>
          <Text style={styles.caption}>
            {version} · core {core.impl}
          </Text>
        </Pressable>
        {hint && (
          <Text style={styles.hint} accessibilityLiveRegion="polite">
            {hint}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: TAB_BAR_HEIGHT },
  title: { ...type.title, color: colors.textPrimary },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  name: { ...type.body, color: colors.textPrimary },
  caption: { ...type.caption, color: colors.textSecondary },
  soon: { ...type.caption, color: colors.textMuted },
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  hint: { ...type.caption, color: colors.primary, textAlign: 'center' },
});
