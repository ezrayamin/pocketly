import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlowMarksProbe, flowMark } from '@pocketly/bench-app';
import type { TransferResult } from '@pocketly/core-contract';
import { Check, CircleAlert, CircleX, Clock, Copy, Share2 } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { receiptText } from '../history/receipt';
import { formatDateTime } from '../home/presentation';
import { PrimaryButton, ProcessingView, SecondaryButton, Summary, TextButton, sendStyles } from './components';
import { resultCopy } from './sendCopy';
import { transferFinished } from './sendEvents';

type Props = NativeStackScreenProps<RootStackParamList, 'SendResult'>;

/** FR-TRF-09: how often a pending transfer asks the server again while this screen is open. */
const STATUS_POLL_MS = 5_000;

/**
 * Send, the outcome (FR-TRF-07/08/09): Sent (animated check, transaction ID, share receipt),
 * Failed with Retry on the same key, Declined (not retryable: change the amount), or Still
 * processing (checks again every few seconds until it settles). The flow below it is gone from
 * the back stack: Back and Done go to Home.
 */
export function SendResultScreen({ navigation, route }: Props) {
  const { review, result } = route.params;
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = core.formatMoney(review.amount);
  const tx = result.transaction;
  const copy = resultCopy(result);

  useEffect(() => flowMark(`result-shown-${route.params.result.state}`), [route.params.result.state]); // BM-07

  // FR-TRF-07: balance and history update behind this screen.
  useEffect(() => {
    transferFinished();
  }, [result]);

  const update = useCallback((next: TransferResult) => navigation.setParams({ result: next }), [navigation]);

  useEffect(() => {
    if (result.state !== 'PENDING') return;
    const timer = setInterval(() => {
      core.getTransferStatus(review.id).then(
        (next) => next.state !== 'PENDING' && update(next),
        () => {}, // still unreachable: stays pending, tries again
      );
    }, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [result.state, review.id, update]);

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      update(await core.confirmTransfer(review.id)); // same key (FR-TRF-08)
    } catch (e) {
      setError(toUserError(e).message);
    } finally {
      setRetrying(false);
    }
  };

  const changeAmount = async () => {
    try {
      const draft = await core.startTransfer(review.recipient.userId);
      navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'SendAmount', params: { draft } }] });
    } catch (e) {
      setError(toUserError(e).message);
    }
  };

  const done = () => navigation.goBack();
  const shareReceipt = () => {
    if (tx) Share.share({ title: 'Pocketly receipt', message: receiptText(tx, `-${amount}`) }).catch(() => {});
  };
  const shareId = () => {
    if (tx) Share.share({ message: tx.id }).catch(() => {});
  };

  const balance = result.balance !== undefined ? core.formatMoney(result.balance) : undefined;

  return (
    <SafeAreaView
      style={sendStyles.root}
      edges={['top', 'bottom']}
      testID={`send-result-${result.state.toLowerCase()}`}
    >
      <StatusBar barStyle="light-content" />
      <View
        style={styles.top}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${copy.title}. ${
          result.state === 'SUCCESS' ? `${amount} to ${review.recipient.name}` : copy.message
        }`}
      >
        <ResultIcon state={result.state} retryable={result.retryable === true} />
        <Text style={styles.title} testID="result-title">
          {copy.title}
        </Text>
        {result.state === 'SUCCESS' ? (
          <>
            <Text style={styles.amount}>{amount}</Text>
            <Text style={styles.message}>to {review.recipient.name}</Text>
          </>
        ) : (
          <Text style={styles.message} testID="result-message">
            {copy.message}
          </Text>
        )}
      </View>

      <View style={styles.gap} />
      {result.state === 'SUCCESS' && tx ? (
        <Summary
          rows={[
            {
              label: 'Transaction ID',
              value: (
                <Pressable
                  style={styles.idRow}
                  onPress={shareId}
                  accessibilityRole="button"
                  accessibilityLabel={`Transaction ID ${tx.id}. Copy`}
                  testID="result-copy-id"
                >
                  <Text style={styles.idText} selectable testID="result-tx-id">
                    {tx.id}
                  </Text>
                  <Copy color={colors.textSecondary} size={18} />
                </Pressable>
              ),
            },
            { label: 'Date', value: formatDateTime(tx.createdAt) },
            ...(review.note ? [{ label: 'Note', value: review.note }] : []),
            ...(balance ? [{ label: 'New balance', value: balance, testID: 'result-balance' }] : []),
          ]}
        />
      ) : (
        <Summary
          rows={[
            { label: 'Amount', value: amount },
            { label: 'To', value: review.recipient.name },
            result.state === 'PENDING'
              ? {
                  label: 'Status',
                  value: (
                    <View style={styles.pill}>
                      <Clock color={colors.tertiary} size={14} />
                      <Text style={styles.pillText}>Pending</Text>
                    </View>
                  ),
                }
              : {
                  label: result.retryable ? 'Your balance' : 'Available now',
                  value: balance ? (result.retryable ? `${balance} (unchanged)` : balance) : '—',
                  testID: 'result-balance',
                },
          ]}
        />
      )}

      <View style={styles.spacer} />
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {result.state === 'FAILED' && result.retryable && (
        <Text style={sendStyles.caption}>Trying again is safe. You won't be charged twice.</Text>
      )}
      {result.state === 'PENDING' && (
        <Text style={sendStyles.caption}>Please don't send it again. This transfer will update on its own.</Text>
      )}
      <View style={sendStyles.footer}>
        {result.state === 'SUCCESS' && (
          <SecondaryButton label="Share receipt" Icon={Share2} onPress={shareReceipt} testID="result-share" />
        )}
        {result.state === 'PENDING' && tx && (
          <SecondaryButton
            label="View in History"
            onPress={() => navigation.navigate('TransactionDetail', { id: tx.id, tx })}
            testID="result-view"
          />
        )}
        {result.state === 'FAILED' && result.retryable ? (
          <PrimaryButton label="Try again" onPress={retry} busy={retrying} testID="result-retry" />
        ) : result.state === 'FAILED' ? (
          <PrimaryButton label="Change amount" onPress={changeAmount} testID="result-change-amount" />
        ) : (
          <PrimaryButton label="Done" onPress={done} testID="result-done" />
        )}
        {result.state === 'FAILED' && <TextButton label="Cancel" onPress={done} testID="result-cancel" />}
      </View>
      {FlowMarksProbe && <FlowMarksProbe key={result.state} />}
      {retrying && <ProcessingView amount={amount} recipient={review.recipient.name} />}
    </SafeAreaView>
  );
}

/** FR-TRF-07 "animated success": the check pops in. Status is never color alone (NFR-A11Y-03). */
function ResultIcon({ state, retryable }: { state: TransferResult['state']; retryable: boolean }) {
  const scale = useRef(new Animated.Value(state === 'SUCCESS' ? 0.4 : 1)).current;
  useEffect(() => {
    if (state !== 'SUCCESS') return;
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
  }, [state, scale]);
  const look =
    state === 'SUCCESS'
      ? { bg: colors.primary, Icon: Check, color: colors.onPrimary }
      : state === 'PENDING'
      ? { bg: colors.tertiaryDim, Icon: Clock, color: colors.tertiary }
      : { bg: colors.dangerDim, Icon: retryable ? CircleAlert : CircleX, color: colors.danger };
  return (
    <Animated.View style={[styles.icon, { backgroundColor: look.bg, transform: [{ scale }] }]} testID="result-icon">
      <look.Icon color={look.color} size={40} strokeWidth={2.4} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: 10, paddingTop: 80, paddingHorizontal: 28 },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  amount: {
    color: colors.textPrimary,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  message: { color: colors.textSecondary, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  gap: { height: 32 },
  spacer: { flex: 1 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  idText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.tertiaryDim,
  },
  pillText: { color: colors.tertiary, fontSize: 13, fontWeight: '700' },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
});
