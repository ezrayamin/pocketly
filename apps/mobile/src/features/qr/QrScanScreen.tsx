import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { toCoreError } from '@pocketly/core-contract';
import { CircleAlert, ScanLine } from '../../components/icons';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, spacing } from '../../theme/tokens';
import { PrimaryButton, SendHeader, TextButton, sendStyles } from '../send/components';
import { scanProblem } from './qrCopy';
import { scanQr } from './scanQr';

type Props = NativeStackScreenProps<RootStackParamList, 'QrScan'>;

type Phase =
  | { kind: 'SCANNING' }
  | { kind: 'RESOLVING' }
  /** `settings`: the fix is camera access in Settings (FR-QR-01). */
  | { kind: 'PROBLEM'; message: string; settings?: boolean; scanAgain: boolean };

/**
 * Pay (F7, FR-QR-01..03; ADR-0016 §7, §8): opens the platform's scanner at once, then sends the
 * code to the core (parseQr: IDs only). A merchant code asks the server who it is and, for a
 * dynamic code, how much (startQrPayment); a Pocketly user's code (My QR) starts the Send flow.
 * Anything wrong stays on this screen with "Scan again". Dev builds can hand a code in by link.
 */
export function QrScanScreen({ navigation, route }: Props) {
  const handedIn = route.params?.code;
  const [phase, setPhase] = useState<Phase>({ kind: handedIn !== undefined ? 'RESOLVING' : 'SCANNING' });
  const started = useRef(false);

  const handle = useCallback(
    async (text: string) => {
      const code = core.parseQr(text);
      if (!code.ok) {
        setPhase({ kind: 'PROBLEM', message: scanProblem('INVALID_QR'), scanAgain: true });
        return;
      }
      setPhase({ kind: 'RESOLVING' });
      try {
        if (code.kind === 'USER') {
          const draft = await core.startTransfer(code.userId!);
          navigation.replace('SendAmount', { draft });
          return;
        }
        const draft = await core.startQrPayment(code.merchantId!, code.requestId);
        if (draft.amount === undefined) {
          navigation.replace('QrAmount', { draft });
          return;
        }
        // A dynamic code's amount is locked (FR-QR-03): straight to review.
        navigation.replace('QrReview', { review: await core.reviewQrPayment(draft.amount) });
      } catch (e) {
        setPhase({ kind: 'PROBLEM', message: scanProblem(toCoreError(e).code), scanAgain: true });
      }
    },
    [navigation],
  );

  const scan = useCallback(async () => {
    setPhase({ kind: 'SCANNING' });
    const outcome = await scanQr();
    switch (outcome.kind) {
      case 'SCANNED':
        return handle(outcome.value);
      case 'CANCELLED':
        return navigation.goBack();
      case 'NO_CAMERA_ACCESS':
        return setPhase({
          kind: 'PROBLEM',
          message: 'Pocketly needs the camera to scan payment codes. You can allow it in Settings.',
          settings: true,
          scanAgain: true,
        });
      case 'UNSUPPORTED':
        return setPhase({ kind: 'PROBLEM', message: outcome.message, scanAgain: false });
      default:
        return setPhase({ kind: 'PROBLEM', message: "Couldn't open the scanner. Please try again.", scanAgain: true });
    }
  }, [handle, navigation]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (handedIn !== undefined) handle(handedIn);
    else scan();
  }, [handedIn, handle, scan]);

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="qr-scan">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Close" title="Pay" />
      <View style={styles.body}>
        {phase.kind === 'PROBLEM' ? (
          <View style={styles.center} accessibilityRole="alert" testID="qr-scan-problem">
            <CircleAlert color={colors.danger} size={40} />
            <Text style={styles.message} testID="qr-scan-message">
              {phase.message}
            </Text>
          </View>
        ) : (
          <View style={styles.center} accessibilityLiveRegion="polite">
            {phase.kind === 'SCANNING' ? (
              <ScanLine color={colors.textSecondary} size={40} />
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
            <Text style={styles.hint}>
              {phase.kind === 'SCANNING' ? 'Point the camera at a payment code' : 'Checking the code…'}
            </Text>
          </View>
        )}
      </View>
      {phase.kind === 'PROBLEM' && (
        <View style={sendStyles.footer}>
          {phase.settings && (
            <PrimaryButton label="Open Settings" onPress={() => Linking.openSettings()} testID="qr-scan-settings" />
          )}
          {phase.scanAgain && !phase.settings && (
            <PrimaryButton label="Scan again" onPress={scan} testID="qr-scan-again" />
          )}
          {phase.scanAgain && phase.settings && (
            <TextButton label="Scan again" onPress={scan} testID="qr-scan-again" accent />
          )}
          <TextButton label="Close" onPress={() => navigation.goBack()} testID="qr-scan-close" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl },
  center: { alignItems: 'center', gap: spacing.lg },
  hint: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  message: { color: colors.textPrimary, fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
