import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BiometricStatus } from '@pocketly/core-contract';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { PrimaryButton, ProcessingView, SendHeader, Summary, TextButton, sendStyles } from '../send/components';
import { paymentPrompt, type Payment } from '../send/payment';
import { biometricFallbackNotice } from '../send/sendCopy';
import { useConfirmTransfer } from '../send/useConfirmTransfer';

type Props = NativeStackScreenProps<RootStackParamList, 'QrReview'>;

/**
 * QR Pay, review then confirm (FR-QR-04: as FR-TRF-03/04). The merchant's name and a dynamic
 * code's amount are the server's (ADR-0016 §4). Biometrics sign this payment's own message; the
 * prompt's "Use PIN" (or any failure) leads to the shared PIN screen. Nothing is paid until one of
 * them approves.
 */
export function QrReviewScreen({ navigation, route }: Props) {
  const { review } = route.params;
  const payment: Payment = useMemo(() => ({ kind: 'QR_PAYMENT', review }), [review]);
  const [biometrics, setBiometrics] = useState<BiometricStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sending, confirm } = useConfirmTransfer(payment, navigation);
  const amount = core.formatMoney(review.amount);
  const merchant = review.merchant.name;

  useEffect(() => {
    core.getBiometricStatus().then(setBiometrics, () => setBiometrics(null));
  }, []);

  const onConfirm = async () => {
    setError(null);
    if (!biometrics?.enabled || !biometrics.available) {
      navigation.navigate('SendPin', { payment });
      return;
    }
    try {
      const result = await confirm({ method: 'BIOMETRIC', prompt: paymentPrompt(payment, biometrics.kind, amount) });
      if (result?.state === 'DRAFT')
        navigation.navigate('SendPin', { payment, notice: biometricFallbackNotice(result.auth, biometrics.kind) });
    } catch (e) {
      setError(toUserError(e).message);
    }
  };

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="qr-review">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back" title="Pay" />
      <View style={styles.hero} accessible accessibilityLabel={`You're paying ${amount} to ${merchant}`}>
        <Text style={styles.heroLabel}>You're paying</Text>
        <Text style={styles.heroAmount} adjustsFontSizeToFit numberOfLines={1} testID="qr-review-amount">
          {amount}
        </Text>
        <Text style={styles.to} testID="qr-review-merchant">
          to {merchant}
        </Text>
      </View>
      <View style={styles.gap} />
      <Summary
        rows={[
          { label: 'Fee', value: review.fee === 0 ? 'Free' : core.formatMoney(review.fee), testID: 'qr-review-fee' },
          { label: 'Balance after', value: core.formatMoney(review.balanceAfter), testID: 'qr-review-balance-after' },
        ]}
      />
      <View style={styles.spacer} />
      {error && (
        <Text style={styles.error} accessibilityRole="alert" testID="qr-review-error">
          {error}
        </Text>
      )}
      <Text style={sendStyles.caption}>Nothing is paid until you confirm with your fingerprint or PIN.</Text>
      <View style={sendStyles.footer}>
        <PrimaryButton label={`Pay ${amount}`} onPress={onConfirm} busy={sending} testID="qr-review-confirm" />
        <TextButton label="Cancel" onPress={() => navigation.popToTop()} testID="qr-review-cancel" />
      </View>
      {sending && <ProcessingView title={`Paying ${amount}`} subtitle={`to ${merchant}`} testID="qr-processing" />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: 28,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg + 4,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: 14,
  },
  heroLabel: { color: colors.textSecondary, fontSize: 14 },
  heroAmount: {
    color: colors.textPrimary,
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  to: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  gap: { height: spacing.lg },
  spacer: { flex: 1 },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
});
