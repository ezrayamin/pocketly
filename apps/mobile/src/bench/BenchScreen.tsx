import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';
import { logResult, runBench, type BenchResult, type BenchScenario } from './harness';

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Runs one harness scenario (perf builds, `pocketly.bench=<scenario>`; see launchArgs.ts) and
 * logs the result for benchmarks/scripts/bm-harness.sh. Shows progress and a short summary.
 * Nothing else renders while it runs, so the app does no other work during the measurement.
 */
export function BenchScreen({ scenario, runs, warmup }: { scenario: BenchScenario; runs: number; warmup: number }) {
  const [progress, setProgress] = useState('starting');
  const [result, setResult] = useState<BenchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Let the first frame render before the work starts.
    const id = setTimeout(() => {
      runBench(scenario, { runs, warmup, onProgress: (done, total) => setProgress(`${done}/${total}`) }).then(
        (r) => {
          logResult(r);
          setResult(r);
        },
        (e: unknown) => {
          console.error(`[Pocketly] bench-failed ${scenario}: ${String(e)}`);
          setError(String(e));
        },
      );
    }, 500);
    return () => clearTimeout(id);
  }, [scenario, runs, warmup]);

  const summary = result
    ? Object.keys(result.runs[0] ?? {})
        .map((k) => `${k}: median ${median(result.runs.map((r) => r[k])).toFixed(2)} ms`)
        .join('\n')
    : null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>
          {scenario} · {result?.build ?? ''}
        </Text>
        {error ? (
          <Text style={styles.error} testID="bench-failed">
            {error}
          </Text>
        ) : result ? (
          <Text style={styles.text} testID="bench-done">
            {summary}
          </Text>
        ) : (
          <Text style={styles.text} testID="bench-running">
            Running {progress} (warm-up {warmup})
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.xl, gap: spacing.md },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  text: { color: colors.textSecondary, fontSize: 14, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  error: { color: colors.danger, fontSize: 14 },
});
