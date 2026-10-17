package com.pocketly.securescreen

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
 * NFR-SEC-03 on Android: FLAG_SECURE on the activity's window (via [SecureWindow]). Screenshots
 * and recordings come out black, and the app-switcher thumbnail is blank, while it's set.
 */
@ReactModule(name = PocketlySecureScreenModule.NAME)
class PocketlySecureScreenModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun setEnabled(enabled: Boolean) {
    UiThreadUtil.runOnUiThread {
      SecureWindow.sensitiveScreen = enabled
      context.currentActivity?.let(SecureWindow::apply)
    }
  }

  companion object {
    const val NAME = "PocketlySecureScreen"
  }
}

class PocketlySecureScreenPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == PocketlySecureScreenModule.NAME) PocketlySecureScreenModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      PocketlySecureScreenModule.NAME to
        ReactModuleInfo(PocketlySecureScreenModule.NAME, PocketlySecureScreenModule::class.java.name, false, false, false, false),
    )
  }
}
