import React, { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TopUpMethod } from '@pocketly/core-contract';
import { CreditCard, Landmark, WifiOff, type LucideIcon } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { toUserError, type UserError } from '../errors';
import { PrimaryButton, SendHeader, sendStyles } from '../send/components';
import { METHOD_COPY } from './topUpCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'TopUpMethod'>;

const METHODS: { method: TopUpMethod; Icon: LucideIcon }[] = [
  { method: 'BANK_TRANSFER', Icon: Landmark },
  { method: 'CARD', Icon: CreditCard },
];

/**
 * Top-Up, step 2: the payment method (FR-TOP-02, mocked). Continue reviews the top-up
 * (reviewTopUp): a fresh wallet from the server and the attempt's key, so offline it stops here
 * with a clear message (as FR-TRF-11).
 */
export function TopUpMethodScreen({ navigation, route }: Props) {
  const { amount } = route.params;
  const [method, setMethod] = useState<TopUpMethod>('BANK_TRANSFER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserError | null>(null);

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await core.reviewTopUp(amount, method);
      navigation.navigate('TopUpReview', { review: r });
    } catch (e) {
      setError(toUserError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="topup-method">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back to amount" title="Top up" />

      <Text style={styles.lead} testID="topup-method-amount">
        Add {core.formatMoney(amount)} from
      </Text>
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Payment method">
        {METHODS.map(({ method: m, Icon }) => {
          const selected = m === method;
          const { label, hint } = METHOD_COPY[m];
          return (
            <Pressable
              key={m}
              style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
              onPress={() => setMethod(m)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}, ${hint}`}
              testID={`topup-method-${m}`}
            >
              <View style={styles.iconCircle}>
                <Icon color={colors.textPrimary} size={22} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{label}</Text>
                <Text style={styles.optionHint}>{hint}</Text>
              </View>
              <View style={[styles.radio, selected && styles.radioOn]}>
                {selected && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.spacer} />
      {error && (
        <View
          style={styles.error}
          accessibilityRole="alert"
          testID={error.offline ? 'topup-offline' : 'topup-method-error'}
        >
          {error.offline && <WifiOff color={colors.danger} size={18} />}
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      )}
      <View style={sendStyles.footer}>
        <PrimaryButton label="Continue" onPress={review} busy={busy} testID="topup-method-continue" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  lead: {
    color: colors.textSecondary,
    fontSize: 15,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionOn: { borderColor: colors.primary },
  pressed: { opacity: 0.7 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  optionHint: { color: colors.textSecondary, fontSize: 13 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  spacer: { flex: 1 },
  error: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.dangerDim,
  },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
