package com.pocketly

import com.facebook.react.ReactPackage
import com.margelo.nitro.pocketly.corekmp.PocketlyCoreKmpPackage

/** kmpCore: registers the Nitro `PocketlyCore` hybrid object backed by the KMP module. */
object CorePackages {
  val packages: List<ReactPackage> = listOf(PocketlyCoreKmpPackage())
}
