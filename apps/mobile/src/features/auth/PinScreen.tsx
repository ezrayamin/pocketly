import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSecureScreen } from '@pocketly/native-secure-screen';
import { LockKeyhole } from '../../components/icons';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { PinDots, PinPad, type PinPadAction } from './PinPad';

export type PinMessage = { tone: 'error' | 'info'; text: string };

/**
 * Layout shared by PIN creation and unlock: title, one message line, dots, keypad. Blocks
 * screenshots and recordings while shown (NFR-SEC-03).
 */
export function PinScreen(props: {
  title: string;
  subtitle: string;
  message: PinMessage | null;
  count: number;
  busy: boolean;
  /** Keypad off without the busy spinner (lockout). */
  locked?: boolean;
  shakeToken: number;
  onDigit: (digit: string) => void;
  onErase: () => void;
  action?: PinPadAction;
  testID: string;
}) {
  useSecureScreen();
  const { message } = props;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID={props.testID}>
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <View style={styles.badge}>
          <LockKeyhole color={colors.primary} size={28} />
        </View>
        <Text style={styles.title} accessibilityRole="header" testID="pin-title">
          {props.title}
        </Text>
        <Text style={styles.subtitle}>{props.subtitle}</Text>
        <PinDots count={props.count} busy={props.busy} shakeToken={props.shakeToken} />
        <Text
          style={[styles.message, message?.tone === 'error' && styles.error]}
          accessibilityLiveRegion="assertive"
          testID="pin-message"
        >
          {message?.text ?? ' '}
        </Text>
      </View>
      <PinPad
        onDigit={props.onDigit}
        onErase={props.onErase}
        disabled={props.busy || props.locked === true}
        action={props.action}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'space-between', paddingBottom: spacing.xxl },
  top: { alignItems: 'center', paddingTop: spacing.xxl * 2, paddingHorizontal: spacing.xxl, gap: spacing.md },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.title, color: colors.textPrimary },
  subtitle: { ...type.caption, color: colors.textSecondary, textAlign: 'center' },
  message: { ...type.caption, color: colors.textSecondary, textAlign: 'center', minHeight: 32 },
  error: { color: colors.danger },
});
