package com.margelo.nitro.pocketly.bench

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Loads libPocketlyCoreKmpBench.so, which registers `PocketlyBench` with Nitro's
 * HybridObjectRegistry. Added by kmpCorePerf only (apps/mobile/android/app/src/perf/.../PerfPackages.kt).
 */
class PocketlyCoreKmpBenchPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      PocketlyCoreKmpBenchOnLoad.initializeNative()
    }
  }
}
