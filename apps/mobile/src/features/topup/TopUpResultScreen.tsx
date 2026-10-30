import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TransferResult } from '@pocketly/core-contract';
import { Clock, Copy, Share2 } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { receiptText } from '../history/receipt';
import { formatDateTime } from '../home/presentation';
import {
  PrimaryButton,
  ProcessingView,
  ResultIcon,
  SecondaryButton,
  Summary,
  TextButton,
  sendStyles,
} from '../send/components';
import { transferFinished } from '../send/sendEvents';
import { METHOD_COPY, resultCopy } from './topUpCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'TopUpResult'>;

/** As the Send result: how often a pending top-up asks the server again while this screen is open. */
const STATUS_POLL_MS = 5_000;

/**
 * Top-Up, the outcome (FR-TOP-03, as FR-TRF-07/08/09): Money added, Failed with Retry on the same
 * key, Declined by the payment method (not retryable: pick another method), or Still processing
 * (checks again every few seconds; a pending top-up isn't in the balance yet, ADR-0015 §3).
 */
export function TopUpResultScreen({ navigation, route }: Props) {
  const { review, result } = route.params;
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = core.formatMoney(review.amount);
  const method = METHOD_COPY[review.method].label;
  const tx = result.transaction;
  const copy = resultCopy(result);

  // Balance and history update behind this screen (as FR-TRF-07).
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
      update(await core.confirmTransfer(review.id)); // same key
    } catch (e) {
      setError(toUserError(e).message);
    } finally {
      setRetrying(false);
    }
  };

  const otherMethod = () =>
    navigation.reset({
      index: 1,
      routes: [{ name: 'Tabs' }, { name: 'TopUpMethod', params: { amount: review.amount } }],
    });
  const done = () => navigation.goBack();
  const shareReceipt = () => {
    if (tx) Share.share({ title: 'Pocketly receipt', message: receiptText(tx, `+${amount}`) }).catch(() => {});
  };
  const shareId = () => {
    if (tx) Share.share({ message: tx.id }).catch(() => {});
  };

  const balance = result.balance !== undefined ? core.formatMoney(result.balance) : undefined;

  return (
    <SafeAreaView
      style={sendStyles.root}
      edges={['top', 'bottom']}
      testID={`topup-result-${result.state.toLowerCase()}`}
    >
      <StatusBar barStyle="light-content" />
      <View
        style={styles.top}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${copy.title}. ${result.state === 'SUCCESS' ? `${amount} from ${method}` : copy.message}`}
      >
        <ResultIcon state={result.state} retryable={result.retryable === true} />
        <Text style={styles.title} testID="topup-result-title">
          {copy.title}
        </Text>
        {result.state === 'SUCCESS' ? (
          <>
            <Text style={styles.amount}>{amount}</Text>
            <Text style={styles.message}>from {method}</Text>
          </>
        ) : (
          <Text style={styles.message} testID="topup-result-message">
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
                  testID="topup-result-copy-id"
                >
                  <Text style={styles.idText} selectable testID="topup-result-tx-id">
                    {tx.id}
                  </Text>
                  <Copy color={colors.textSecondary} size={18} />
                </Pressable>
              ),
            },
            { label: 'Date', value: formatDateTime(tx.createdAt) },
            ...(balance ? [{ label: 'New balance', value: balance, testID: 'topup-result-balance' }] : []),
          ]}
        />
      ) : (
        <Summary
          rows={[
            { label: 'Amount', value: amount },
            { label: 'From', value: method },
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
                  label: 'Your balance',
                  value: balance ? `${balance} (unchanged)` : '—',
                  testID: 'topup-result-balance',
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
        <Text style={sendStyles.caption}>
          Please don't top up again. The money shows in your balance once it's done.
        </Text>
      )}
      <View style={sendStyles.footer}>
        {result.state === 'SUCCESS' && (
          <SecondaryButton label="Share receipt" Icon={Share2} onPress={shareReceipt} testID="topup-result-share" />
        )}
        {result.state === 'PENDING' && tx && (
          <SecondaryButton
            label="View in History"
            onPress={() => navigation.navigate('TransactionDetail', { id: tx.id, tx })}
            testID="topup-result-view"
          />
        )}
        {result.state === 'FAILED' && result.retryable ? (
          <PrimaryButton label="Try again" onPress={retry} busy={retrying} testID="topup-result-retry" />
        ) : result.state === 'FAILED' ? (
          <PrimaryButton label="Choose another method" onPress={otherMethod} testID="topup-result-other-method" />
        ) : (
          <PrimaryButton label="Done" onPress={done} testID="topup-result-done" />
        )}
        {result.state === 'FAILED' && <TextButton label="Cancel" onPress={done} testID="topup-result-cancel" />}
      </View>
      {retrying && <ProcessingView title={`Adding ${amount}`} subtitle={`from ${method}`} testID="topup-processing" />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: 10, paddingTop: 80, paddingHorizontal: 28 },
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
