import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { PIN_LENGTH } from '@pocketly/core-contract';
import { Delete } from '../../components/icons';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { digitsEnteredLabel } from './pinCopy';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Six dots for the digits entered so far. Screen readers hear "3 of 6 digits entered", never the
 * digits. While the PIN is being checked (`busy`) the dots stay full and a spinner shows below
 * them; each new `shakeToken` shakes them (a wrong or refused PIN).
 */
export function PinDots({ count, busy, shakeToken }: { count: number; busy: boolean; shakeToken: number }) {
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (shakeToken === 0) return;
    shake.setValue(0);
    Animated.sequence(
      [10, -10, 8, -8, 4, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 45, useNativeDriver: true })),
    ).start();
  }, [shakeToken, shake]);

  useEffect(() => {
    if (count > 0) AccessibilityInfo.announceForAccessibility(digitsEnteredLabel(count));
  }, [count]);

  return (
    <View style={styles.dotsRow}>
      <Animated.View
        style={[styles.dots, { transform: [{ translateX: shake }] }]}
        accessible
        accessibilityLabel={busy ? 'Checking your PIN' : digitsEnteredLabel(count)}
        accessibilityLiveRegion="polite"
        testID="pin-dots"
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={[styles.dot, i < count && styles.dotFilled]} />
        ))}
      </Animated.View>
      <View style={styles.spinner}>{busy && <ActivityIndicator color={colors.primary} testID="pin-busy" />}</View>
    </View>
  );
}

export interface PinPadAction {
  label: string;
  onPress: () => void;
  testID: string;
}

/**
 * The in-app keypad. PINs never go through the system keyboard: a third-party keyboard could
 * learn or log them. Keys are labelled with their digit (a blind user has to find "5"); what was
 * entered is only ever announced as a count (PinDots). Disabled while busy or locked out.
 */
export function PinPad({
  onDigit,
  onErase,
  disabled,
  action,
}: {
  onDigit: (digit: string) => void;
  onErase: () => void;
  disabled: boolean;
  /** Bottom-left key, e.g. "Forgot PIN". */
  action?: PinPadAction;
}) {
  const key = (digit: string) => (
    <Pressable
      key={digit}
      style={({ pressed }) => [styles.key, pressed && styles.keyPressed, disabled && styles.keyDisabled]}
      onPress={() => onDigit(digit)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={digit}
      accessibilityState={{ disabled }}
      testID={`pin-key-${digit}`}
    >
      <Text style={styles.keyText}>{digit}</Text>
    </Pressable>
  );

  return (
    <View style={styles.pad}>
      {[0, 3, 6].map((row) => (
        <View key={row} style={styles.row}>
          {KEYS.slice(row, row + 3).map(key)}
        </View>
      ))}
      <View style={styles.row}>
        {action ? (
          <Pressable
            style={styles.key}
            onPress={action.onPress}
            accessibilityRole="button"
            testID={action.testID}
          >
            <Text style={styles.actionText}>{action.label}</Text>
          </Pressable>
        ) : (
          <View style={styles.key} />
        )}
        {key('0')}
        <Pressable
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed, disabled && styles.keyDisabled]}
          onPress={onErase}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Delete last digit"
          accessibilityState={{ disabled }}
          testID="pin-key-erase"
        >
          <Delete color={colors.textPrimary} size={26} />
        </Pressable>
      </View>
    </View>
  );
}

const KEY_SIZE = 76;

const styles = StyleSheet.create({
  dotsRow: { alignItems: 'center', gap: spacing.md },
  dots: { flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.textMuted },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  spinner: { height: 24, justifyContent: 'center' },
  pad: { gap: spacing.md, alignItems: 'center' },
  row: { flexDirection: 'row', gap: spacing.xxl },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { backgroundColor: colors.surfaceRaised },
  keyDisabled: { opacity: 0.35 },
  keyText: { fontSize: 30, fontWeight: '500', color: colors.textPrimary },
  actionText: { ...type.caption, color: colors.primary, textAlign: 'center' },
});
