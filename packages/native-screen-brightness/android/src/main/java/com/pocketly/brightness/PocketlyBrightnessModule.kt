package com.pocketly.brightness

import android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
import android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * FR-QR-05 on Android: the activity window's own brightness, no permission needed. It applies only
 * while this window is in front, so leaving the app restores the system brightness by itself.
 */
@ReactModule(name = PocketlyBrightnessModule.NAME)
class PocketlyBrightnessModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun setRaised(raised: Boolean) {
    UiThreadUtil.runOnUiThread {
      val window = context.currentActivity?.window ?: return@runOnUiThread
      window.attributes = window.attributes.apply {
        screenBrightness = if (raised) BRIGHTNESS_OVERRIDE_FULL else BRIGHTNESS_OVERRIDE_NONE
      }
    }
  }

  companion object {
    const val NAME = "PocketlyBrightness"
  }
}

class PocketlyBrightnessPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == PocketlyBrightnessModule.NAME) PocketlyBrightnessModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      PocketlyBrightnessModule.NAME to
        ReactModuleInfo(
          PocketlyBrightnessModule.NAME,
          PocketlyBrightnessModule::class.java.name,
          false,
          false,
          false,
          false,
        ),
    )
  }
}
