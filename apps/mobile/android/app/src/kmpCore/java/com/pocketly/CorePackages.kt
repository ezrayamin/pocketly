package com.pocketly

import com.facebook.react.ReactPackage
import com.margelo.nitro.pocketly.corekmp.PocketlyCoreKmpPackage

/** kmpCore: registers the Nitro `PocketlyCore` hybrid object backed by the KMP module. */
object CorePackages {
  val packages: List<ReactPackage> = listOf(PocketlyCoreKmpPackage())

  /**
   * Autolinked packages this flavor must not create (ADR-0009). op-sqlite serves core-js
   * only; legacy packages are instantiated eagerly, and its native library is stripped from
   * kmpCore APKs, so creating it would crash. Matched by class name: no compile-time link.
   */
  val excludedPackageClasses: Set<String> = setOf("com.op.sqlite.OPSQLitePackage")
}
