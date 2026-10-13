import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BiometricStatus } from '@pocketly/core-contract';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../components/Avatar';
import { TAB_BAR_HEIGHT } from '../../components/TabBar';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { core } from '../../core';
import { version } from '../../../package.json';

import { DEV_TOOLS_ENABLED } from '../../devtools';
import type { RootStackParamList } from '../../navigation';
import { biometricNoun, capitalized } from '../auth/biometricCopy';
import { formatPhone } from '../auth/phoneFormat';
import { toUserError } from '../errors';
const TAPS_TO_OPEN = 7;
const TAP_WINDOW_MS = 3_000;

const UNAVAILABLE: Record<NonNullable<BiometricStatus['reason']>, string> = {
  NO_HARDWARE: "This phone doesn't have a sensor Pocketly can use.",
  NOT_ENROLLED: "Set up a fingerprint or face in your phone's settings first.",
  NOT_STRONG: "This phone's sensor isn't secure enough to protect your wallet.",
  TEMPORARILY_UNAVAILABLE: "The sensor isn't available right now.",
};

/**
 * FR-AUTH-04 "can be turned off in Settings". Turning it on goes through BiometricSetup (PIN,
 * then one scan); turning it off deletes the key at once.
 */
function SecuritySection() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [status, setStatus] = useState<BiometricStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    core.getBiometricStatus().then(setStatus, (e: unknown) => setError(toUserError(e).message));
  }, []);
  useFocusEffect(load);

  if (status === null) return null;
  const noun = biometricNoun(status.kind);
  const toggle = async (on: boolean) => {
    setError(null);
    if (on) {
      navigation.navigate('BiometricSetup');
      return;
    }
    try {
      await core.disableBiometrics();
    } catch (e) {
      setError(toUserError(e).message);
    }
    load();
  };

  return (
    <View style={styles.section}>
      <Text style={styles.overline}>SECURITY</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.name}>Unlock with {noun}</Text>
          {!status.available && status.reason && <Text style={styles.caption}>{UNAVAILABLE[status.reason]}</Text>}
        </View>
        <Switch
          value={status.enabled}
          onValueChange={toggle}
          disabled={!status.enabled && !status.available}
          accessibilityLabel={`${capitalized(noun)} unlock`}
          testID="profile-biometric-switch"
        />
      </View>
      {error && <Text style={styles.caption}>{error}</Text>}
    </View>
  );
}

/**
 * Profile: identity, Security (biometric unlock), app version. Settings and My QR arrive with
 * their features. Tapping the version 7× opens the Developer Menu (FR-DEV-01).
 */
export function ProfileScreen({ onOpenDevMenu, lockSkipped = false }: { onOpenDevMenu: () => void; lockSkipped?: boolean }) {
  // FR-AUTH-02: the number verified by OTP (ADR-0013).
  const [phone, setPhone] = useState<string | undefined>();
  useFocusEffect(
    useCallback(() => {
      core.getAuthState().then((s) => setPhone(s.phone), () => {});
    }, []),
  );
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
            <Text style={styles.caption} testID="profile-phone">
              {phone === undefined ? 'Phone not verified' : formatPhone(phone)}
            </Text>
          </View>
        </View>
        {!lockSkipped && <SecuritySection />}
        <Text style={styles.soon}>Settings and My QR arrive with their features.</Text>
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
  section: { gap: spacing.sm },
  overline: { ...type.overline, color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  rowText: { flex: 1, gap: spacing.xs },
});
