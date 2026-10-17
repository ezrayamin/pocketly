/**
 * The benchmark harness (perf bundles): Metro resolves `@pocketly/bench-app` here only when
 * bundling a perf build, and to ./disabled.ts otherwise, so release bundles contain no harness
 * and no benchmark-only core code (CI checks it).
 */
export { BENCH_SCENARIOS } from './harness';
export { BenchScreen } from './BenchScreen';
