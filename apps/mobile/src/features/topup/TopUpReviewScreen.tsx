import React, { useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TopUpReview, TransferResult } from '@pocketly/core-contract';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { PrimaryButton, ProcessingView, SendHeader, Summary, TextButton, sendStyles } from '../send/components';
import { METHOD_COPY } from './topUpCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'TopUpReview'>;

/**
 * Top-Up, step 3: review, then confirm (FR-TOP-03). No PIN or biometrics: the payment method
 * authorizes the charge itself (ADR-0015 §2), so the button confirms directly. While the server
 * processes it (2–5 s, FR-TOP-02) the processing screen covers this one; the result then
 * replaces the flow in the back stack.
 */
export function TopUpReviewScreen({ navigation, route }: Props) {
  const { review } = route.params;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = core.formatMoney(review.amount);
  const { label: method, approval } = METHOD_COPY[review.method];

  const confirm = async () => {
    setSending(true);
    setError(null);
    try {
      showTopUpResult(navigation, review, await core.confirmTransfer(review.id));
    } catch (e) {
      setSending(false);
      setError(toUserError(e).message);
    }
  };

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="topup-review">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back to payment method" title="Top up" />

      <View style={styles.hero} accessible accessibilityLabel={`You're adding ${amount} from ${method}`}>
        <Text style={styles.heroLabel}>You're adding</Text>
        <Text style={styles.heroAmount} adjustsFontSizeToFit numberOfLines={1} testID="topup-review-amount">
          {amount}
        </Text>
        <Text style={styles.from}>from {method}</Text>
      </View>

      <View style={styles.gap} />
      <Summary
        rows={[
          { label: 'Fee', value: review.fee === 0 ? 'Free' : core.formatMoney(review.fee), testID: 'topup-review-fee' },
          {
            label: 'Balance after',
            value: core.formatMoney(review.balanceAfter),
            testID: 'topup-review-balance-after',
          },
        ]}
      />

      <View style={styles.spacer} />
      {error && (
        <Text style={styles.error} accessibilityRole="alert" testID="topup-review-error">
          {error}
        </Text>
      )}
      <Text style={sendStyles.caption}>{approval} No PIN needed.</Text>
      <View style={sendStyles.footer}>
        <PrimaryButton label={`Top up ${amount}`} onPress={confirm} busy={sending} testID="topup-review-confirm" />
        <TextButton label="Change method" onPress={() => navigation.goBack()} testID="topup-review-edit" accent />
      </View>
      {sending && <ProcessingView title={`Adding ${amount}`} subtitle={`from ${method}`} testID="topup-processing" />}
    </SafeAreaView>
  );
}

/** The result replaces the flow, so Back can't reopen a sent top-up (product §7.3 rule 3). */
export function showTopUpResult(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  review: TopUpReview,
  result: TransferResult,
): void {
  navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'TopUpResult', params: { review, result } }] });
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
  from: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
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
