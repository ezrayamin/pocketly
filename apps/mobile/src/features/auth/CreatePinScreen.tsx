import React, { useCallback, useRef, useState } from 'react';
import { core } from '../../core';
import { toUserError } from '../errors';
import { PIN_MISMATCH, PIN_REJECTED } from './pinCopy';
import { PinScreen, type PinMessage } from './PinScreen';
import { usePinEntry } from './usePinEntry';

/**
 * FR-AUTH-03: choose a PIN, then enter it again. The core refuses trivial PINs (checkPin) before
 * the second entry, so the user isn't asked to repeat a PIN that can't be used. The first entry
 * is held only until the second one arrives.
 */
export function CreatePinScreen({ onCreated }: { onCreated: () => void }) {
  const [stage, setStage] = useState<'choose' | 'confirm'>('choose');
  const [message, setMessage] = useState<PinMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const first = useRef<string | null>(null);
  const clearRef = useRef<() => void>(() => {});

  const refuse = (text: string) => {
    first.current = null;
    setStage('choose');
    setMessage({ tone: 'error', text });
    setShakeToken((n) => n + 1);
    clearRef.current();
  };

  const onComplete = useCallback(async (pin: string) => {
    if (first.current === null) {
      const check = core.checkPin(pin);
      if (!check.ok) {
        refuse(PIN_REJECTED[check.reason ?? 'TOO_SIMPLE']);
        return;
      }
      first.current = pin;
      setStage('confirm');
      setMessage(null);
      clearRef.current();
      return;
    }
    if (pin !== first.current) {
      refuse(PIN_MISMATCH);
      return;
    }
    first.current = null;
    setBusy(true);
    try {
      await core.setPin(pin); // hashes: a few hundred ms (ADR-0010)
      onCreated();
    } catch (e) {
      setBusy(false);
      refuse(toUserError(e).message);
    }
  }, [onCreated]);

  const entry = usePinEntry(onComplete);
  clearRef.current = entry.clear;

  return (
    <PinScreen
      testID="create-pin"
      title={stage === 'choose' ? 'Create a PIN' : 'Confirm your PIN'}
      subtitle={
        stage === 'choose'
          ? "6 digits you'll use to unlock Pocketly and confirm payments."
          : 'Enter the same 6 digits again.'
      }
      message={busy ? { tone: 'info', text: 'Saving your PIN…' } : message}
      count={entry.count}
      busy={busy}
      shakeToken={shakeToken}
      onDigit={(d) => {
        if (message?.tone === 'error') setMessage(null);
        entry.press(d);
      }}
      onErase={entry.erase}
    />
  );
}
