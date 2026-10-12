import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { core } from '../../core';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';
import { CreatePinScreen } from './CreatePinScreen';
import { UnlockScreen } from './UnlockScreen';

type Gate =
  | { kind: 'checking' }
  | { kind: 'create' }
  | { kind: 'locked'; lockedUntil?: number }
  | { kind: 'open' }
  /** ADR-0010 §2.7: secure storage can't be read right now (e.g. the phone is locked). Nothing was wiped. */
  | { kind: 'unavailable'; message: string };

export interface AuthControls {
  /** Developer menu: delete every secret and start onboarding again. */
  resetOnboarding(): Promise<void>;
}

const AuthContext = createContext<AuthControls | null>(null);

export function useAuthControls(): AuthControls {
  const controls = useContext(AuthContext);
  if (!controls) throw new Error('useAuthControls outside AuthGate');
  return controls;
}

/**
 * FR-LOCK-01: nothing financial mounts until the PIN is entered. On start the gate asks the core
 * for the auth state: no PIN → create one (FR-AUTH-03); a PIN → unlock (FR-LOCK-04). `children`
 * (the app) mount only once open. Re-locking after time in the background is slice 5 step 3.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });

  const check = useCallback(async () => {
    try {
      const state = await core.getAuthState();
      setGate(state.pinSet ? { kind: 'locked', lockedUntil: state.lockedUntil } : { kind: 'create' });
    } catch (e) {
      setGate({ kind: 'unavailable', message: toUserError(e).message });
    }
  }, []);

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

  const controls = useMemo<AuthControls>(
    () => ({
      resetOnboarding: async () => {
        await core.resetAuth();
        setGate({ kind: 'create' });
      },
    }),
    [],
  );

  const open = useCallback(() => setGate({ kind: 'open' }), []);
  const reset = useCallback(() => setGate({ kind: 'create' }), []);

  if (gate.kind === 'open') {
    return <AuthContext.Provider value={controls}>{children}</AuthContext.Provider>;
  }
  return (
    <SafeAreaProvider>
      {gate.kind === 'checking' && <View style={styles.root} testID="auth-checking" />}
      {gate.kind === 'create' && <CreatePinScreen onCreated={open} />}
      {gate.kind === 'locked' && <UnlockScreen initialLockedUntil={gate.lockedUntil} onUnlocked={open} onReset={reset} />}
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
