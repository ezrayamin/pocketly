import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { flowMark } from '@pocketly/bench-app';
import type { BiometricStatus } from '@pocketly/core-contract';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { biometricNoun } from '../auth/biometricCopy';
import { lockoutNotice, wrongPinNotice } from '../auth/pinCopy';
import { PinScreen, type PinMessage } from '../auth/PinScreen';
import { usePinEntry } from '../auth/usePinEntry';
import { toUserError } from '../errors';
import { ProcessingView } from './components';
import { biometricFallbackNotice, transferPrompt } from './sendCopy';
import { useConfirmTransfer } from './useConfirmTransfer';

type Props = NativeStackScreenProps<RootStackParamList, 'SendPin'>;

/**
 * Send, PIN fallback (FR-TRF-04): the PIN approves this transfer, checked and counted like the
 * lock screen's (FR-LOCK-04). Cancel goes back to review with nothing sent. If biometrics are
 * still on, "Use fingerprint" tries the prompt again. Blocks screenshots (PinScreen).
 */
export function SendPinScreen({ navigation, route }: Props) {
  const { review, notice } = route.params;
  const amount = core.formatMoney(review.amount);
  const [biometrics, setBiometrics] = useState<BiometricStatus | null>(null);
  const [message, setMessage] = useState<PinMessage | null>(notice ? { tone: 'warning', text: notice } : null);
  const [locked, setLocked] = useState(false);
  const [shakeToken, setShakeToken] = useState(0);
  const { sending, confirm } = useConfirmTransfer(review, navigation);
  const clearRef = useRef<() => void>(() => {});

  useEffect(() => flowMark('pin-shown'), []); // BM-07

  useEffect(() => {
    core.getBiometricStatus().then(setBiometrics, () => setBiometrics(null));
  }, []);

  const onComplete = useCallback(
    async (pin: string) => {
      flowMark('pin-complete');
      setMessage(null);
      try {
        const result = await confirm({ method: 'PIN', pin });
        if (result?.state !== 'DRAFT') return;
        if (result.auth === 'WRONG_PIN') {
          setShakeToken((n) => n + 1);
          setMessage({ tone: 'warning', ...wrongPinNotice(result.attemptsLeft ?? 0) });
        } else if (result.auth === 'PIN_LOCKED_OUT') {
          setLocked(true);
          setMessage({ tone: 'error', ...lockoutNotice((result.lockedUntil ?? Date.now()) - Date.now()) });
        }
      } catch (e) {
        setMessage({ tone: 'warning', text: toUserError(e).message });
      }
      clearRef.current();
    },
    [confirm],
  );

  const entry = usePinEntry(onComplete);
  clearRef.current = entry.clear;

  const useBiometrics = async () => {
    if (!biometrics) return;
    setMessage(null);
    try {
      const result = await confirm({
        method: 'BIOMETRIC',
        prompt: transferPrompt(biometrics.kind, amount, review.recipient.name),
      });
      if (result?.state === 'DRAFT') {
        const text = biometricFallbackNotice(result.auth, biometrics.kind);
        if (text) setMessage({ tone: 'warning', text });
        if (result.auth === 'KEY_INVALIDATED' || result.auth === 'FAILED')
          setBiometrics({ ...biometrics, enabled: false });
      }
    } catch (e) {
      setMessage({ tone: 'warning', text: toUserError(e).message });
    }
  };

  return (
    <View style={styles.root}>
      <PinScreen
        testID="send-pin"
        title="Enter your PIN"
        subtitle={`To send ${amount} to ${review.recipient.name}.`}
        message={message}
        count={entry.count}
        busy={sending}
        locked={locked}
        shakeToken={shakeToken}
        onDigit={(d) => {
          if (message && message.tone !== 'error') setMessage(null);
          entry.press(d);
        }}
        onErase={entry.erase}
        action={{ label: 'Cancel', onPress: () => navigation.goBack(), testID: 'send-pin-cancel' }}
        biometricAction={
          biometrics?.enabled && biometrics.available
            ? { label: `Use ${biometricNoun(biometrics.kind)}`, onPress: useBiometrics, testID: 'send-pin-biometric' }
            : undefined
        }
      />
      {sending && <ProcessingView amount={amount} recipient={review.recipient.name} />}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
