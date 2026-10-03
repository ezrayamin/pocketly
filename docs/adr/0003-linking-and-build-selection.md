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
