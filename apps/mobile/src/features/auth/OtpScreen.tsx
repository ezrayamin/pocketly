import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSecureScreen } from '@pocketly/native-secure-screen';
import { FAKE_OTP_CODE, OTP_LENGTH } from '@pocketly/core-contract';
import type { OtpSendResult } from '@pocketly/core-contract';
import { CircleCheck, RefreshCw, Smartphone } from '../../components/icons';
import { core } from '../../core';
import { DEV_TOOLS_ENABLED } from '../../devtools';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';
import { PinPad } from './PinPad';
import { formatCountdown } from './pinCopy';
import { formatPhone } from './phoneFormat';
import { useCountdown } from './useCountdown';

type Message = { tone: 'error' | 'info'; text: string };

/**
 * FR-AUTH-02: type the 6-digit code. The (fake) server counts wrong codes: 3 → a 30 s cooldown
 * with a countdown; "Resend" opens 30 s after the last code. Screenshots are blocked while it's
 * shown. In developer builds a line says what the fake server's code is.
 */
export function OtpScreen({
  phone,
  firstSend,
  onVerified,
  onEditNumber,
}: {
  phone: string;
  firstSend: OtpSendResult;
  onVerified: () => void;
  onEditNumber: () => void;
}) {
  useSecureScreen();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [resendAt, setResendAt] = useState(firstSend.resendAt);
  const [cooldownUntil, setCooldownUntil] = useState<number | undefined>();
  const resendIn = useCountdown(resendAt);
  const cooldownIn = useCountdown(cooldownUntil);
  const coolingDown = cooldownUntil !== undefined && cooldownIn > 0;

  const verify = async () => {
    if (code.length !== OTP_LENGTH || busy || coolingDown) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await core.verifyOtp(phone, code);
      switch (result.outcome) {
        case 'VERIFIED':
          onVerified();
          return;
        case 'WRONG_CODE':
          setMessage({
            tone: 'error',
            text: `That code isn't right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
          });
          break;
        case 'COOLDOWN':
          setCooldownUntil(result.retryAt);
          break;
        case 'EXPIRED':
          setMessage({ tone: 'error', text: 'This code has expired. Send a new one.' });
          break;
        case 'NO_CODE':
          setMessage({ tone: 'error', text: 'Send a new code to continue.' });
          break;
      }
      setCode('');
    } catch (e) {
      setMessage({ tone: 'error', text: toUserError(e).message });
    }
    setBusy(false);
  };

  const resend = async () => {
    setMessage(null);
    try {
      const sent = await core.requestOtp(phone);
      setResendAt(sent.resendAt);
      setCode('');
      if (sent.outcome === 'SENT') setMessage({ tone: 'info', text: 'We sent a new code.' });
    } catch (e) {
      setMessage({ tone: 'error', text: toUserError(e).message });
    }
  };

  const shownMessage: Message | null = coolingDown
    ? { tone: 'error', text: `Too many wrong codes. Try again in ${formatCountdown(cooldownIn)}.` }
    : message;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="onboarding-otp">
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <View style={styles.tile}>
          <Smartphone color={colors.primary} size={28} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Verify your phone
        </Text>
        <Text style={styles.subtitle}>
          Sent a 6-digit code to <Text style={styles.strong}>{formatPhone(phone)}</Text>.
        </Text>
        <Pressable onPress={onEditNumber} hitSlop={12} accessibilityRole="button" testID="otp-edit-number">
          <Text style={styles.link}>Edit number</Text>
        </Pressable>
      </View>

      <View style={styles.middle}>
        <View
          style={styles.boxes}
          accessible
          accessibilityLabel={`${code.length} of ${OTP_LENGTH} digits entered`}
          testID="otp-boxes"
        >
          {Array.from({ length: OTP_LENGTH }, (_, i) => (
            <View key={i} style={[styles.box, i === code.length && !coolingDown && styles.boxActive]}>
              <Text style={styles.boxText}>{code[i] ?? ''}</Text>
            </View>
          ))}
        </View>
        <View style={styles.resendRow}>
          {resendIn > 0 ? (
            <Text style={styles.muted} testID="otp-resend-countdown">
              Resend code in {formatCountdown(resendIn)}
            </Text>
          ) : (
            <Pressable onPress={resend} style={styles.resend} accessibilityRole="button" hitSlop={12} testID="otp-resend">
              <RefreshCw color={colors.primary} size={14} />
              <Text style={styles.link}>Resend code</Text>
            </Pressable>
          )}
        </View>
        <Text
          style={[styles.message, shownMessage?.tone === 'error' && styles.error]}
          accessibilityLiveRegion="assertive"
          testID="otp-message"
        >
          {shownMessage?.text ?? (DEV_TOOLS_ENABLED ? `Demo build: the code is ${FAKE_OTP_CODE}.` : ' ')}
        </Text>
        <Pressable
          style={[styles.button, (code.length !== OTP_LENGTH || busy || coolingDown) && styles.buttonOff]}
          onPress={verify}
          disabled={code.length !== OTP_LENGTH || busy || coolingDown}
          accessibilityRole="button"
          accessibilityState={{ disabled: code.length !== OTP_LENGTH || busy || coolingDown }}
          testID="otp-verify"
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <CircleCheck color={colors.onPrimary} size={18} />
              <Text style={styles.buttonText}>Verify & continue</Text>
            </>
          )}
        </Pressable>
      </View>

      <PinPad
        disabled={busy || coolingDown}
        onDigit={(d) => {
          if (message?.tone === 'error') setMessage(null);
          if (code.length < OTP_LENGTH) setCode(code + d);
        }}
        onErase={() => setCode(code.slice(0, -1))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, justifyContent: 'space-between' },
  top: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.xs },
  tile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
  subtitle: { ...type.caption, fontSize: 14, fontWeight: '400', color: colors.textSecondary, textAlign: 'center' },
  strong: { color: colors.textPrimary, fontWeight: '700' },
  link: { ...type.body, fontSize: 14, color: colors.primary },
  middle: { gap: spacing.md },
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  box: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  boxActive: { borderColor: colors.primary },
  boxText: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  resendRow: { flexDirection: 'row', justifyContent: 'center' },
  resend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  muted: { ...type.caption, color: colors.textSecondary },
  message: { ...type.caption, color: colors.textSecondary, textAlign: 'center', minHeight: 16 },
  error: { color: colors.danger },
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
