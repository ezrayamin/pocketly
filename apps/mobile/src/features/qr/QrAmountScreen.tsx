import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AmountCheck } from '@pocketly/core-contract';
import { CircleAlert, ShoppingBag } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { AmountKeypad, PrimaryButton, SendHeader, sendStyles } from '../send/components';
import { amountMessage, canOfferMax } from '../send/sendCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'QrAmount'>;

function check(text: string): AmountCheck {
  try {
    return core.checkTransferAmount(text); // against the QR payment's draft (startQrPayment)
  } catch {
    return { ok: false, reason: 'INVALID_FORMAT', acceptInput: false }; // the draft is gone (logout)
  }
}

/**
 * QR Pay, a static code's amount (FR-QR-03): the merchant's name is the server's, the user types
 * the amount, and the core checks every key against the balance and today's limit (as FR-TRF-02).
 */
export function QrAmountScreen({ navigation, route }: Props) {
  const { draft } = route.params;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useMemo(() => check(text), [text]);
  const fmt = (minor: number) => core.formatMoney(minor);

  const type = (key: string) => {
    if (check(text + key).acceptInput) setText(text + key);
  };
  const payMax = () => setText(fmt(draft.maxAmount).replace(/[$,]/g, ''));

  const review = async () => {
    if (!current.ok || current.minor === undefined) return;
    setBusy(true);
    setError(null);
    try {
      navigation.navigate('QrReview', { review: await core.reviewQrPayment(current.minor) });
    } catch (e) {
      setError(toUserError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const message = amountMessage(current, draft, fmt);
  const remaining = current.remainingBalance ?? draft.balance;

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="qr-amount">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Close" title="Pay" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.merchant} accessible accessibilityLabel={`Paying ${draft.merchant.name}`}>
          <View style={styles.merchantIcon}>
            <ShoppingBag color={colors.textPrimary} size={20} />
          </View>
          <Text style={styles.merchantName} testID="qr-amount-merchant">
            {draft.merchant.name}
          </Text>
        </View>
        <View style={styles.amountBlock}>
          <Text
            style={styles.amount}
            adjustsFontSizeToFit
            numberOfLines={1}
            accessibilityLabel={current.minor !== undefined ? `Amount ${fmt(current.minor)}` : 'No amount yet'}
            accessibilityLiveRegion="polite"
            testID="qr-amount-display"
          >
            {text.length === 0 ? '$0' : `$${text}`}
          </Text>
          <Text style={styles.sub}>
            {remaining >= 0 ? `Balance after: ${fmt(remaining)}` : `Balance: ${fmt(draft.balance)}`}
          </Text>
          {message && (
            <View style={styles.alert} accessibilityRole="alert">
              <CircleAlert color={colors.danger} size={18} />
              <Text style={styles.alertText} testID="qr-amount-error">
                {message}
              </Text>
            </View>
          )}
          {canOfferMax(current, draft) && (
            <Pressable style={styles.maxButton} onPress={payMax} accessibilityRole="button" testID="qr-amount-max">
              <Text style={styles.maxText}>Pay {fmt(draft.maxAmount)} instead</Text>
            </Pressable>
          )}
          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      </ScrollView>
      <AmountKeypad onKey={type} onErase={() => setText(text.slice(0, -1))} />
      <View style={[sendStyles.footer, styles.footer]}>
        <PrimaryButton
          label={current.ok && current.minor !== undefined ? `Review ${fmt(current.minor)}` : 'Review'}
          onPress={review}
          disabled={!current.ok}
          busy={busy}
          testID="qr-amount-review"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.lg },
  merchant: {
    marginHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  merchantIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchantName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  amountBlock: { alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  amount: {
    color: colors.textPrimary,
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  sub: { color: colors.textSecondary, fontSize: 14 },
  alert: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.dangerDim,
    maxWidth: 340,
  },
  alertText: { color: colors.danger, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  maxButton: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  maxText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  footer: { paddingTop: spacing.md },
});
