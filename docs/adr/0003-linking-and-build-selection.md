# ADR-0003: How each build links (or doesn't link) the KMP core

**Status:** Accepted · 2026-10-03

## Context

H5 / BM-08 compares app size, which only means something if `jsCore` really ships without the
Kotlin core. RN autolinking would otherwise link every native dependency into every variant.

## Decision

**Android**
- `apps/mobile/react-native.config.js` turns off Android autolinking for `@pocketly/core-kmp`.
- `android/settings.gradle` includes `:pocketly_core-kmp` by hand and adds `shared/` as a
  **composite build** (`includeBuild`). The dependency `com.pocketly:pocketly-shared` resolves
  to it, so Kotlin edits are picked up without publishing anything.
- `app/build.gradle` uses `kmpCoreImplementation project(":pocketly_core-kmp")`, and
  `src/kmpCore/.../CorePackages.kt` registers the Nitro package. `src/jsCore/` registers nothing.
- `shared/` pins Kotlin 2.2.0 and AGP 9.2.1, the versions RN 0.87 uses, because both builds
  share one Gradle run.

**iOS**
- There are no flavors. `CORE_IMPL=kmp pod install` links the `PocketlyCoreKmp` pod and the
  vendored `PocketlyShared.xcframework`; a plain `pod install` leaves both out.

## Benchmark-only code is in perf builds only (added 2026-10-17)

Until slice 5 the benchmark entry points were part of the `Core` contract, so release builds
carried them: BM-10's libraries (@noble/hashes in jsCore's bundle, KotlinCrypto in kmpCore's dex),
the harness, and eight Nitro methods (~42 KB each in the bridge library, ADR-0002). That also
inflated BM-08 for both builds. Now everything benchmark-only sits behind `BenchCore`
(`packages/core-contract/src/bench.ts`) and is linked into perf builds alone:

| Layer | Where the benchmark code is | Included in |
|---|---|---|
| Kotlin | `shared/bench` (`com.pocketly:pocketly-shared-bench`): `PocketlyBench`, BM-10's `PurePbkdf2` + KotlinCrypto | kmpCorePerf (`kmpCorePerfImplementation`) |
| Nitro | `packages/core-kmp-bench`: a second hybrid object, `PocketlyBench`, with its own spec and native library (`libPocketlyCoreKmpBench.so`); registered via `BuildConfig.BENCH_PACKAGE` | kmpCorePerf |
| JS | `packages/core-js-bench` (+ @noble/hashes) and the harness (`apps/mobile/src/bench`), behind the virtual modules `@pocketly/bench-impl` / `@pocketly/bench-app` | perf bundles (`metro.bench.config.js`, `metro.kmp.bench.config.js`); every other bundle gets `src/bench/disabled.ts` |
| iOS | not linked (`react-native.config.js`): iOS has no perf build yet | — |

- **The measurements still time the real core.** Only helpers and test-only entry points moved:
  `echo`, `formatMoneyBatch`, the ingest entry points and the staged payload (BM-04/04b), the
  timing getters, and BM-10. BM-03 still times `Core.computeSpendingSummary`, and the core still
  records its timings. The bench works on the same core instance (jsCore: its private members
  by element access; kmpCore: `CoreProbe` in `shared`, which only the bench module calls, and
  `HybridPocketlyCore.current`). The parse/validate code BM-04 times is the core's own
  (`TransactionIngestor` / `transactionIngestor.ts`); release just has no path to it, so R8 and
  the bundle leave it out.
- **`echo` keeps BM-06 valid:** a call to the second Nitro object crosses JS → Nitro → Kotlin by
  exactly the same mechanism as a call to `PocketlyCore`.
- **Checked in CI:** `benchmarks/scripts/check-release-clean.sh release` fails if R8's mapping
  has KotlinCrypto, bench, `CoreProbe` or `TransactionIngestor` entries (inlined frames included),
  if an APK has `libPocketlyCoreKmpBench.so`, or if a JS bundle has @noble/hashes, the harness
  or BenchCore strings. `… perf` inverts it, to show each check can see what it looks for.

## Known gap: the Nitro runtime is in both builds

`react-native-nitro-modules` (`libNitroModules.so`) stays autolinked in **both** flavors. Its
small Turbo Module is wired into the app's generated C++ autolinking, so moving it to one flavor
would mean patching RN's autolinking. That's out of scope for the skeleton.

Effect on BM-08: `jsCore` carries some bytes it never uses, so the measured `kmpCore − jsCore`
size delta **understates** the cost of KMP by the size of the Nitro runtime. The report has to
list that size separately (APK Analyzer → `lib/<abi>/libNitroModules.so`).

## Verified (2026-10-03, arm64 release builds)

| | jsCore | kmpCore |
|---|---|---|
| `libPocketlyCoreKmp.so` | absent | present |
| JS bundle contains core-js | yes | no |
| JS bundle contains the Nitro `PocketlyCore` lookup | no | yes |
