package com.pocketly

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages
          // Flavor-specific (src/jsCore | src/kmpCore): each core's own packages in, the other's out.
          .filterNot { it.javaClass.name in CorePackages.excludedPackageClasses }
          .toMutableList()
          .apply {
            addAll(CorePackages.packages)
            addAll(benchPackages())
          },
    )
  }

  /**
   * kmpCorePerf only: the benchmark Nitro object (BuildConfig.BENCH_PACKAGE, app/build.gradle).
   * Every other variant has none, and no benchmark code to load.
   */
  private fun benchPackages(): List<ReactPackage> =
    BuildConfig.BENCH_PACKAGE?.let { listOf(Class.forName(it).getDeclaredConstructor().newInstance() as ReactPackage) }
      .orEmpty()

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
