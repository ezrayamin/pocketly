package com.pocketly.buildinfo

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Exposes the app's `pocketly_dev_tools` bool resource (app/build.gradle). Missing → false. */
@ReactModule(name = PocketlyBuildInfoModule.NAME)
class PocketlyBuildInfoModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  override fun getConstants(): Map<String, Any> {
    val id = context.resources.getIdentifier("pocketly_dev_tools", "bool", context.packageName)
    return mapOf("devToolsEnabled" to (id != 0 && context.resources.getBoolean(id)))
  }

  companion object {
    const val NAME = "PocketlyBuildInfo"
  }
}

class PocketlyBuildInfoPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == PocketlyBuildInfoModule.NAME) PocketlyBuildInfoModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      PocketlyBuildInfoModule.NAME to
        ReactModuleInfo(PocketlyBuildInfoModule.NAME, PocketlyBuildInfoModule::class.java.name, false, false, false, false),
    )
  }
}
