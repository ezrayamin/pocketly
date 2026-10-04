package com.pocketly.shared.data

import com.pocketly.shared.domain.OffsetAt
import platform.Foundation.NSDate
import platform.Foundation.NSTimeZone
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Foundation.timeIntervalSince1970
import platform.Foundation.timeZoneWithName

internal actual fun platformOffsetAt(zoneId: String): OffsetAt? {
    val zone = NSTimeZone.timeZoneWithName(zoneId) ?: return null
    return OffsetAt { epochMillis ->
        zone.secondsFromGMTForDate(NSDate.dateWithTimeIntervalSince1970(epochMillis / 1000.0)) * 1000L
    }
}

internal actual fun currentTimeMillis(): Long = (NSDate().timeIntervalSince1970 * 1000).toLong()
