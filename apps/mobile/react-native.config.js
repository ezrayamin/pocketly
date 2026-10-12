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
  },
};
