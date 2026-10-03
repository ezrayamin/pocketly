/**
 * Core selection for native linking.
 *
 * Android: core-kmp is NOT autolinked. The kmpCore product flavor links it by hand
 * (android/settings.gradle + app/build.gradle `kmpCoreImplementation`), so the jsCore
 * APK contains no Kotlin core code.
 *
 * iOS: there are no flavors, so the pod is linked only when `CORE_IMPL=kmp` at
 * `pod install` time (see README "iOS").
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
  },
};
