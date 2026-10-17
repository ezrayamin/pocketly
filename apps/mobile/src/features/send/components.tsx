import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Contact } from '@pocketly/core-contract';
import { Avatar } from '../../components/Avatar';
import { ChevronLeft, Delete, type LucideIcon } from '../../components/icons';
import { colors, radius, spacing } from '../../theme/tokens';
import { formatPhone } from '../auth/phoneFormat';

/** Shared pieces of the Send flow screens (F5), after the "Pocketly Send Flow" design. */

export function SendHeader({
  onBack,
  backLabel,
  title = 'Send money',
}: {
  onBack: () => void;
  backLabel: string;
  title?: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        testID="send-back"
      >
        <ChevronLeft color={colors.textPrimary} size={22} />
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID: string;
  accessibilityLabel?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      style={({ pressed }) => [styles.primary, off && styles.primaryDisabled, pressed && !off && styles.pressed]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Text style={[styles.primaryText, off && styles.primaryTextDisabled]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  testID,
  Icon,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  Icon?: LucideIcon;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      {Icon && <Icon color={colors.textPrimary} size={18} />}
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({
  label,
  onPress,
  testID,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  accent?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      <Text style={[styles.textButtonText, accent && styles.accent]}>{label}</Text>
    </Pressable>
  );
}

/** A label/value list in a card (review, result). */
export function Summary({ rows }: { rows: { label: string; value: React.ReactNode; testID?: string }[] }) {
  return (
    <View style={styles.summary}>
      {rows.map((row, i) => (
        <View
          key={row.label}
          style={[styles.summaryRow, i < rows.length - 1 && styles.summaryDivider]}
          accessible={typeof row.value === 'string'}
          accessibilityLabel={typeof row.value === 'string' ? `${row.label}: ${row.value}` : undefined}
        >
          <Text style={styles.summaryLabel}>{row.label}</Text>
          {typeof row.value === 'string' ? (
            <Text style={styles.summaryValue} testID={row.testID}>
              {row.value}
            </Text>
          ) : (
            row.value
          )}
        </View>
      ))}
    </View>
  );
}

export function RecipientRow({ contact, size = 44 }: { contact: Contact; size?: number }) {
  return (
    <View style={styles.recipient}>
      <Avatar id={contact.userId} name={contact.name} size={size} />
      <View style={styles.recipientText}>
        <Text style={styles.recipientName}>{contact.name}</Text>
        <Text style={styles.recipientPhone}>{formatPhone(contact.phone)}</Text>
      </View>
    </View>
  );
}

/** FR-TRF-06: the processing screen, over whatever screen started the send. */
export function ProcessingView({ amount, recipient }: { amount: string; recipient: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.processing} testID="send-processing">
      <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
      <View
        style={styles.processingText}
        accessibilityLiveRegion="polite"
        accessible
        accessibilityLabel={`Sending ${amount} to ${recipient}`}
      >
        <Text style={styles.processingTitle}>Sending {amount}</Text>
        <Text style={styles.processingSub}>to {recipient}</Text>
        <Text style={styles.processingHint}>This usually takes a few seconds.</Text>
      </View>
    </View>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const;

/** FR-TRF-02: the amount keypad. Keys say what they are; the parent decides what a key does. */
export function AmountKeypad({ onKey, onErase }: { onKey: (key: string) => void; onErase: () => void }) {
  return (
    <View style={styles.keypad}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          onPress={() => onKey(k)}
          accessibilityRole="button"
          accessibilityLabel={k === '.' ? 'Decimal point' : k}
          testID={`amount-key-${k === '.' ? 'dot' : k}`}
        >
          <Text style={styles.keyText}>{k}</Text>
        </Pressable>
      ))}
      <Pressable
        style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
        onPress={onErase}
        accessibilityRole="button"
        accessibilityLabel="Delete digit"
        testID="amount-key-erase"
      >
        <Delete color={colors.textPrimary} size={24} />
      </Pressable>
    </View>
  );
}

export const sendStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  caption: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  primary: {
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryDisabled: { backgroundColor: colors.surfaceRaised },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  primaryTextDisabled: { color: colors.textSecondary },
  secondary: {
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  textButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  accent: { color: colors.primary },
  summary: {
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg + 4,
    backgroundColor: colors.surface,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 52,
    gap: spacing.md,
  },
  summaryDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryLabel: { color: colors.textSecondary, fontSize: 15 },
  summaryValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  recipientText: { flex: 1, gap: 2 },
  recipientName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  recipientPhone: { color: colors.textSecondary, fontSize: 13 },
  processing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    padding: 32,
  },
  ring: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 8,
    borderColor: colors.surfaceRaised,
    borderTopColor: colors.primary,
  },
  processingText: { alignItems: 'center', gap: spacing.sm },
  processingTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '700' },
  processingSub: { color: colors.textSecondary, fontSize: 16 },
  processingHint: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  key: {
    width: '31.5%',
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { backgroundColor: colors.surfaceRaised },
  keyText: { color: colors.textPrimary, fontSize: 22, fontWeight: '600' },
});
