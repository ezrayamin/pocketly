import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BiometricKind } from '@pocketly/core-contract';
import { Fingerprint, Grid3x3, LockKeyhole, ShieldCheck, Zap } from '../../components/icons';
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
  step,
  onDone,
}: {
  kind?: BiometricKind;
  pin: string;
  /** Turning it back on after biometrics changed. */
  again: boolean;
  /** "Step 2 of 2" during onboarding. */
  step?: { index: number; total: number };
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
        <View style={styles.ring}>
          <View style={styles.ringInner}>
            <Fingerprint color={colors.primary} size={44} />
          </View>
          <View style={styles.lock}>
            <LockKeyhole color={colors.onPrimary} size={14} />
          </View>
        </View>
        {step && (
          <View style={styles.chip}>
            <View style={styles.chipDot} />
            <Text style={styles.chipText}>
              Step {step.index} of {step.total} · Biometrics
            </Text>
          </View>
        )}
        <Text style={styles.title} accessibilityRole="header">
          {again ? `Turn ${noun} unlock back on?` : `Unlock with your ${noun}`}
        </Text>
        <Text style={styles.body}>
          {again
            ? `Your ${noun} settings changed, so ${noun} unlock was turned off. Turn it on again to unlock without your PIN.`
            : `Unlock Pocketly and confirm transfers with your ${noun}.`}
        </Text>
      </View>

      <View style={styles.features}>
        <Feature icon={<Zap color={colors.primary} size={18} />} title="Faster unlock" text={`Your ${noun} instead of typing your PIN`} />
        <Feature
          icon={<ShieldCheck color={colors.primary} size={18} />}
          title="Stays on this phone"
          text={`Your phone's secure hardware checks your ${noun}; Pocketly never sees it`}
        />
        <Feature icon={<Grid3x3 color={colors.primary} size={18} />} title="Your PIN still works" text={`Any time, and whenever your ${noun} can't be used`} />
      </View>

      <View style={styles.actions}>
        {message && (
          <Text style={styles.message} accessibilityLiveRegion="polite" testID="biometric-offer-message">
            {message}
          </Text>
        )}
        <Pressable
          style={[styles.button, styles.primary]}
          onPress={turnOn}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          testID="biometric-offer-enable"
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Fingerprint color={colors.onPrimary} size={18} />
              <Text style={styles.primaryText}>Turn on {noun} unlock</Text>
            </>
          )}
        </Pressable>
        <Pressable style={styles.button} onPress={onDone} disabled={busy} accessibilityRole="button" testID="biometric-offer-skip">
          <Text style={styles.buttonText}>Maybe later</Text>
        </Pressable>
        <Text style={styles.footnote}>You can turn this off any time in Profile → Security.</Text>
      </View>
    </SafeAreaView>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>{icon}</View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  top: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.sm },
  ring: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  ringInner: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    right: 2,
    bottom: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  chipText: { ...type.caption, color: colors.textPrimary },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, textAlign: 'center' },
  body: { ...type.caption, fontSize: 14, fontWeight: '400', color: colors.textSecondary, textAlign: 'center' },
  features: { gap: spacing.sm },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  featureIcon: { width: 28, alignItems: 'center' },
  featureText: { flex: 1, gap: 2 },
  featureTitle: { ...type.body, color: colors.textPrimary },
  featureBody: { ...type.caption, fontWeight: '400', color: colors.textSecondary },
  actions: { gap: spacing.sm },
  message: { ...type.caption, color: colors.danger, textAlign: 'center' },
  button: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  primary: { backgroundColor: colors.primary },
  primaryText: { ...type.body, color: colors.onPrimary },
  buttonText: { ...type.body, color: colors.textPrimary },
  footnote: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
