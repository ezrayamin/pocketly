import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LIVE_DATASET } from '@pocketly/core-contract';
import type { NetworkMode } from '@pocketly/core-contract';
import { X } from '../../components/icons';
import { Slider } from '../../components/Slider';
import { core, deviceTimeZone } from '../../core';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { toUserError } from '../errors';

/**
 * F11 Developer Menu (when DEV_TOOLS_ENABLED, ADR-0008): drive the fake backend so
 * reviewers can see slow, failing, timing-out and offline states (FR-DEV-02…05).
 * Settings live in the core for this app session; they reset when the app restarts.
 * Scriptable equivalents: pocketly://dev/... links (devLinks.ts).
 */
const MODES: { mode: NetworkMode; label: string; hint: string }[] = [
  { mode: 'NORMAL', label: 'Normal', hint: 'No added latency' },
  { mode: 'SLOW', label: 'Slow', hint: '2–5 s per call' },
  { mode: 'ALWAYS_FAIL', label: 'Always fail', hint: 'Server error' },
  { mode: 'TIMEOUT', label: 'Timeout', hint: 'No answer, gives up after 10 s' },
  { mode: 'OFFLINE', label: 'Offline', hint: 'No connection' },
];

export function DevMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [sim, setSim] = useState(() => core.getNetworkSimulation());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (next: Partial<typeof sim>) => {
    const merged = { ...sim, ...next };
    core.setNetworkSimulation(merged);
    setSim(core.getNetworkSimulation());
  };

  const triggerIncoming = async () => {
    setBusy(true);
    try {
      const tx = await core.simulateIncomingTransfer();
      setStatus(`Received ${core.formatMoney(tx.amount)} from ${tx.counterparty?.name ?? 'a contact'}`);
    } catch (e) {
      setStatus(toUserError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () =>
    Alert.alert('Reset data?', 'The wallet goes back to its seeded state. Network settings stay as they are.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await core.resetData(LIVE_DATASET);
          setStatus('Wallet reset to seeded data');
        },
      },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Developer Menu
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" testID="devmenu-close">
            <X color={colors.textPrimary} size={22} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.section}>NETWORK (FR-DEV-02)</Text>
          <View style={styles.card} accessibilityRole="radiogroup">
            {MODES.map(({ mode, label, hint }, i) => {
              const selected = sim.mode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => apply({ mode })}
                  style={[styles.option, i > 0 && styles.optionDivider]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label}, ${hint}`}
                  testID={`devmenu-mode-${mode}`}
                >
                  <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot} />}</View>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{label}</Text>
                    <Text style={styles.optionHint}>{hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>FAILURE RATE (FR-DEV-03)</Text>
          <View style={styles.card}>
            <View style={styles.rateRow}>
              <Text style={styles.optionLabel}>Random server errors</Text>
              <Text style={styles.rateValue}>{sim.failureRatePercent}%</Text>
            </View>
            <Slider
              value={sim.failureRatePercent}
              min={0}
              max={100}
              step={5}
              onChange={(failureRatePercent) => failureRatePercent !== sim.failureRatePercent && apply({ failureRatePercent })}
              accessibilityLabel="Failure rate"
              valueText={(v) => `${v}%`}
              testID="devmenu-failure-rate"
            />
            <Text style={styles.optionHint}>Applies in Normal and Slow mode.</Text>
          </View>

          <Text style={styles.section}>LATENCY IN NORMAL MODE</Text>
          <View style={styles.card}>
            <View style={styles.rateRow}>
              <Text style={styles.optionLabel}>Every call takes</Text>
              <Text style={styles.rateValue} testID="devmenu-latency-value">
                {(sim.normalLatencyMs! / 1000).toFixed(2)} s
              </Text>
            </View>
            <Slider
              value={sim.normalLatencyMs!}
              min={0}
              max={15_000}
              step={250}
              onChange={(normalLatencyMs) => normalLatencyMs !== sim.normalLatencyMs && apply({ normalLatencyMs })}
              accessibilityLabel="Latency in normal mode"
              valueText={(v) => `${(v / 1000).toFixed(2)} seconds`}
              testID="devmenu-latency"
            />
            <Text style={styles.optionHint}>
              Calls time out after {(sim.readTimeoutMs! / 1000).toFixed(0)} s. Above that, the response arrives late and is
              ignored.
            </Text>
          </View>

          <Text style={styles.section}>DATA</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.buttonPrimary]}
              onPress={triggerIncoming}
              disabled={busy}
              accessibilityRole="button"
              testID="devmenu-incoming"
            >
              <Text style={styles.buttonPrimaryText}>Trigger incoming transfer</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={reset} accessibilityRole="button" testID="devmenu-reset">
              <Text style={styles.buttonText}>Reset data</Text>
            </Pressable>
          </View>
          {status && (
            <Text style={styles.status} accessibilityLiveRegion="polite" testID="devmenu-status">
              {status}
            </Text>
          )}

          <Text style={styles.section}>BUILD</Text>
          <View style={styles.card}>
            <Text style={styles.info}>Core: {core.impl}</Text>
            <Text style={styles.info}>Time zone: {deviceTimeZone()}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { ...type.title, color: colors.textPrimary },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  section: { ...type.overline, color: colors.textSecondary, marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionText: { flex: 1 },
  optionLabel: { ...type.body, color: colors.textPrimary },
  optionHint: { ...type.caption, color: colors.textSecondary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rateValue: { ...type.body, color: colors.primary },
  actions: { gap: spacing.sm },
  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonText: { ...type.body, color: colors.textPrimary },
  buttonPrimaryText: { ...type.body, color: colors.onPrimary },
  status: { ...type.caption, color: colors.primary, textAlign: 'center', marginTop: spacing.xs },
  info: { ...type.caption, color: colors.textSecondary },
});
