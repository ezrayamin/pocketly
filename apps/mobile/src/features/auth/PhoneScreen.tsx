import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PHONE_COUNTRY_CODE, PHONE_MAX_DIGITS } from '@pocketly/core-contract';
import type { OtpSendResult, PhoneRejectReason } from '@pocketly/core-contract';
import { ArrowRight, CircleX, LockKeyhole } from '../../components/icons';
import { core } from '../../core';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';
import { PinPad } from './PinPad';
import { groupNational } from './phoneFormat';

/** FR-AUTH-01: shown as soon as it's certain. TOO_SHORT only keeps the button off while typing. */
const REJECTED: Partial<Record<PhoneRejectReason, string>> = {
  NOT_MOBILE: 'Enter a mobile number. Indonesian mobile numbers start with 8 (or 08).',
  TOO_LONG: `That's too long for a mobile number.`,
  NOT_DIGITS: 'Use digits only.',
};

/**
 * FR-AUTH-01: the first onboarding screen. Indonesia (+62) only (ADR-0013); a leading 0 is fine.
 * The core decides what's valid (checkPhone); "Send verification code" stays off until it is.
 */
export function PhoneScreen({ onSent }: { onSent: (phone: string, sent: OtpSendResult) => void }) {
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = core.checkPhone(digits);
  const inline = !check.ok && check.reason ? REJECTED[check.reason] : undefined;

  const send = async () => {
    if (!check.ok || !check.e164) return;
    setBusy(true);
    setError(null);
    try {
      // TOO_SOON still goes on: the code sent a moment ago is the one to type.
      onSent(check.e164, await core.requestOtp(check.e164));
    } catch (e) {
      setError(toUserError(e).message);
      setBusy(false);
    }
  };

  const shown = digits.startsWith('0') ? `0${groupNational(digits.slice(1))}` : groupNational(digits);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="onboarding-phone">
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <View style={styles.tile}>
          <LockKeyhole color={colors.primary} size={30} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Enter your mobile number
        </Text>
        <Text style={styles.subtitle}>We'll send a 6-digit code to confirm it's your phone.</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>MOBILE NUMBER</Text>
        <View style={[styles.input, inline !== undefined && styles.inputError]}>
          <View style={styles.country} accessibilityLabel="Indonesia, plus 6 2">
            <Text style={styles.countryText}>🇮🇩 {PHONE_COUNTRY_CODE}</Text>
          </View>
          <Text
            style={[styles.number, digits.length === 0 && styles.placeholder]}
            numberOfLines={1}
            accessibilityLabel={digits.length === 0 ? 'Mobile number, empty' : `Mobile number ${digits.split('').join(' ')}`}
            testID="phone-number"
          >
            {digits.length === 0 ? '812-3456-7890' : shown}
          </Text>
          {digits.length > 0 && (
            <Pressable onPress={() => setDigits('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear the number" testID="phone-clear">
              <CircleX color={colors.textMuted} size={20} />
            </Pressable>
          )}
        </View>
        <Text style={[styles.hint, (inline ?? error) ? styles.hintError : null]} accessibilityLiveRegion="polite" testID="phone-message">
          {inline ?? error ?? ' '}
        </Text>
      </View>

      <View style={styles.bottom}>
        <PinPad
            disabled={busy}
          onDigit={(d) => {
            setError(null);
            // A leading 0 is allowed on top of the longest number.
            if (digits.length < PHONE_MAX_DIGITS + (digits.startsWith('0') ? 1 : 0)) setDigits(digits + d);
          }}
          onErase={() => setDigits(digits.slice(0, -1))}
        />
        <Pressable
          style={[styles.button, (!check.ok || busy) && styles.buttonOff]}
          onPress={send}
          disabled={!check.ok || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: !check.ok || busy }}
          testID="phone-send"
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Text style={styles.buttonText}>Send verification code</Text>
              <ArrowRight color={colors.onPrimary} size={18} />
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, justifyContent: 'space-between' },
  top: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.sm },
  tile: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...type.caption, fontSize: 14, fontWeight: '400', color: colors.textSecondary, textAlign: 'center' },
  field: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  label: { ...type.overline, color: colors.textSecondary },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: { borderColor: colors.danger },
  country: { paddingRight: spacing.sm, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  countryText: { ...type.body, color: colors.textPrimary },
  number: { flex: 1, fontSize: 20, fontWeight: '600', color: colors.textPrimary, letterSpacing: 0.5 },
  placeholder: { color: colors.textMuted },
  hint: { ...type.caption, color: colors.textSecondary, minHeight: 16 },
  hintError: { color: colors.danger },
  bottom: { gap: spacing.md },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { ...type.body, color: colors.onPrimary },
});
