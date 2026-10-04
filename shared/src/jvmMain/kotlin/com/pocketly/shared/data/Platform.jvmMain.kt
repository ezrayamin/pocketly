package com.pocketly.shared.data

import com.pocketly.shared.domain.OffsetAt
import java.util.TimeZone

internal actual fun platformOffsetAt(zoneId: String): OffsetAt? {
    // getTimeZone() silently falls back to GMT for unknown ids, so check first.
    if (zoneId != "UTC" && zoneId !in TimeZone.getAvailableIDs()) return null
    val zone = TimeZone.getTimeZone(zoneId)
    return OffsetAt { epochMillis -> zone.getOffset(epochMillis).toLong() }
}

internal actual fun currentTimeMillis(): Long = System.currentTimeMillis()
