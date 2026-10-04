package com.pocketly.preferences

import android.content.Context
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** SharedPreferences "pocketly.preferences": the same file the KMP core's AndroidPreferencesStore uses. */
@ReactModule(name = PocketlyPreferencesModule.NAME)
class PocketlyPreferencesModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val prefs = context.getSharedPreferences("pocketly.preferences", Context.MODE_PRIVATE)

  override fun getName() = NAME

  @ReactMethod
  fun getString(key: String, promise: Promise) {
    promise.resolve(prefs.getString(key, null))
  }

  @ReactMethod
  fun setString(key: String, value: String, promise: Promise) {
    prefs.edit().putString(key, value).apply()
    promise.resolve(null)
  }

  companion object {
    const val NAME = "PocketlyPreferences"
  }
}

class PocketlyPreferencesPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == PocketlyPreferencesModule.NAME) PocketlyPreferencesModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      PocketlyPreferencesModule.NAME to
        ReactModuleInfo(PocketlyPreferencesModule.NAME, PocketlyPreferencesModule::class.java.name, false, false, false, false),
    )
  }
}
