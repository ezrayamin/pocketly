import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { flowMark } from '@pocketly/bench-app';
import type { BiometricStatus } from '@pocketly/core-contract';
import { Avatar } from '../../components/Avatar';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { formatPhone } from '../auth/phoneFormat';
import { toUserError } from '../errors';
import { PrimaryButton, ProcessingView, SendHeader, Summary, TextButton, sendStyles } from './components';
import { biometricFallbackNotice, transferPrompt } from './sendCopy';
import { useConfirmTransfer } from './useConfirmTransfer';

type Props = NativeStackScreenProps<RootStackParamList, 'SendReview'>;

/**
 * Send, step 3: review (FR-TRF-03), then confirm (FR-TRF-04). With biometrics on, the system
 * prompt signs this transfer; its "Use PIN" button (or any failure) leads to the PIN screen.
 * Nothing is sent until one of them approves.
 */
export function SendReviewScreen({ navigation, route }: Props) {
  const { review } = route.params;
  const [biometrics, setBiometrics] = useState<BiometricStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sending, confirm } = useConfirmTransfer(review, navigation);
  const amount = core.formatMoney(review.amount);

  useEffect(() => flowMark('review-shown'), []); // BM-07

  useEffect(() => {
    core.getBiometricStatus().then(setBiometrics, () => setBiometrics(null));
  }, []);

  const onConfirm = async () => {
    flowMark('confirm-tap');
    setError(null);
    if (!biometrics?.enabled || !biometrics.available) {
      navigation.navigate('SendPin', { review });
      return;
    }
    try {
      const result = await confirm({
        method: 'BIOMETRIC',
        prompt: transferPrompt(biometrics.kind, amount, review.recipient.name),
      });
      if (result?.state === 'DRAFT')
        navigation.navigate('SendPin', { review, notice: biometricFallbackNotice(result.auth, biometrics.kind) });
    } catch (e) {
      setError(toUserError(e).message);
    }
  };

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="send-review">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back to amount" />

      <View style={styles.hero} accessible accessibilityLabel={`You're sending ${amount} to ${review.recipient.name}`}>
        <Text style={styles.heroLabel}>You're sending</Text>
        <Text style={styles.heroAmount} adjustsFontSizeToFit numberOfLines={1} testID="review-amount">
          {amount}
        </Text>
        <View style={styles.to}>
          <Avatar id={review.recipient.userId} name={review.recipient.name} size={36} />
          <View>
            <Text style={styles.toName}>to {review.recipient.name}</Text>
            <Text style={styles.toPhone}>{formatPhone(review.recipient.phone)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.gap} />
      <Summary
        rows={[
          { label: 'Fee', value: review.fee === 0 ? 'Free' : core.formatMoney(review.fee), testID: 'review-fee' },
          ...(review.note ? [{ label: 'Note', value: review.note, testID: 'review-note' }] : []),
          { label: 'Balance after', value: core.formatMoney(review.balanceAfter), testID: 'review-balance-after' },
        ]}
      />

      <View style={styles.spacer} />
      {error && (
        <Text style={styles.error} accessibilityRole="alert" testID="review-error">
          {error}
        </Text>
      )}
      <Text style={sendStyles.caption}>Nothing is sent until you confirm with your fingerprint or PIN.</Text>
      <View style={sendStyles.footer}>
        <PrimaryButton label="Confirm and send" onPress={onConfirm} busy={sending} testID="review-confirm" />
        <TextButton label="Edit amount" onPress={() => navigation.goBack()} testID="review-edit" accent />
      </View>
      {sending && <ProcessingView amount={amount} recipient={review.recipient.name} />}
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
  to: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  toPhone: { color: colors.textSecondary, fontSize: 13 },
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
