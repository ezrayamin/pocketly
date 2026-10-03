package com.margelo.nitro.pocketly.corekmp

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Loads libPocketlyCoreKmp.so, which registers `PocketlyCore` with Nitro's
 * HybridObjectRegistry. Added to the package list by the kmpCore flavor only
 * (apps/mobile/android/app/src/kmpCore/.../CorePackages.kt).
 */
class PocketlyCoreKmpPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      PocketlyCoreKmpOnLoad.initializeNative()
    }
  }
}
