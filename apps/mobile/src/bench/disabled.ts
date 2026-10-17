import type { ComponentType } from 'react';
import type { BenchScenario } from './harness';

/**
 * `@pocketly/bench-app` outside perf bundles (release, debug, the Metro dev server): no
 * scenarios, no screen. Type-only imports keep the harness itself out of the bundle.
 */
export const BENCH_SCENARIOS: readonly BenchScenario[] = [];
export const BenchScreen: ComponentType<{ scenario: BenchScenario; runs: number; warmup: number; memory: boolean }> | null = null;
