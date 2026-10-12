import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Transaction } from '@pocketly/core-contract';
import { NoticeBanner } from '../../components/NoticeBanner';
import { ChevronLeft, Copy, Share2 } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError, userErrorFor, type UserError } from '../errors';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  counterpartyName,
  formatDateTime,
  isIncoming,
} from '../home/presentation';
import { receiptText } from './receipt';

type Props = NativeStackScreenProps<RootStackParamList, 'TransactionDetail'>;

const STATUS_COLOR: Record<Transaction['status'], string> = {
  SUCCESS: colors.primary,
  PENDING: colors.tertiary,
  FAILED: colors.danger,
  REVERSED: colors.textSecondary,
};

function Field({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Transaction detail (FR-HIST-05): ID, type, counterparty, amount, status, timestamps, note;
 * copy ID and share receipt. Both go through the system share sheet (it has Copy), so the
 * app needs no clipboard module. The ID is also selectable for long-press copy.
 */
export function TransactionDetailScreen({ route, navigation }: Props) {
  const { id, tx: initial } = route.params;
  const [tx, setTx] = useState<Transaction | undefined>(initial);
  const [error, setError] = useState<UserError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Re-read by id: a pending transaction may have settled since the list was loaded.
  // getTransaction reads the replica first, so this works offline (ADR-0009).
  useEffect(() => {
    let live = true;
    core.getTransaction(id).then(
      (fresh) => {
        if (!live) return;
        setTx(fresh);
        setError(null);
      },
      (e: unknown) => live && setError(toUserError(e)),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const amount = tx ? `${isIncoming(tx.type) ? '+' : '-'}${core.formatMoney(tx.amount)}` : '';

  const shareId = () => {
    Share.share({ message: id }).catch(() => {});
  };
  const shareReceipt = () => {
    if (tx) Share.share({ title: 'Pocketly receipt', message: receiptText(tx, amount) }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          testID="detail-back"
        >
          <ChevronLeft color={colors.textPrimary} size={26} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Transaction details
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {!tx ? (
        error && (
          <View style={styles.content}>
            <NoticeBanner notice={error} retrying={false} onRetry={() => setAttempt((n) => n + 1)} testIdPrefix="detail" />
          </View>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.counterparty}>{counterpartyName(tx)}</Text>
            <Text
              style={[styles.amount, isIncoming(tx.type) && styles.amountIn, tx.status === 'FAILED' && styles.amountFailed]}
              testID="detail-amount"
            >
              {amount}
            </Text>
            <View style={styles.status}>
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[tx.status] }]} />
              <Text style={[styles.statusText, { color: STATUS_COLOR[tx.status] }]} testID="detail-status">
                {STATUS_LABEL[tx.status]}
              </Text>
            </View>
            {tx.failureReason && <Text style={styles.failure}>{userErrorFor(tx.failureReason).message}</Text>}
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Transaction ID</Text>
              <View style={styles.idRow}>
                <Text style={[styles.fieldValue, styles.id]} selectable testID="detail-id">
                  {tx.id}
                </Text>
                <Pressable
                  onPress={shareId}
                  accessibilityRole="button"
                  accessibilityLabel="Copy transaction ID"
                  accessibilityHint="Opens the share sheet, which has Copy"
                  hitSlop={8}
                  testID="detail-copy-id"
                >
                  <Copy color={colors.primary} size={18} />
                </Pressable>
              </View>
            </View>
            <Field label="Type" value={TYPE_LABEL[tx.type]} />
            <Field label="Category" value={CATEGORY_LABEL[tx.category]} />
            {tx.counterparty && (
              <Field
                label={isIncoming(tx.type) ? 'From' : 'To'}
                value={tx.counterparty.phone ? `${tx.counterparty.name} · ${tx.counterparty.phone}` : tx.counterparty.name}
              />
            )}
            <Field label="Created" value={formatDateTime(tx.createdAt)} />
            <Field label="Last updated" value={formatDateTime(tx.updatedAt)} />
            {tx.note && <Field label="Note" value={tx.note} testID="detail-note" />}
          </View>

          <Pressable style={styles.shareButton} onPress={shareReceipt} accessibilityRole="button" testID="detail-share">
            <Share2 color={colors.onPrimary} size={18} />
            <Text style={styles.shareText}>Share receipt</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...type.body, color: colors.textPrimary },
  headerSpacer: { width: 26 },
  content: { padding: spacing.lg, gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  counterparty: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  amount: { ...type.balance, color: colors.textPrimary },
  amountIn: { color: colors.primary },
  amountFailed: { color: colors.textMuted, textDecorationLine: 'line-through' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, fontWeight: '700' },
  failure: { color: colors.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  field: {
    gap: 2,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: { ...type.caption, color: colors.textSecondary },
  fieldValue: { color: colors.textPrimary, fontSize: 15 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  id: { flex: 1, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
  },
  shareText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
});
