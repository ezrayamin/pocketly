package com.pocketly

import com.facebook.react.ReactPackage
import com.margelo.nitro.quickcrypto.QuickCryptoPackage
import com.sensitiveinfo.SensitiveInfoPackage

/**
 * jsCore: business logic runs in JS, so there is no native core to register. Its secure storage
 * and PIN crypto (ADR-0010) are linked into this flavor only, by hand.
 */
object CorePackages {
  val packages: List<ReactPackage> = listOf(SensitiveInfoPackage(), QuickCryptoPackage())

  /** Nothing to exclude: core-js uses every autolinked package it needs (incl. op-sqlite). */
  val excludedPackageClasses: Set<String> = emptySet()
}
