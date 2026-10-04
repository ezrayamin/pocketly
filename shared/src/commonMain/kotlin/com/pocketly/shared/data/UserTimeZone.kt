package com.pocketly.shared.data

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.OffsetAt
import com.pocketly.shared.domain.UTC_OFFSET
import com.pocketly.shared.domain.ZonedCalendar
import com.pocketly.shared.domain.ZonedMonth
import kotlin.concurrent.Volatile

/** The user's zone + a per-month cache. Mirrors packages/core-js/src/data/timeZone.ts. */
internal class UserTimeZone(val zoneId: String) {
    val offsetAt: OffsetAt = if (zoneId == "UTC") UTC_OFFSET else
        platformOffsetAt(zoneId) ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Unknown time zone \"$zoneId\"")

    // Copy-on-write: summaries run on a thread pool; a race only duplicates a little work.
    @Volatile
    private var months: Map<String, ZonedMonth?> = emptyMap()

    /** Cached per month: repeated summaries (BM-03) don't redo the offset lookups. */
    fun month(month: String): ZonedMonth? {
        val cached = months
        if (cached.containsKey(month)) return cached[month]
        val computed = ZonedCalendar.zonedMonth(month, offsetAt)
        val next = LinkedHashMap(cached)
        if (next.size >= MONTH_CACHE_SIZE) next.remove(next.keys.first())
        next[month] = computed
        months = next
        return computed
    }

    private companion object {
        const val MONTH_CACHE_SIZE = 24
    }
}

/** Shared by the core facade (setTimeZone) and the fake backend (daily-limit day). */
internal class TimeZoneHolder {
    @Volatile
    var current: UserTimeZone = UserTimeZone("UTC")
}
