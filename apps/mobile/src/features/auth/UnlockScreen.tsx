import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { toCoreError } from '@pocketly/core-contract';
import { core } from '../../core';
import { toUserError } from '../errors';
import { formatCountdown, wrongPinMessage } from './pinCopy';
import { PinScreen, type PinMessage } from './PinScreen';
import { useCountdown } from './useCountdown';
import { usePinEntry } from './usePinEntry';

/**
 * FR-LOCK-01/04: unlock with the PIN. Shows attempts left after a wrong PIN and a live countdown
 * during a lockout (the keypad is off meanwhile). The lockout itself lives in the core's secure
 * storage, so restarting the app doesn't end it. "Forgot PIN" deletes every secret and starts
 * onboarding again.
 */
export function UnlockScreen({
  initialLockedUntil,
  onUnlocked,
  onReset,
}: {
  initialLockedUntil?: number;
  onUnlocked: () => void;
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
          onUnlocked();
          return;
        }
        setShakeToken((n) => n + 1);
        if (result.outcome === 'LOCKED_OUT') {
          setLockedUntil(result.lockedUntil);
        } else {
          setMessage({ tone: 'error', text: wrongPinMessage(result.attemptsLeft) });
        }
      } catch (e) {
        if (toCoreError(e).code === 'NOT_FOUND') {
          onReset();
          return;
        }
        setMessage({ tone: 'error', text: toUserError(e).message });
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
              setMessage({ tone: 'error', text: toUserError(e).message });
            }
          },
        },
      ],
    );

  return (
    <PinScreen
      testID="unlock"
      title="Enter your PIN"
      subtitle="Unlock Pocketly to see your wallet."
      message={
        locked
          ? { tone: 'error', text: `Too many wrong PINs. Try again in ${formatCountdown(remaining)}.` }
          : busy
            ? { tone: 'info', text: 'Checking…' }
            : message
      }
      count={locked ? 0 : entry.count}
      busy={busy}
      locked={locked}
      shakeToken={shakeToken}
      onDigit={(d) => {
        if (message?.tone === 'error') setMessage(null);
        entry.press(d);
      }}
      onErase={entry.erase}
      action={{ label: 'Forgot PIN?', onPress: forgot, testID: 'pin-forgot' }}
    />
  );
}
