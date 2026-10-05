import { CoreError, LIVE_DATASET } from '@pocketly/core-contract';
import type { DatasetConfig } from '@pocketly/core-contract';
import { BENCH_SCENARIOS, type BenchScenario } from './bench/harness';
import type { TabKey } from './components/TabBar';
import { core } from './core';
import { applyNetworkParams } from './features/devmenu/devLinks';

/**
 * Benchmark launch arguments (docs/benchmarking.md §5.3). Perf builds pass the
 * `pocketly.*` intent extras, prefix removed, as the root `launchArgs` prop (LaunchArgs.kt);
 * other builds pass nothing. All values arrive as strings.
 *
 *   tab                    home | history | profile          start tab
 *   seed, transactionCount, nowMillis                         resetData() with this dataset
 *                                                            (unset fields: LIVE_DATASET's)
 *   network.mode, network.failureRatePercent, network.normalLatencyMs,
 *   network.readTimeoutMs, network.seed                      fake backend, as the dev link
 *   bench                  BM-03 | BM-04 | BM-06              run the in-app harness instead
 *   benchRuns, benchWarmup integers (default 10, 5)           of the app (bench/harness.ts)
 *
 * Everything is applied before the first screen loads, so a cold start measures the
 * requested setup. Unknown keys are rejected: a typo must not silently benchmark defaults.
 */
export interface LaunchArgs {
  tab?: TabKey;
  bench?: { scenario: BenchScenario; runs: number; warmup: number };
  dataset?: DatasetConfig;
  network?: Record<string, string>;
}

const TABS: readonly TabKey[] = ['home', 'history', 'profile'];
const DATASET_KEYS = ['seed', 'transactionCount', 'nowMillis'] as const;
const NETWORK_PREFIX = 'network.';

function integer(key: string, value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isSafeInteger(n)) {
    throw new CoreError('INVALID_ARGUMENT', `launch argument ${key}="${value}" is not an integer`);
  }
  return n;
}

/** Throws CoreError(INVALID_ARGUMENT) on an unknown key or a bad value. */
export function parseLaunchArgs(raw: Readonly<Record<string, string>> | undefined): LaunchArgs {
  const args: LaunchArgs = {};
  if (!raw) return args;
  const dataset: Partial<DatasetConfig> = {};
  let benchRuns = 10;
  let benchWarmup = 5;
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'bench') {
      if (!(BENCH_SCENARIOS as readonly string[]).includes(value)) {
        throw new CoreError('INVALID_ARGUMENT', `launch argument bench="${value}" must be one of ${BENCH_SCENARIOS.join(', ')}`);
      }
      args.bench = { scenario: value as BenchScenario, runs: 0, warmup: 0 };
    } else if (key === 'benchRuns') {
      benchRuns = integer(key, value);
    } else if (key === 'benchWarmup') {
      benchWarmup = integer(key, value);
    } else if (key === 'tab') {
      if (!(TABS as readonly string[]).includes(value)) {
        throw new CoreError('INVALID_ARGUMENT', `launch argument tab="${value}" must be one of ${TABS.join(', ')}`);
      }
      args.tab = value as TabKey;
    } else if ((DATASET_KEYS as readonly string[]).includes(key)) {
      dataset[key as (typeof DATASET_KEYS)[number]] = integer(key, value);
    } else if (key.startsWith(NETWORK_PREFIX)) {
      args.network = { ...args.network, [key.slice(NETWORK_PREFIX.length)]: value };
    } else {
      throw new CoreError('INVALID_ARGUMENT', `unknown launch argument "${key}"`);
    }
  }
  if (args.bench) {
    if (benchRuns < 1 || benchWarmup < 0) {
      throw new CoreError('INVALID_ARGUMENT', 'launch arguments benchRuns must be ≥ 1 and benchWarmup ≥ 0');
    }
    args.bench = { ...args.bench, runs: benchRuns, warmup: benchWarmup };
  }
  if (Object.keys(dataset).length > 0) {
    args.dataset = {
      seed: dataset.seed ?? LIVE_DATASET.seed,
      transactionCount: dataset.transactionCount ?? LIVE_DATASET.transactionCount,
      nowMillis: dataset.nowMillis,
    };
  }
  return args;
}

/** True when the core must be set up before anything loads. */
export function needsSetup(args: LaunchArgs): boolean {
  return args.dataset !== undefined || args.network !== undefined;
}

/** Dataset, then network: the reset itself mustn't be slowed or failed by the run's simulation. */
export async function applyLaunchArgs(args: LaunchArgs): Promise<void> {
  if (args.dataset) await core.resetData(args.dataset);
  if (args.network) applyNetworkParams(args.network);
}
