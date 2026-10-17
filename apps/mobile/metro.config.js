const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const monorepoRoot = path.resolve(__dirname, '../..');

/**
 * The core is chosen at BUNDLE time (benchmarking.md §3.2). `@pocketly/core-impl` is a
 * virtual module that resolves to exactly one implementation, so the other core never
 * enters the bundle and BM-08 bundle sizes stay honest.
 *
 * Which core a DEV server serves is decided by its port, because `react-native run-android`
 * either reuses a running Metro or launches one in a new terminal that does not inherit
 * env vars (only `--port`). Each flavor's debug build points at its own port
 * (android/app/build.gradle), so the two can never be crossed:
 *
 *   port 8081 → core-js    (yarn start      / yarn android:js)
 *   port 8082 → core-kmp   (yarn start:kmp  / yarn android:kmp)
 *   metro.kmp.config.js    → used by Gradle for kmpCore release bundles
 *
 * CORE_IMPL=js|kmp still overrides, for one-off experiments.
 */
const KMP_DEV_PORT = 8082;

function devServerPort() {
  const argv = process.argv;
  const i = argv.indexOf('--port');
  const raw = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith('--port='))?.slice('--port='.length);
  return raw === undefined ? undefined : Number(raw);
}
/**
 * Benchmark-only code (the harness, BenchCore, @noble/hashes, the KMP bench object) is in perf
 * bundles only. Two virtual modules decide it at bundle time, like `@pocketly/core-impl`:
 *
 *   @pocketly/bench-app   → src/bench/index.ts (perf) | src/bench/disabled.ts (everything else)
 *   @pocketly/bench-impl  → @pocketly/core-js-bench | @pocketly/core-kmp-bench (perf only)
 *
 * Gradle passes metro.bench.config.js / metro.kmp.bench.config.js for perf bundles
 * (android/app/build.gradle). Release, debug and the dev server get no benchmark code; CI checks
 * the release builds (benchmarks/scripts/check-release-clean.sh).
 */
function createConfig(coreImpl, { bench = false } = {}) {
  if (coreImpl !== 'js' && coreImpl !== 'kmp') {
    throw new Error(`CORE_IMPL must be "js" or "kmp", got "${coreImpl}"`);
  }
  const corePackage = coreImpl === 'kmp' ? '@pocketly/core-kmp' : '@pocketly/core-js';
  const benchPackage = coreImpl === 'kmp' ? '@pocketly/core-kmp-bench' : '@pocketly/core-js-bench';
  const benchApp = path.join(__dirname, 'src/bench', bench ? 'index.ts' : 'disabled.ts');
  const resolveVirtual = (moduleName) => {
    if (moduleName === '@pocketly/core-impl') return corePackage;
    if (moduleName === '@pocketly/bench-app') return benchApp;
    if (moduleName === '@pocketly/bench-impl') {
      if (!bench) throw new Error('@pocketly/bench-impl is only available in perf (bench) bundles');
      return benchPackage;
    }
    return moduleName;
  };

  return mergeConfig(getDefaultConfig(__dirname), {
    watchFolders: [monorepoRoot],
    resolver: {
      nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(monorepoRoot, 'node_modules')],
      resolveRequest: (context, moduleName, platform) =>
        context.resolveRequest(context, resolveVirtual(moduleName), platform),
    },
  });
}

module.exports = createConfig(process.env.CORE_IMPL ?? (devServerPort() === KMP_DEV_PORT ? 'kmp' : 'js'));
module.exports.createConfig = createConfig;
