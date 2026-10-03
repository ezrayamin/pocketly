package com.pocketly.shared.bridge

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import kotlin.math.abs
import kotlin.math.floor

/**
 * JS numbers arrive as Double. This is the ONE place a Double becomes money
 * (NFR-MONEY-01): it must be an exact, JS-safe integer or the call is rejected.
 * Used by both native adapters.
 */
object BridgeConversions {
    @Throws(CoreException::class)
    fun toLongExact(value: Double, field: String = "amount"): Long {
        if (!value.isFinite() || value != floor(value) || abs(value) > Money.MAX_SAFE_INTEGER) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "$field must be a safe integer of minor units, got $value")
        }
        return value.toLong()
    }

    @Throws(CoreException::class)
    fun toIntExact(value: Double, field: String): Int {
        val long = toLongExact(value, field)
        if (long < Int.MIN_VALUE || long > Int.MAX_VALUE) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "$field out of range: $value")
        }
        return long.toInt()
    }

    @Throws(CoreException::class)
    fun toLongArrayExact(values: DoubleArray, field: String = "amount"): LongArray =
        LongArray(values.size) { toLongExact(values[it], field) }
}
