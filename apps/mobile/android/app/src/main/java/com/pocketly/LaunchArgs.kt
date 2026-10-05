package com.pocketly

import android.app.Activity
import android.os.Bundle

/**
 * Benchmark launch arguments (perf builds only, docs/benchmarking.md §5.3): every
 * `pocketly.*` intent extra, as a string, under the root component's `launchArgs` prop.
 *
 *   adb shell am start -n com.pocketly.js/com.pocketly.MainActivity \
 *     -e pocketly.tab history --ei pocketly.transactionCount 1000
 *
 * Maestro's `launchApp: arguments:` sends the same extras. JS validates and applies them
 * before the first screen loads (apps/mobile/src/launchArgs.ts). Read at cold start only.
 */
object LaunchArgs {
  private const val PREFIX = "pocketly."

  fun initialProps(activity: Activity): Bundle? {
    if (!activity.resources.getBoolean(R.bool.pocketly_launch_args)) return null
    val extras = activity.intent?.extras ?: return null
    val args = Bundle()
    for (key in extras.keySet()) {
      if (!key.startsWith(PREFIX)) continue
      // Any primitive extra type (am start -e/--ei/--el/--ez, Maestro's typed arguments).
      @Suppress("DEPRECATION") val value = extras.get(key) ?: continue
      args.putString(key.removePrefix(PREFIX), value.toString())
    }
    return if (args.isEmpty) null else Bundle().apply { putBundle("launchArgs", args) }
  }
}
