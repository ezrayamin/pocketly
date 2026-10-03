package com.pocketly

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.facebook.react.R

/**
 * BM-01 "time to fully drawn": calls [Activity.reportFullyDrawn] during the draw pass of
 * the first frame that contains the JS `<FullyDrawnMarker />` (src/FullyDrawnMarker.tsx),
 * i.e. when Home is actually on screen, not when JS merely decided to render it.
 * Lives in `main`, so both flavors carry identical instrumentation.
 */
object FullyDrawnReporter {
  const val FULLY_DRAWN_MARKER = "pocketly.fullyDrawn"

  fun install(activity: Activity) {
    val root = activity.window.decorView
    var reported = false
    val listener = object : ViewTreeObserver.OnDrawListener {
      override fun onDraw() {
        if (reported || !containsMarker(root)) return
        reported = true
        activity.reportFullyDrawn()
        // Listeners can't be removed during dispatch.
        root.post { root.viewTreeObserver.removeOnDrawListener(this) }
      }
    }
    root.viewTreeObserver.addOnDrawListener(listener)
  }

  private fun containsMarker(view: View): Boolean {
    if (view.getTag(R.id.react_test_id) == FULLY_DRAWN_MARKER) return true
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        if (containsMarker(view.getChildAt(i))) return true
      }
    }
    return false
  }
}
