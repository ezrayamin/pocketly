package com.pocketly.shared.domain

import kotlin.jvm.JvmInline

/**
 * Money as Long minor units (NFR-MONEY-01). e.g. 150000 = $1,500.00.
 * Float/Double never hold an amount; the only Double → Long conversion lives in
 * `bridge/BridgeConversions.kt`, at the JS boundary.
 */
@JvmInline
value class Money(val minor: Long) : Comparable<Money> {
    operator fun plus(other: Money) = Money(minor + other.minor)
    operator fun minus(other: Money) = Money(minor - other.minor)
    operator fun unaryMinus() = Money(-minor)
    override fun compareTo(other: Money) = minor.compareTo(other.minor)

    companion object {
        val ZERO = Money(0)

        /** Largest amount the app accepts: 99,999,999,999.99. */
        const val MAX_AMOUNT_MINOR = 9_999_999_999_999L

        /** JS `Number.MAX_SAFE_INTEGER`. Anything above can't cross the bridge exactly. */
        const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    }
}

/** UTC epoch milliseconds. A plain Long (not Instant) so both cores do identical work (ADR-0004). */
typealias EpochMillis = Long
