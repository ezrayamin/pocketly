import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { flowMark } from '@pocketly/bench-app';
import type { AmountCheck } from '@pocketly/core-contract';
import { TRANSFER_NOTE_MAX_LENGTH } from '@pocketly/core-contract';
import { CircleAlert } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { AmountKeypad, PrimaryButton, RecipientRow, SendHeader, sendStyles } from './components';
import { amountMessage, canOfferMax } from './sendCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'SendAmount'>;

/** The core checks every keystroke; a refused one never reaches the screen. */
function check(text: string): AmountCheck {
  try {
    return core.checkTransferAmount(text);
  } catch {
    return { ok: false, reason: 'INVALID_FORMAT', acceptInput: false }; // the draft is gone (logout)
  }
}

/**
 * Send, step 2: the amount (FR-TRF-02/10). The keypad's text goes to the core on every key
 * (checkTransferAmount): keys that can't lead to an amount are dropped, the remaining balance
 * updates live, and the daily limit or the balance is named as soon as it's crossed, with
 * "Send <max> instead".
 */
export function SendAmountScreen({ navigation, route }: Props) {
  const { draft } = route.params;
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useMemo(() => check(text), [text]);
  useEffect(() => flowMark('amount-shown'), []); // BM-07
  const fmt = (minor: number) => core.formatMoney(minor);

  const type = (key: string) => {
    const next = check(text + key);
    if (next.acceptInput) setText(text + key);
  };
  // The core's own formatting, as keypad text ("$1,650.00" → "1650.00"): no money math here.
  const sendMax = () => setText(fmt(draft.maxAmount).replace(/[$,]/g, ''));

  const review = async () => {
    flowMark('review-tap');
    if (!current.ok || current.minor === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const r = await core.reviewTransfer(current.minor, note);
      navigation.navigate('SendReview', { review: r });
    } catch (e) {
      setError(toUserError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const message = amountMessage(current, draft, fmt);
  const shown = text.length === 0 ? '$0' : `$${text}`;
  const remaining = current.remainingBalance ?? draft.balance;

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="send-amount">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back to recipients" />

      {/* Scrolls when messages and large text need the room; the keypad and button stay put. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.recipientCard}>
          <RecipientRow contact={draft.recipient} size={40} />
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Change recipient"
            hitSlop={8}
            testID="amount-change"
          >
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </View>

        <View style={styles.amountBlock}>
          <Text
            style={styles.amount}
            adjustsFontSizeToFit
            numberOfLines={1}
            accessibilityLabel={current.minor !== undefined ? `Amount ${fmt(current.minor)}` : 'No amount yet'}
            accessibilityLiveRegion="polite"
            testID="amount-display"
          >
            {shown}
          </Text>
          <Text style={styles.sub} testID="amount-remaining">
            {remaining >= 0 ? `Balance after: ${fmt(remaining)}` : `Balance: ${fmt(draft.balance)}`}
          </Text>
          <Text style={styles.sub} testID="amount-today">
            You can send {fmt(draft.dailyRemaining)} today
          </Text>
          {message && (
            <View style={styles.alert} accessibilityRole="alert" testID="amount-error">
              <CircleAlert color={colors.danger} size={18} />
              <Text style={styles.alertText}>{message}</Text>
            </View>
          )}
          {canOfferMax(current, draft) && (
            <Pressable style={styles.maxButton} onPress={sendMax} accessibilityRole="button" testID="amount-send-max">
              <Text style={styles.maxText}>Send {fmt(draft.maxAmount)} instead</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.noteBlock}>
          <Text style={styles.noteLabel} nativeID="note-label">
            Note (optional)
          </Text>
          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            maxLength={TRANSFER_NOTE_MAX_LENGTH}
            placeholder="What's it for?"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Note, optional"
            accessibilityLabelledBy="note-label"
            returnKeyType="done"
            testID="amount-note"
          />
          {error && (
            <Text style={styles.noteError} accessibilityRole="alert">
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
          testID="amount-review"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  recipientCard: {
    marginHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  change: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 10,
  },
  amountBlock: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
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
  alertText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  maxButton: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  maxText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  noteBlock: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  noteLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  note: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 16,
  },
  noteError: { color: colors.danger, fontSize: 13 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.lg },
  footer: { paddingTop: spacing.md },
});
