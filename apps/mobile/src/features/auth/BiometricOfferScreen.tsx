import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BiometricKind } from '@pocketly/core-contract';
import { Fingerprint } from '../../components/icons';
import { core } from '../../core';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';
import { biometricNoun, capitalized, enablePrompt } from './biometricCopy';

/**
 * FR-AUTH-04: offered after the PIN is created, and again after a PIN unlock that followed an
 * invalidated key (ADR-0012). `pin` is the PIN the user just entered: enabling re-checks it in
 * the core, so it's held by the gate only until this screen is done.
 */
export function BiometricOfferScreen({
  kind,
  pin,
  again,
  onDone,
}: {
  kind?: BiometricKind;
  pin: string;
  /** Turning it back on after biometrics changed. */
  again: boolean;
  onDone: () => void;
}) {
  const noun = biometricNoun(kind);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await core.enableBiometrics(pin, enablePrompt(kind));
      if (result.outcome === 'ENABLED') {
        onDone();
        return;
      }
      setMessage(
        result.outcome === 'CANCELLED'
          ? null
          : result.outcome === 'BIOMETRIC_LOCKED_OUT'
            ? `Too many ${noun} attempts. Try again later from Profile.`
            : `${capitalized(noun)} unlock couldn't be turned on. You can try again from Profile.`,
      );
    } catch (e) {
      setMessage(toUserError(e).message);
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="biometric-offer">
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <View style={styles.badge}>
          <Fingerprint color={colors.primary} size={32} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {again ? `Turn ${noun} unlock back on?` : `Unlock with your ${noun}?`}
        </Text>
        <Text style={styles.body}>
          {again
            ? `Your ${noun} settings changed, so ${noun} unlock was turned off. Turn it on again to unlock without your PIN.`
            : `Open Pocketly with your ${noun} instead of your PIN. Your PIN still works, and you can turn this off in Profile.`}
        </Text>
        {message && (
          <Text style={styles.message} accessibilityLiveRegion="polite" testID="biometric-offer-message">
            {message}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.primary]}
          onPress={turnOn}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          testID="biometric-offer-enable"
        >
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Turn on</Text>}
        </Pressable>
        <Pressable style={styles.button} onPress={onDone} disabled={busy} accessibilityRole="button" testID="biometric-offer-skip">
          <Text style={styles.buttonText}>Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between', padding: spacing.xxl },
  top: { alignItems: 'center', paddingTop: spacing.xxl * 2, gap: spacing.md },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.title, color: colors.textPrimary, textAlign: 'center' },
  body: { ...type.body, fontWeight: '400', color: colors.textSecondary, textAlign: 'center' },
  message: { ...type.caption, color: colors.danger, textAlign: 'center' },
  actions: { gap: spacing.sm },
  button: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.surfaceRaised },
  primary: { backgroundColor: colors.primary },
  primaryText: { ...type.body, color: colors.onPrimary },
  buttonText: { ...type.body, color: colors.textPrimary },
});
