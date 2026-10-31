import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TOP_UP_MAX_MINOR, TOP_UP_MIN_MINOR, TOP_UP_PRESETS_MINOR } from '@pocketly/core-contract';
import type { AmountCheck } from '@pocketly/core-contract';
import { CircleAlert } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { AmountKeypad, PrimaryButton, SendHeader, sendStyles } from '../send/components';
import { amountMessage } from './topUpCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'TopUpAmount'>;

function check(text: string): AmountCheck {
  try {
    return core.checkTopUpAmount(text);
  } catch {
    return { ok: false, reason: 'INVALID_FORMAT', acceptInput: false };
  }
}

/**
 * Top-Up, step 1: the amount (FR-TOP-01). Preset chips, or the keypad, whose text goes to the
 * core on every key (checkTopUpAmount): keys that can't lead to an amount are dropped, and an
 * amount outside 5.00–1,000.00 says so. No server call here, so it works offline; the method
 * step is where an offline top-up stops.
 */
export function TopUpAmountScreen({ navigation }: Props) {
  const [text, setText] = useState('');
  const current = useMemo(() => check(text), [text]);
  const fmt = (minor: number) => core.formatMoney(minor);

  const type = (key: string) => {
    if (check(text + key).acceptInput) setText(text + key);
  };
  // The core's own formatting, as keypad text ("$25.00" → "25.00"): no money math here.
  const choose = (minor: number) => setText(fmt(minor).replace(/[$,]/g, ''));
  const next = () => {
    if (current.ok && current.minor !== undefined) navigation.navigate('TopUpMethod', { amount: current.minor });
  };

  const message = amountMessage(current, fmt);
  const shown = text.length === 0 ? '$0' : `$${text}`;

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="topup-amount">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Back to Home" title="Top up" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.amountBlock}>
          <Text
            style={styles.amount}
            adjustsFontSizeToFit
            numberOfLines={1}
            accessibilityLabel={current.minor !== undefined ? `Amount ${fmt(current.minor)}` : 'No amount yet'}
            accessibilityLiveRegion="polite"
            testID="topup-amount-display"
          >
            {shown}
          </Text>
          <Text style={styles.sub} testID="topup-limits">
            {fmt(TOP_UP_MIN_MINOR)} to {fmt(TOP_UP_MAX_MINOR)} per top-up
          </Text>
          {message && (
            <View style={styles.alert} accessibilityRole="alert">
              <CircleAlert color={colors.danger} size={18} />
              <Text style={styles.alertText} testID="topup-amount-error">
                {message}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Amounts">
          {TOP_UP_PRESETS_MINOR.map((minor) => {
            const selected = current.minor === minor;
            return (
              <Pressable
                key={minor}
                style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}
                onPress={() => choose(minor)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={fmt(minor)}
                testID={`topup-preset-${minor}`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{fmt(minor)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <AmountKeypad onKey={type} onErase={() => setText(text.slice(0, -1))} />
      <View style={[sendStyles.footer, styles.footer]}>
        <PrimaryButton
          label={current.ok && current.minor !== undefined ? `Continue with ${fmt(current.minor)}` : 'Continue'}
          onPress={next}
          disabled={!current.ok}
          testID="topup-amount-continue"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.lg },
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
  alertText: { color: colors.danger, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  chip: {
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primaryDim, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chipTextOn: { color: colors.primary },
  pressed: { opacity: 0.7 },
  footer: { paddingTop: spacing.md },
});
