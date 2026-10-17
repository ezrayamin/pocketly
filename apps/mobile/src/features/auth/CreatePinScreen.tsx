import React, { useCallback, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSecureScreen } from '@pocketly/native-secure-screen';
import { PIN_LENGTH } from '@pocketly/core-contract';
import { CircleCheck, CircleX, Grid3x3, LockKeyhole, ShieldCheck } from '../../components/icons';
import { core } from '../../core';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';
import { PinDots, PinPad } from './PinPad';
import { PIN_MISMATCH, PIN_REJECTED } from './pinCopy';
import { usePinEntry } from './usePinEntry';

type RuleState = 'pending' | 'ok' | 'failed';

/**
 * FR-AUTH-03: choose a PIN, then enter it again. The core refuses trivial PINs (checkPin) before
 * the second entry, so the user isn't asked to repeat a PIN that can't be used; the checklist
 * shows why. The first entry is held only until the second one arrives. `onCreated` gets the new
 * PIN so the gate can offer biometrics with it (and then drop it).
 */
export function CreatePinScreen({
  onCreated,
  step,
}: {
  onCreated: (pin: string) => void;
  /** "Step 1 of 2" when biometrics will be offered next. */
  step?: { index: number; total: number };
}) {
  useSecureScreen();
  const [stage, setStage] = useState<'choose' | 'confirm'>('choose');
  const [message, setMessage] = useState<string | null>(null);
  const [simple, setSimple] = useState<RuleState>('pending');
  const [busy, setBusy] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const first = useRef<string | null>(null);
  const clearRef = useRef<() => void>(() => {});

  const refuse = (text: string) => {
    first.current = null;
    setStage('choose');
    setMessage(text);
    setShakeToken((n) => n + 1);
    clearRef.current();
  };

  const onComplete = useCallback(
    async (pin: string) => {
      if (first.current === null) {
        const check = core.checkPin(pin);
        if (!check.ok) {
          setSimple(check.reason === 'TOO_SIMPLE' ? 'failed' : 'pending');
          refuse(PIN_REJECTED[check.reason ?? 'TOO_SIMPLE']);
          return;
        }
        setSimple('ok');
        first.current = pin;
        setStage('confirm');
        setMessage(null);
        clearRef.current();
        return;
      }
      if (pin !== first.current) {
        setSimple('pending');
        refuse(PIN_MISMATCH);
        return;
      }
      first.current = null;
      setBusy(true);
      try {
        await core.setPin(pin); // hashes: a few hundred ms (ADR-0010)
        onCreated(pin);
      } catch (e) {
        setBusy(false);
        setSimple('pending');
        refuse(toUserError(e).message);
      }
    },
    [onCreated],
  );

  const entry = usePinEntry(onComplete);
  clearRef.current = entry.clear;
  const sixDigits: RuleState = stage === 'confirm' || entry.count === PIN_LENGTH ? 'ok' : 'pending';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="create-pin">
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        {step && (
          <View style={styles.chip}>
            <View style={styles.chipDot} />
            <Text style={styles.chipText}>
              Step {step.index} of {step.total} · Create PIN
            </Text>
          </View>
        )}
        <Text style={styles.title} accessibilityRole="header" testID="pin-title">
          {stage === 'choose' ? 'Set up your PIN' : 'Confirm your PIN'}
        </Text>
        <Text style={styles.subtitle}>
          {stage === 'choose'
            ? "You'll use it to unlock Pocketly and to confirm transfers."
            : 'Enter the same 6 digits again.'}
        </Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.badge}>
          <ShieldCheck color={colors.primary} size={12} />
          <Text style={styles.badgeText}>PROTECTED BY THIS PHONE'S SECURE HARDWARE</Text>
        </View>
        <PinDots count={entry.count} busy={busy} shakeToken={shakeToken} />
        <Text style={[styles.message, message !== null && styles.error]} accessibilityLiveRegion="assertive" testID="pin-message">
          {busy ? 'Saving your PIN…' : message ?? ' '}
        </Text>
      </View>

      <View style={styles.rules}>
        <Rule state={sixDigits} icon={<Grid3x3 color={colors.textSecondary} size={16} />} text="Six digits" />
        <Rule
          state={simple}
          icon={<LockKeyhole color={colors.textSecondary} size={16} />}
          text="Not one digit repeated, or a run like 123456"
          testID="pin-rule-simple"
        />
        <Rule state="info" icon={<ShieldCheck color={colors.textSecondary} size={16} />} text="Saved only as a salted hash, never as your PIN" />
      </View>

      <PinPad
        disabled={busy}
        onDigit={(d) => {
          if (message !== null) setMessage(null);
          if (stage === 'choose' && simple === 'failed') setSimple('pending');
          entry.press(d);
        }}
        onErase={entry.erase}
      />
    </SafeAreaView>
  );
}

function Rule({ state, icon, text, testID }: { state: RuleState | 'info'; icon: React.ReactNode; text: string; testID?: string }) {
  return (
    <View style={styles.rule} testID={testID} accessibilityLabel={`${text}${state === 'ok' ? ', done' : state === 'failed' ? ', not met' : ''}`}>
      <View style={styles.ruleIcon}>{icon}</View>
      <Text style={styles.ruleText}>{text}</Text>
      {state === 'ok' && <CircleCheck color={colors.primary} size={18} />}
      {state === 'failed' && <CircleX color={colors.danger} size={18} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, justifyContent: 'space-between' },
  header: { paddingTop: spacing.lg, gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  chipText: { ...type.caption, color: colors.textPrimary },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
  subtitle: { ...type.caption, fontSize: 14, fontWeight: '400', color: colors.textSecondary },
  panel: { alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  badgeText: { ...type.caption, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: colors.textPrimary },
  message: { ...type.caption, color: colors.textSecondary, textAlign: 'center', minHeight: 16 },
  error: { color: colors.tertiary },
  rules: { gap: spacing.sm },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  ruleIcon: { width: 24, alignItems: 'center' },
  ruleText: { ...type.caption, fontSize: 13, color: colors.textPrimary, flex: 1 },
});
