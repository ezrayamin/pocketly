/**
 * Core selection for native linking.
 *
 * Android: core-kmp is NOT autolinked. The kmpCore product flavor links it by hand
 * (android/settings.gradle + app/build.gradle `kmpCoreImplementation`), so the jsCore
 * APK contains no Kotlin core code.
 *
 * iOS: there are no flavors, so the pod is linked only when `CORE_IMPL=kmp` at
 * `pod install` time (see README "iOS").
 *
 * op-sqlite is jsCore's storage engine (ADR-0009). kmpCore never loads it: Android
 * excludes its package and strips its .so from kmpCore APKs (app/build.gradle), and on
 * iOS it is not linked when `CORE_IMPL=kmp`. BM-08 then charges SQLite to jsCore alone.
 *
 * react-native-sensitive-info and react-native-quick-crypto are jsCore's secure storage and PIN
 * crypto (ADR-0010). Their packages load their native libraries as soon as they're created, so
 * stripping the .so (as for op-sqlite) would crash kmpCore: Android autolinking is off for both,
 * and the jsCore flavor links them by hand (android/settings.gradle, app/build.gradle
 * `jsCoreImplementation`, src/jsCore/.../CorePackages.kt). On iOS they follow op-sqlite.
 */
const linkKmpOnIos = process.env.CORE_IMPL === 'kmp';

module.exports = {
  dependencies: {
    '@pocketly/core-kmp': {
      platforms: {
        android: null,
        ...(linkKmpOnIos ? {} : { ios: null }),
      },
    },
    '@op-engineering/op-sqlite': {
      platforms: linkKmpOnIos ? { ios: null } : {},
    },
    'react-native-sensitive-info': {
      platforms: { android: null, ...(linkKmpOnIos ? { ios: null } : {}) },
    },
    'react-native-quick-crypto': {
      platforms: { android: null, ...(linkKmpOnIos ? { ios: null } : {}) },
    },
    // A codegen Turbo Module (quick-crypto's peer): wired into the app's generated C++ autolinking,
    // so on Android it stays in both flavors, like the Nitro runtime (ADR-0003 known gap).
    'react-native-quick-base64': {
      platforms: linkKmpOnIos ? { ios: null } : {},
    },
  },
};
