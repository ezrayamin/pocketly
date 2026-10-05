package com.pocketly

import com.facebook.react.ReactPackage

/** jsCore: business logic runs in JS, so there is no native core to register. */
object CorePackages {
  val packages: List<ReactPackage> = emptyList()

  /** Nothing to exclude: core-js uses every autolinked package it needs (incl. op-sqlite). */
  val excludedPackageClasses: Set<String> = emptySet()
}
