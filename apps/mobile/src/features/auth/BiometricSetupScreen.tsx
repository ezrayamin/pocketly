import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { BiometricKind } from '@pocketly/core-contract';
import { core } from '../../core';
import { toUserError } from '../errors';
import { biometricNoun, capitalized, enablePrompt } from './biometricCopy';
import { formatCountdown, wrongPinMessage } from './pinCopy';
import { PinScreen, type PinMessage } from './PinScreen';
import { usePinEntry } from './usePinEntry';

/**
 * Profile → Security → turn biometric unlock on (FR-AUTH-04). A stack screen rather than a Modal:
 * on Android a Modal is its own window, which the PIN screens' FLAG_SECURE wouldn't cover.
 * The core checks the PIN (counted like any attempt), then asks for one scan.
 */
export function BiometricSetupScreen() {
  const navigation = useNavigation();
  const [kind, setKind] = useState<BiometricKind | undefined>();
  const [message, setMessage] = useState<PinMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const clearRef = useRef<() => void>(() => {});

  useEffect(() => {
    core.getBiometricStatus().then((s) => setKind(s.kind), () => {});
  }, []);

  const onComplete = useCallback(
    async (pin: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await core.enableBiometrics(pin, enablePrompt(kind));
        switch (result.outcome) {
          case 'ENABLED':
            navigation.goBack();
            return;
          case 'WRONG_PIN':
            setShakeToken((n) => n + 1);
            setMessage({ tone: 'error', text: wrongPinMessage(result.attemptsLeft ?? 0) });
            break;
          case 'PIN_LOCKED_OUT':
            setMessage({
              tone: 'error',
              text: `Too many wrong PINs. Try again in ${formatCountdown((result.lockedUntil ?? Date.now()) - Date.now())}.`,
            });
            break;
          case 'CANCELLED':
            setMessage({ tone: 'info', text: 'Enter your PIN to try again.' });
            break;
          default:
            setMessage({ tone: 'error', text: `${capitalized(biometricNoun(kind))} unlock couldn't be turned on right now.` });
        }
      } catch (e) {
        setMessage({ tone: 'error', text: toUserError(e).message });
      }
      setBusy(false);
      clearRef.current();
    },
    [kind, navigation],
  );

  const entry = usePinEntry(onComplete);
  clearRef.current = entry.clear;

  return (
    <PinScreen
      testID="biometric-setup"
      title="Enter your PIN"
      subtitle={`To turn on ${biometricNoun(kind)} unlock.`}
      message={busy ? { tone: 'info', text: 'Checking…' } : message}
      count={entry.count}
      busy={busy}
      shakeToken={shakeToken}
      onDigit={(d) => {
        if (message?.tone === 'error') setMessage(null);
        entry.press(d);
      }}
      onErase={entry.erase}
      action={{ label: 'Cancel', onPress: () => navigation.goBack(), testID: 'biometric-setup-cancel' }}
    />
  );
}
