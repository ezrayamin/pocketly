import React from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSecureScreen } from '@pocketly/native-secure-screen';
import { Fingerprint, LockKeyhole, ShieldCheck, TriangleAlert } from '../../components/icons';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { PinDots, PinPad, type PinPadAction } from './PinPad';

/**
 * What the screen tells the user. `info` is a quiet line under the dots ("Checking…"); `warning`
 * (a wrong PIN, a refused PIN) and `error` (a lockout) are a card above them, with an optional
 * second line and a badge ("Final attempt", "Locked").
 */
export type PinMessage = {
  tone: 'info' | 'warning' | 'error';
  text: string;
  detail?: string;
  badge?: string;
};

/**
 * Layout shared by every PIN screen (create, unlock, Profile setup): lock tile, title, subtitle,
 * message card, dots, an optional biometric button, keypad. Blocks screenshots and recordings
 * while shown (NFR-SEC-03).
 */
export function PinScreen(props: {
  title: string;
  subtitle: string;
  /** Show the shield before the subtitle (the lock screen: "Pocketly is locked…"). */
  shield?: boolean;
  message: PinMessage | null;
  count: number;
  busy: boolean;
  /** Keypad off without the busy spinner (lockout). */
  locked?: boolean;
  shakeToken: number;
  onDigit: (digit: string) => void;
  onErase: () => void;
  /** Bottom-left key, e.g. "Forgot PIN?". */
  action?: PinPadAction;
  /** The full-width button above the keypad, e.g. "Unlock with fingerprint". */
  biometricAction?: PinPadAction;
  testID: string;
}) {
  useSecureScreen();
  const { message } = props;
  const card = message !== null && message.tone !== 'info' ? message : null;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID={props.testID}>
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <View style={styles.tile}>
          <LockKeyhole color={colors.primary} size={30} />
        </View>
        <Text style={styles.title} accessibilityRole="header" testID="pin-title">
          {props.title}
        </Text>
        <View style={styles.subtitleRow}>
          {props.shield && <ShieldCheck color={colors.primary} size={14} />}
          <Text style={styles.subtitle}>{props.subtitle}</Text>
        </View>
      </View>

      <View style={styles.middle}>
        {card && <MessageCard message={card} />}
        <PinDots count={props.count} busy={props.busy} shakeToken={props.shakeToken} />
        {message?.tone === 'info' && (
          <Text style={styles.info} accessibilityLiveRegion="polite" testID="pin-message">
            {message.text}
          </Text>
        )}
        {props.biometricAction && (
          <Pressable
            style={({ pressed }) => [styles.biometric, pressed && styles.biometricPressed]}
            onPress={props.biometricAction.onPress}
            accessibilityRole="button"
            testID={props.biometricAction.testID}
          >
            <Fingerprint color={colors.primary} size={22} />
            <Text style={styles.biometricText}>{props.biometricAction.label}</Text>
          </Pressable>
        )}
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

function MessageCard({ message }: { message: PinMessage }) {
  const accent = message.tone === 'error' ? colors.danger : colors.tertiary;
  const dim = message.tone === 'error' ? colors.dangerDim : colors.tertiaryDim;
  return (
    <View style={styles.card} accessible accessibilityLiveRegion="assertive">
      <View style={[styles.cardIcon, { backgroundColor: dim }]}>
        <TriangleAlert color={accent} size={18} />
      </View>
      <View style={styles.cardText}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, { color: accent }]} testID="pin-message">
            {message.text}
          </Text>
          {message.badge && (
            <View style={[styles.badge, { backgroundColor: dim }]}>
              <Text style={[styles.badgeText, { color: accent }]} testID="pin-message-badge">
                {message.badge}
              </Text>
            </View>
          )}
        </View>
        {message.detail && (
          <Text style={styles.cardDetail} testID="pin-message-detail">
            {message.detail}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  top: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.sm },
  tile: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  subtitle: { ...type.caption, fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  middle: { gap: spacing.md, alignItems: 'stretch' },
  info: { ...type.caption, color: colors.textSecondary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...type.body, fontSize: 14, flexShrink: 1 },
  cardDetail: { ...type.caption, fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { ...type.caption, fontSize: 11, fontWeight: '700' },
  biometric: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  biometricPressed: { opacity: 0.8 },
  biometricText: { ...type.body, color: colors.textPrimary },
});
