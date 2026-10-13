import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_AUTO_LOCK_MS } from '@pocketly/core-contract';
import type { BiometricKind } from '@pocketly/core-contract';
import { LockKeyhole } from '../../components/icons';
import { core } from '../../core';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';
import { awayMs, leftNow, shouldRelock, type LeftAt } from './appLock';
import { BiometricOfferScreen } from './BiometricOfferScreen';
import { WRONG_PINS_NOTICE } from './biometricCopy';
import { CreatePinScreen } from './CreatePinScreen';
import { UnlockScreen, type Unlocked } from './UnlockScreen';

type Gate =
  | { kind: 'checking' }
  | { kind: 'create' }
  | { kind: 'locked'; lockedUntil?: number; biometric?: { kind?: BiometricKind } }
  /** FR-AUTH-04: "Unlock with your fingerprint?" (after PIN setup, or after an invalidated key). */
  | { kind: 'offer'; again: boolean; biometricKind?: BiometricKind }
  | { kind: 'open' }
  /** ADR-0010 §2.7: secure storage can't be read right now (e.g. the phone is locked). Nothing was wiped. */
  | { kind: 'unavailable'; message: string };

export interface AuthControls {
  /** True while the lock screen or the privacy cover is over the app. */
  locked: boolean;
  /** Developer menu: delete every secret and start onboarding again. */
  resetOnboarding(): Promise<void>;
  autoLockMs: number;
  /** Developer menu (FR-LOCK-02 "configurable"): saved in the core, used from the next background. */
  setAutoLockTimeout(ms: number): Promise<void>;
}

const AuthContext = createContext<AuthControls | null>(null);

export function useAuthControls(): AuthControls {
  const controls = useContext(AuthContext);
  if (!controls) throw new Error('useAuthControls outside AuthGate');
  return controls;
}

/** False outside the gate (benchmarks launched with skipLock). */
export function useAppLocked(): boolean {
  return useContext(AuthContext)?.locked ?? false;
}

