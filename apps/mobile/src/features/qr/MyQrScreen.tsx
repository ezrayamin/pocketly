import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMaxBrightness } from '@pocketly/native-screen-brightness';
import { QrCodeView } from '../../components/QrCodeView';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { colors, radius, spacing } from '../../theme/tokens';
import { toUserError } from '../errors';
import { PrimaryButton, SendHeader, TextButton, sendStyles } from '../send/components';

type Props = NativeStackScreenProps<RootStackParamList, 'MyQr'>;

/**
 * F8, My QR (FR-QR-05; ADR-0016 §6): this account's code, which carries only its user id. Another
 * Pocketly user scans it to send money. The screen is at full brightness while shown.
 */
export function MyQrScreen({ navigation }: Props) {
  useMaxBrightness();
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    core.getMyQr().then(setPayload, (e: unknown) => setError(toUserError(e).message));
  }, []);
  useEffect(load, [load]);

  return (
    <SafeAreaView style={sendStyles.root} edges={['top', 'bottom']} testID="my-qr">
      <StatusBar barStyle="light-content" />
      <SendHeader onBack={() => navigation.goBack()} backLabel="Close" title="My QR" />
      <View style={styles.body}>
        {payload ? (
          <>
            <View style={styles.card} accessible accessibilityLabel="Your Pocketly code" accessibilityRole="image">
              <QrCodeView value={payload} size={240} testID="my-qr-code" />
            </View>
            <Text style={styles.title}>Scan to pay me</Text>
            <Text style={styles.hint}>Anyone with Pocketly can scan this to send you money.</Text>
          </>
        ) : error ? (
          <Text style={styles.error} accessibilityRole="alert" testID="my-qr-error">
            {error}
          </Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
      <View style={sendStyles.footer}>
        {error && <PrimaryButton label="Try again" onPress={load} testID="my-qr-retry" />}
        <TextButton label="Done" onPress={() => navigation.goBack()} testID="my-qr-done" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xxl },
  card: { padding: spacing.lg, borderRadius: radius.xl, backgroundColor: '#FFFFFF' },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: spacing.lg },
  hint: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
});
