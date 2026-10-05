# Workarounds

Things in this repo that exist only to get around a bug or a device limitation. Each one has a
trigger for removing it and a way to check. Review this list when upgrading React Native,
react-native-svg, Nitro, Xcode or the test device.

| # | Workaround | Where | Remove when |
|---|---|---|---|
| 1 | `androidx.collection` forced to 1.4.4 | `apps/mobile/android/app/build.gradle` | React Native ≥ 0.88 |
| 2 | iOS: React Native's core built from source | `apps/mobile/ios/Podfile` (`RCT_USE_PREBUILT_RNCORE=0`) | The prebuilt core exposes the symbols react-native-svg needs |
| 3 | BM-01: `am start` + platform startup logs instead of Macrobenchmark (vivo) | `benchmarks/scripts/bm-01-startup.sh` | Macrobenchmark stops hanging on this ROM |
| 4 | BM-02: `adb` swipes instead of Maestro (vivo) | `benchmarks/scripts/bm-02-scroll.sh` | Maestro's driver works on this device |
| 5 | Nitro `resetData(DatasetSeed, Transaction[])` instead of `resetData(DatasetConfig)` | `packages/core-kmp/src/specs/PocketlyCore.nitro.ts`, `src/index.ts` | Swift's C++ interop handles an optional array of structs inside a struct |

## 1. `androidx.collection` 1.4.4 (Android, both builds)

**Why.** React Native 0.87 keeps the native view registry in a `MutableIntObjectMap`.
`androidx.collection` 1.4.0–1.4.2 can corrupt it ([Google bug 352560465](https://issuetracker.google.com/issues/352560465)),
and the app resolved 1.4.2 through other AndroidX libraries. Views went missing ("Unable to find
viewState for tag N") and fast list scrolling crashed with "Unable to find parentView". Found by
BM-02; see [reactwg/react-native-releases#1426](https://github.com/reactwg/react-native-releases/issues/1426).

**Check before removing.** After the React Native upgrade, delete the override and run
`./gradlew :app:dependencyInsight --configuration jsCorePerfRuntimeClasspath --dependency androidx.collection:collection`:
it must resolve ≥ 1.4.3. Then run one `benchmarks/scripts/bm-02-scroll.sh <package>` iteration per
build and count `MissingViewState` lines in `adb logcat`: expect 0.

## 2. iOS: React Native core from source

**Why.** React Native 0.87 links a prebuilt `React.xcframework` by default. It's a dynamic
library that keeps React's C++ type info private (`typeinfo`/`vtable for facebook::react::Props`
and others). react-native-svg's Fabric props inherit from those classes, so the app fails to link
(23 undefined symbols from `libRNSVG.a`). react-native-svg 15.15.5 was the latest release when
this was added.

**Cost.** Clean iOS builds compile React Native too: a clean Debug build on this Mac takes about
5 minutes instead of about 1 minute (see README, iOS). Third-party dependencies stay prebuilt.

**Check before removing.** Delete the `ENV['RCT_USE_PREBUILT_RNCORE'] = '0'` line, run
`bundle exec pod install`, and build. It's fixed when the link succeeds; then also run the app.

## 3. BM-01 without Macrobenchmark (vivo V2538)

**Why.** On this phone (Android 16), Macrobenchmark 1.4.1 and 1.5.0 hang after measuring, in a
`cmd package dump` call that returns about 1 MB on this ROM. The test process is killed with an
empty results file, and time to full display is never recorded. BM-01 and BM-09 measure cold
starts with `am start -W` and ActivityTaskManager's `Displayed` / `Fully drawn` log lines instead
(the definitions Android vitals uses). See [benchmarking.md](benchmarking.md) §5.

**Check before removing.** Run the `benchmarks/macrobenchmark` module against both flavors on the
device. It's fixed when it finishes and writes results with `timeToFullDisplayMs`.

## 4. BM-02 without Maestro (vivo V2538)

**Why.** Maestro 2.11's on-device driver hangs (120 s timeouts) or fails on the view-hierarchy
call on this phone, while `adb shell uiautomator dump` of the same screen takes about 3 s. BM-02
drives the flings with `adb shell input swipe` and reads the screen with `uiautomator` only
outside the measured window. The Maestro flow `benchmarks/maestro/bm-02-scroll.yaml` stays for
other devices. See [benchmarking.md](benchmarking.md) §5.

**Check before removing.** With the app idle on History, run `maestro hierarchy` three times; each
should return within a few seconds. Then run `maestro test -e APP_ID=com.pocketly.kmp
benchmarks/maestro/bm-02-scroll.yaml` to the end. Note that the two drivers make different
gestures, so frame rates from a Maestro run aren't comparable with earlier `adb` runs.

## 5. Nitro: `resetData(DatasetSeed, Transaction[])`

**Why.** With `extraTransactions?: Transaction[]` inside the bridged `DatasetConfig` struct,
Nitrogen generates `std::optional<std::vector<Transaction>>`, and Swift's C++ interop (Xcode 16.4,
Swift 6.1) then loses the `std::vector<Transaction>` collection conformance everywhere, including
`TransactionPage.items`. The spec therefore takes `DatasetSeed` (the generated fields) and a
plain `Transaction[]`; `KmpCore.resetData` splits the config. The `Core` contract is unchanged.
See ADR-0009.

**Check before removing.** After a Nitro or Xcode upgrade, change the spec back to
`resetData(config: DatasetConfig)`, run `yarn nitrogen`, update both adapters, and build iOS. It's
fixed when the generated Swift compiles.

## Not a workaround: the Hermes engine swap (local only)

During the iOS fix, a Debug build failed on undefined `facebook::hermes::cdp::…` symbols because
`Pods/` held the Release Hermes engine from an earlier Release build, without the marker file that
tells the build which engine is installed. That was local state in a git-ignored folder, fixed
locally. A fresh clone with a clean `pod install` doesn't need it; see README, iOS, for the
recovery step if it happens again.
