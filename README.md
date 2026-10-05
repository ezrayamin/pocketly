# Pocketly

A portfolio e-wallet built to answer one question with data: **does moving business logic from
JS into Kotlin Multiplatform make a React Native app faster?**

The same app ships as two builds that differ only in where the core runs:

| Build | Business logic runs in | Package id |
|---|---|---|
| `jsCore` | TypeScript on the JS thread (Hermes) | `com.pocketly.js` |
| `kmpCore` | Kotlin (KMP), called through a [Nitro](https://nitro.margelo.com) HybridObject | `com.pocketly.kmp` |

> **Status: M2 in progress.** Home and History (list, filters, detail, offline) run on both
> cores, with data persisted in SQLite (ADR-0009), on Android and iOS. Startup and size have
> interim results; the other benchmarks are next.

## Repository layout

```
apps/mobile/              React Native 0.87 app (flavors: jsCore, kmpCore)
packages/core-contract/   Core interface, shared types, contract tests, parity fixtures
packages/core-js/         TypeScript core
packages/core-kmp/        Nitro spec + Kotlin/Swift adapters + TS wrapper
shared/                   Kotlin Multiplatform core: domain/ data/ sync/ security/ bridge/
benchmarks/               fixtures, scripts, maestro, macrobenchmark, results
docs/                     product, requirements, benchmarking plan, architecture, ADRs, report
```

**Specs:** [product](docs/product.md) · [requirements](docs/requirements.md) · [benchmarking plan](docs/benchmarking.md)

Start with [docs/architecture.md](docs/architecture.md), then read the ADRs:
[0001 two cores](docs/adr/0001-one-contract-two-cores.md) ·
[0002 Nitro](docs/adr/0002-nitro-modules-bridge.md) ·
[0003 linking](docs/adr/0003-linking-and-build-selection.md) ·
[0004 parity](docs/adr/0004-parity-rules-in-practice.md) ·
[0005 where state lives](docs/adr/0005-where-state-lives.md) ·
[0006 time zones & clocks](docs/adr/0006-time-zones-and-clocks.md) ·
[0007 timeouts](docs/adr/0007-timeouts-and-late-responses.md) ·
[0008 dev tools in release](docs/adr/0008-developer-tools-in-release-builds.md) ·
[0009 storage](docs/adr/0009-storage-two-databases-two-engines.md).

## Prerequisites

Node ≥ 22.13, Yarn 1.22, JDK 17, Android SDK (API 36/37, NDK 27.1), Xcode 16.4+ and Ruby for iOS.

```bash
yarn install
```
```bash
cd apps/mobile && bundle install   # iOS: CocoaPods 1.15.2, pinned by Gemfile/Gemfile.lock
```

### First-time setup

Two machine-local files are git-ignored and must be created once per clone:

```bash
keytool -genkeypair -v -keystore apps/mobile/android/app/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```
```bash
echo 'export NODE_BINARY=$(command -v node)' > apps/mobile/ios/.xcode.env
```

The keystore signs debug *and* benchmark release builds (`app/build.gradle`). Each clone gets its
own key, so reinstall the apps if you switch machines.

## Everyday commands

| What | Command |
|---|---|
| All TS tests (core-js contract suite + app) | `yarn test` |
| Kotlin tests (incl. the same contract fixtures) | `yarn test:shared` |
| Typecheck everything | `yarn typecheck` |
| Regenerate `golden.json` after an intentional algorithm change | `yarn contract:golden` |
| Regenerate Nitro bindings after changing the spec or a contract type | `yarn nitrogen` |
| Regenerate the JS SQL after changing a `.sq` file (CI runs `sql:check`) | `yarn sql:generate` |
| Benchmark datasets | `yarn fixtures` |

### Android

```bash
# Debug: each flavor has its own Metro port, so both can run at the same time
yarn workspace @pocketly/mobile android:js     # Metro :8081 → core-js
yarn workspace @pocketly/mobile android:kmp    # Metro :8082 → core-kmp

# Release (the bundle picks the right core automatically)
cd apps/mobile/android && ./gradlew assembleJsCoreRelease assembleKmpCoreRelease

# Perf: release + benchmark launch arguments (docs/benchmarking.md §5.3)
cd apps/mobile/android && ./gradlew assembleJsCorePerf assembleKmpCorePerf
adb shell am start -W -n com.pocketly.kmp/com.pocketly.MainActivity \
  -e pocketly.tab history --ei pocketly.transactionCount 1000
```

Data persists across launches (`pocketly-server.db` + `pocketly-cache.db`). Clear the app's
storage, or use **Reset data** in the developer menu, to start over.

### iOS

iOS has no flavors. The core is chosen at `pod install` time, and both builds share the
bundle id `com.pocketly`, so only one is installed at a time:

```bash
yarn ios:framework                                         # builds shared/ → PocketlyShared.xcframework
cd apps/mobile/ios && CORE_IMPL=kmp bundle exec pod install  # kmpCore (also leaves op-sqlite out)
cd apps/mobile/ios && bundle exec pod install                # jsCore
yarn workspace @pocketly/mobile start:kmp                    # Metro :8082 for kmpCore
yarn workspace @pocketly/mobile ios --port 8082
```

React Native's core is built from source on iOS (`RCT_USE_PREBUILT_RNCORE=0` in the
Podfile): the prebuilt `React.xcframework` hides the C++ type info that react-native-svg's
Fabric props need, and the app fails to link against it. The first build is slower; the
other dependencies stay prebuilt.

If a Debug build fails to link with undefined `facebook::hermes::cdp::…` symbols, Pods hold
the Release Hermes engine from an earlier Release build without a record of it. Run
`echo -n Release > apps/mobile/ios/Pods/hermes-engine/.last_build_configuration` and rebuild:
the build's Hermes step then swaps in the Debug engine (both are cached in Pods).

A build made without the RN CLI loads JS from Metro's default port 8081. To point it at the
kmpCore Metro instead:
`xcrun simctl spawn booted defaults write com.pocketly RCT_jsLocation localhost:8082`.

### Developer menu (F11)

In every build we produce (debug, demo, benchmarks; ADR-0008): **Profile → tap the app version 7 times**. It drives the fake backend
(network mode: normal / slow 2–5 s / always fail / timeout / offline, a failure-rate slider,
"Trigger incoming transfer", "Reset data"). Settings last for the app session. Both cores
implement the same controls (`setNetworkSimulation`, `simulateIncomingTransfer`) with the
same seeded failure sequence, and every backend read times out after 10 s (NFR-REL-01);
late responses are discarded (ADR-0007). Scriptable: `pocketly://dev/network?normalLatencyMs=300`,
`pocketly://dev/reset`, `pocketly://dev/incoming`.

## Verified so far

- Both cores pass the shared contract fixtures, including persistence, offline fallback and
  mid-scroll inserts: 157 Jest tests for `core-js` and 36 JVM tests for the KMP core. The app has 19
  Jest tests (Home, History, launch arguments).
- Android release and perf builds of both flavors (R8 on), on a vivo V2538: same balance and
  history on both cores, data survives a restart, an offline cold start shows the replica
  with the offline banner, and History scrolls through 1,000 entries to the end.
- `jsCore`'s APK and JS bundle contain no KMP core code; `kmpCore`'s contain no op-sqlite.
  The exception is the Nitro runtime; see [ADR-0003](docs/adr/0003-linking-and-build-selection.md).
- iOS (simulator, Debug): both cores show the same seeded balance on Home, and History and
  the transaction detail work on `kmpCore`.

## Known issues

- **iOS has no benchmark launch arguments yet** (Android perf builds only).
