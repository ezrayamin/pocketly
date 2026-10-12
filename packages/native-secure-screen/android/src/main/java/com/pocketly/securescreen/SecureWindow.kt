package com.pocketly.securescreen

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/**
 * The window's two privacy needs, in one place so neither undoes the other:
 *  - NFR-SEC-03: a sensitive screen is showing ([sensitiveScreen], from JS) → FLAG_SECURE.
 *  - FR-LOCK-03: the app-switcher snapshot must not show the app. Android 13+ has
 *    `setRecentsScreenshotEnabled(false)` (set once, screenshots stay allowed); before that,
 *    FLAG_SECURE goes on while the activity is paused ([paused]), which also blanks the snapshot.
 * Called from MainActivity's lifecycle and from [PocketlySecureScreenModule], on the UI thread.
 */
object SecureWindow {
  var sensitiveScreen = false
  var paused = false

  fun onCreate(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(false)
  }

  fun apply(activity: Activity) {
    val secure = sensitiveScreen || (paused && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU)
    if (secure) {
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}
