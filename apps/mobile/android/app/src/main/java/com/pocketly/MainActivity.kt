package com.pocketly

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.pocketly.securescreen.SecureWindow
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Pocketly"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        // perf builds: benchmark launch arguments → initial props (LaunchArgs.kt)
        override fun getLaunchOptions(): Bundle? = LaunchArgs.initialProps(this@MainActivity)
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    // react-native-screens: restores its fragments safely after an Activity restart.
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    super.onCreate(savedInstanceState)
    FullyDrawnReporter.install(this) // BM-01 time to fully drawn
    SecureWindow.onCreate(this) // FR-LOCK-03: no app content in the app switcher
  }

  // FR-LOCK-03 before Android 13: FLAG_SECURE while paused blanks the app-switcher snapshot.
  override fun onPause() {
    SecureWindow.paused = true
    SecureWindow.apply(this)
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    SecureWindow.paused = false
    SecureWindow.apply(this)
  }
}