/**
 * FR-LOCK-01..03.
 * - Start: the core's auth state decides: no PIN → create one (FR-AUTH-03), a PIN → unlock
 *   (FR-LOCK-04). The app (`children`) mounts only after the first unlock.
 * - Leaving the foreground: an opaque cover goes over the app at once (FR-LOCK-03), so nothing
 *   flashes when it comes back. The app-switcher snapshot itself is hidden natively
 *   (MainActivity on Android, AppDelegate on iOS), because the snapshot is taken before JS can
 *   draw.
 * - Coming back after the auto-lock timeout or longer (FR-LOCK-02): the unlock screen goes over
 *   the still-mounted app, so screens and scroll positions survive the unlock.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });
  const [appMounted, setAppMounted] = useState(false);
  const [covered, setCovered] = useState(false);
  const [autoLockMs, setAutoLockMs] = useState(DEFAULT_AUTO_LOCK_MS);
  const autoLockRef = useRef(DEFAULT_AUTO_LOCK_MS);
  const leftAt = useRef<LeftAt | null>(null);
  /** Biometric unlock usable at the last unlock: a re-lock prompts for it at once. */
  const biometricRef = useRef<{ kind?: BiometricKind } | undefined>(undefined);
  /** The PIN just entered, held only while the biometric offer is on screen. */
  const offerPin = useRef<string | null>(null);

  const usableBiometric = useCallback(async () => {
    try {
      const s = await core.getBiometricStatus();
      biometricRef.current = s.enabled && s.available ? { kind: s.kind } : undefined;
      return s;
    } catch {
      biometricRef.current = undefined;
      return undefined;
    }
  }, []);

  const check = useCallback(async () => {
    try {
      const state = await core.getAuthState();
      if (!state.pinSet) {
        setGate({ kind: 'create' });
        return;
      }
      await usableBiometric();
      setGate({ kind: 'locked', lockedUntil: state.lockedUntil, biometric: biometricRef.current });
    } catch (e) {
      setGate({ kind: 'unavailable', message: toUserError(e).message });
    }
  }, [usableBiometric]);

  useEffect(() => {
    check();
  }, [check]);

  // Unavailable usually means the phone was locked when the app started: retry once it's back.
  useEffect(() => {
    if (gate.kind !== 'unavailable') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => sub.remove();
  }, [gate.kind, check]);

  const rememberTimeout = useCallback((ms: number) => {
    autoLockRef.current = ms;
    setAutoLockMs(ms);
  }, []);

  const open = useCallback(() => {
    setGate({ kind: 'open' });
    setAppMounted(true);
    // Read on every unlock, so the decision when coming back needs no async call. If it can't
    // be read, lock every time (fail closed).
    core.getAutoLockTimeout().then(rememberTimeout, () => rememberTimeout(0));
    usableBiometric();
  }, [rememberTimeout, usableBiometric]);

  /** Offer biometrics with the PIN just entered, if the sensor can be used and they're off. */
  const offerOrOpen = useCallback(
    async (pin: string, again: boolean) => {
      const s = await usableBiometric();
      if (s?.available && !s.enabled) {
        offerPin.current = pin;
        setGate({ kind: 'offer', again, biometricKind: s.kind });
      } else {
        open();
      }
    },
    [open, usableBiometric],
  );

  const created = useCallback((pin: string) => offerOrOpen(pin, false), [offerOrOpen]);

  const unlocked = useCallback(
    (how: Unlocked) => {
      if (how.offerBiometricsWithPin !== undefined) {
        offerOrOpen(how.offerBiometricsWithPin, true);
        return;
      }
      open();
      if (how.pinLockedOut) Alert.alert('Wrong PIN attempts', WRONG_PINS_NOTICE);
    },
    [offerOrOpen, open],
  );

  const offerDone = useCallback(() => {
    offerPin.current = null;
    open();
  }, [open]);

  const reset = useCallback(() => {
    setAppMounted(false);
    setGate({ kind: 'create' });
  }, []);

  // FR-LOCK-02/03 while the app is open.
  useEffect(() => {
    if (gate.kind !== 'open') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setCovered(true);
        if (next === 'background' && leftAt.current === null) leftAt.current = leftNow();
        return;
      }
      const since = leftAt.current;
      leftAt.current = null;
      // Both updates land in the same render: the cover is never lifted off an app that's
      // about to lock.
      if (since !== null && shouldRelock(awayMs(since), autoLockRef.current)) {
        setGate({ kind: 'locked', biometric: biometricRef.current });
      }
      setCovered(false);
    });
    return () => sub.remove();
  }, [gate.kind]);

  const controls = useMemo<AuthControls>(
    () => ({
      locked: gate.kind !== 'open' || covered,
      autoLockMs,
      resetOnboarding: async () => {
        await core.resetAuth();
        reset();
      },
      setAutoLockTimeout: async (ms) => {
        await core.setAutoLockTimeout(ms);
        rememberTimeout(ms);
      },
    }),
    [gate.kind, covered, autoLockMs, reset, rememberTimeout],
  );

  const interactive = gate.kind === 'open' && !covered;

  return (
    <AuthContext.Provider value={controls}>
      <View style={styles.root}>
        {appMounted && (
          <View
            style={styles.root}
            pointerEvents={interactive ? 'auto' : 'none'}
            accessibilityElementsHidden={!interactive}
            importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
          >
            {children}
          </View>
        )}
        {gate.kind !== 'open' && (
          <View style={StyleSheet.absoluteFill}>
            <SafeAreaProvider>
              {gate.kind === 'checking' && <View style={styles.root} testID="auth-checking" />}
              {gate.kind === 'create' && <CreatePinScreen onCreated={created} />}
              {gate.kind === 'locked' && (
                <UnlockScreen
                  initialLockedUntil={gate.lockedUntil}
                  biometric={gate.biometric}
                  onUnlocked={unlocked}
                  onReset={reset}
                />
              )}
              {gate.kind === 'offer' && offerPin.current !== null && (
                <BiometricOfferScreen
                  kind={gate.biometricKind}
                  pin={offerPin.current}
                  again={gate.again}
                  onDone={offerDone}
                />
              )}
              {gate.kind === 'unavailable' && (
                <SafeAreaView style={[styles.root, styles.center]} testID="auth-unavailable">
                  <StatusBar barStyle="light-content" />
                  <Text style={styles.title} accessibilityRole="header">
                    Pocketly is locked
                  </Text>
                  <Text style={styles.body}>{gate.message}</Text>
                  <Pressable style={styles.button} onPress={check} accessibilityRole="button" testID="auth-retry">
                    <Text style={styles.buttonText}>Try again</Text>
                  </Pressable>
                </SafeAreaView>
              )}
            </SafeAreaProvider>
          </View>
        )}
        {gate.kind === 'open' && covered && (
          <View style={[StyleSheet.absoluteFill, styles.root, styles.center]} testID="privacy-cover">
            <LockKeyhole color={colors.primary} size={40} />
          </View>
        )}
      </View>
    </AuthContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  title: { ...type.title, color: colors.textPrimary },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  button: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.primary,
  },
  buttonText: { ...type.body, color: colors.onPrimary },
});
