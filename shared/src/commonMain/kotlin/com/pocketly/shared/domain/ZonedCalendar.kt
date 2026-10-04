package com.pocketly.shared.domain

/**
 * Calendar math in the user's time zone (ADR-0006). Pure: the zone's UTC offset comes in as
 * [OffsetAt], so `domain/` keeps no platform dependency. Mirrors
 * packages/core-js/src/domain/zonedCalendar.ts — same steps, same number of offset lookups.
 */
fun interface OffsetAt {
    /** Offset (local − UTC) in ms at a UTC instant. */
    fun offsetAt(epochMillis: Long): Long
}

val UTC_OFFSET = OffsetAt { 0L }

private const val MINUTE = 60_000L

/** A run of time with one UTC offset, valid from [from] until the next segment. */
data class OffsetSegment(val from: Long, val offset: Long)

/** Local month as a half-open UTC range plus its offset segments. */
class ZonedMonth(val start: Long, val end: Long, val segments: List<OffsetSegment>)

object ZonedCalendar {
    /** Local calendar day (days since 1970-01-01, local) containing [epochMillis]. */
    fun localEpochDay(epochMillis: Long, zone: OffsetAt): Long =
        (epochMillis + zone.offsetAt(epochMillis)).floorDiv(UtcCalendar.MILLIS_PER_DAY)

    /** UTC instant of local midnight at the start of local day [epochDay]. */
    fun localMidnight(epochDay: Long, zone: OffsetAt): Long {
        val local = epochDay * UtcCalendar.MILLIS_PER_DAY
        val guess = local - zone.offsetAt(local)
        return local - zone.offsetAt(guess)
    }

    /**
     * Offset segments covering [start, end). Probes once per day and bisects to the minute
     * where the offset changes (DST), so a month costs ~31–45 lookups, not one per transaction.
     */
    fun offsetSegments(start: Long, end: Long, zone: OffsetAt): List<OffsetSegment> {
        val segments = mutableListOf(OffsetSegment(start, zone.offsetAt(start)))
        var prevT = start
        var prevOffset = segments[0].offset
        while (prevT < end) {
            val t = minOf(prevT + UtcCalendar.MILLIS_PER_DAY, end)
            val offset = zone.offsetAt(t)
            if (offset != prevOffset) {
                var lo = prevT
                var hi = t
                while (hi - lo > MINUTE) {
                    val mid = lo + ((hi - lo) / (2 * MINUTE)) * MINUTE
                    if (zone.offsetAt(mid) == prevOffset) lo = mid else hi = mid
                }
                segments += OffsetSegment(hi, offset)
                prevOffset = offset
            }
            prevT = t
        }
        return segments
    }

    /** Offset at [epochMillis] from precomputed segments (≤ 3 per month in practice). */
    fun segmentOffset(segments: List<OffsetSegment>, epochMillis: Long): Long {
        for (i in segments.indices.reversed()) {
            if (i == 0 || epochMillis >= segments[i].from) return segments[i].offset
        }
        return segments[0].offset
    }

    private val MONTH_PATTERN = Regex("""^(\d{4})-(0[1-9]|1[0-2])$""")

    /** Local month `YYYY-MM`, or null if malformed. */
    fun zonedMonth(month: String, zone: OffsetAt): ZonedMonth? {
        val match = MONTH_PATTERN.find(month) ?: return null
        val year = match.groupValues[1].toInt()
        val m = match.groupValues[2].toInt()
        val start = localMidnight(UtcCalendar.daysFromCivil(year, m, 1), zone)
        val nextFirst = if (m == 12) UtcCalendar.daysFromCivil(year + 1, 1, 1) else UtcCalendar.daysFromCivil(year, m + 1, 1)
        val end = localMidnight(nextFirst, zone)
        return ZonedMonth(start, end, offsetSegments(start, end, zone))
    }
}
