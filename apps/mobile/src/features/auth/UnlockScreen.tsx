import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { toCoreError } from '@pocketly/core-contract';
import type { BiometricKind } from '@pocketly/core-contract';
import { core } from '../../core';
import { toUserError } from '../errors';
import { biometricNoun, biometricUnlockMessage, unlockPrompt } from './biometricCopy';
import { lockoutNotice, wrongPinNotice } from './pinCopy';
import { PinScreen, type PinMessage } from './PinScreen';
import { useCountdown } from './useCountdown';
import { usePinEntry } from './usePinEntry';

export interface Unlocked {
  /** Biometric unlock during a PIN lockout: tell the user someone entered wrong PINs. */
  pinLockedOut?: boolean;
  /** Unlocked with the PIN after biometrics were invalidated: offer to turn them on again with it. */
  offerBiometricsWithPin?: string;
}

/**
 * FR-LOCK-01/04, FR-AUTH-04: unlock with biometrics (asked for as soon as the screen appears, if
 * turned on) or the PIN. Shows attempts left after a wrong PIN and a live countdown during a
 * lockout (the keypad is off meanwhile; biometrics still work, ADR-0012). The lockout lives in
 * the core's secure storage, so restarting the app doesn't end it. "Forgot PIN" deletes every
 * secret and starts onboarding again.
 */
export function UnlockScreen({
  initialLockedUntil,
  biometric,
  onUnlocked,
  onReset,
}: {
  initialLockedUntil?: number;
  /** Set when biometric unlock is on and the sensor is usable. */
  biometric?: { kind?: BiometricKind };
  onUnlocked: (how: Unlocked) => void;
  /** The PIN is gone (Forgot PIN, or the core no longer has one): set up again. */
  onReset: () => void;
}) {
  const [lockedUntil, setLockedUntil] = useState(initialLockedUntil);
  const [message, setMessage] = useState<PinMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const remaining = useCountdown(lockedUntil);
  const locked = lockedUntil !== undefined && remaining > 0;
  const clearRef = useRef<() => void>(() => {});
  const [biometricOn, setBiometricOn] = useState(biometric !== undefined);
  const [scanning, setScanning] = useState(false);
  const invalidated = useRef(false);

  const scanBiometrics = useCallback(async () => {
    setScanning(true);
    setMessage(null);
    try {
      const result = await core.unlockWithBiometrics(unlockPrompt(biometric?.kind));
      if (result.outcome === 'UNLOCKED') {
        onUnlocked({ pinLockedOut: result.pinLockedOut });
        return;
      }
      if (result.outcome === 'KEY_INVALIDATED' || result.outcome === 'FAILED') {
        // Turned off in the core. Only an invalidation is offered again after the PIN.
        invalidated.current = result.outcome === 'KEY_INVALIDATED';
        if (result.outcome === 'KEY_INVALIDATED' || !(await core.getBiometricStatus()).enabled) setBiometricOn(false);
      }
      const text = biometricUnlockMessage(result.outcome, biometric?.kind);
      setMessage(text === null ? null : { tone: 'warning', text });
    } catch (e) {
      setMessage({ tone: 'warning', text: toUserError(e).message });
    }
    setScanning(false);
  }, [biometric?.kind, onUnlocked]);

  // Ask for biometrics as soon as the lock screen appears (cold start and re-lock).
  useEffect(() => {
    if (biometric !== undefined) scanBiometrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per lock screen
  }, []);

  // The lockout is over: back to a fresh set of attempts.
  useEffect(() => {
    if (lockedUntil !== undefined && remaining === 0) {
      setLockedUntil(undefined);
      setMessage(null);
      clearRef.current();
    }
  }, [lockedUntil, remaining]);

  const onComplete = useCallback(
    async (pin: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await core.verifyPin(pin); // hashes: a few hundred ms (ADR-0010)
        if (result.outcome === 'UNLOCKED') {
          onUnlocked(invalidated.current ? { offerBiometricsWithPin: pin } : {});
          return;
        }
        setShakeToken((n) => n + 1);
        if (result.outcome === 'LOCKED_OUT') {
          setLockedUntil(result.lockedUntil);
        } else {
          setMessage({ tone: 'warning', ...wrongPinNotice(result.attemptsLeft) });
        }
      } catch (e) {
        if (toCoreError(e).code === 'NOT_FOUND') {
          onReset();
          return;
        }
        setMessage({ tone: 'warning', text: toUserError(e).message });
      }
      setBusy(false);
      clearRef.current();
    },
    [onUnlocked, onReset],
  );

  const entry = usePinEntry(onComplete);
  clearRef.current = entry.clear;

  const forgot = () =>
    Alert.alert(
      'Forgot your PIN?',
      "Pocketly will forget this phone's PIN and you'll set Pocketly up again.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset PIN',
          style: 'destructive',
          onPress: async () => {
            try {
              await core.resetAuth();
              onReset();
            } catch (e) {
              setMessage({ tone: 'warning', text: toUserError(e).message });
            }
          },
        },
      ],
    );

  return (
    <PinScreen
      testID="unlock"
      title="Enter your PIN"
      subtitle="Pocketly is locked for your security"
      shield
      message={
        locked
          ? { tone: 'error', ...lockoutNotice(remaining) }
          : busy
            ? { tone: 'info', text: 'Checking…' }
            : message
      }
      count={locked ? 0 : entry.count}
      busy={busy}
      locked={locked || scanning}
      biometricAction={
        biometricOn && !busy && !scanning
          ? { label: `Unlock with ${biometricNoun(biometric?.kind)}`, onPress: scanBiometrics, testID: 'pin-use-biometrics' }
          : undefined
      }
      shakeToken={shakeToken}
      onDigit={(d) => {
        if (message && message.tone !== 'info') setMessage(null);
        entry.press(d);
      }}
      onErase={entry.erase}
      action={{ label: 'Forgot PIN?', onPress: forgot, testID: 'pin-forgot' }}
    />
  );
}
