package com.pocketly.shared.domain

/**
 * UTC calendar math with no platform date APIs (Howard Hinnant's algorithms).
 * Mirrors packages/core-js/src/domain/calendar.ts.
 */
internal object UtcCalendar {
    const val MILLIS_PER_DAY = 86_400_000L

    private val MONTH_PATTERN = Regex("""^(\d{4})-(0[1-9]|1[0-2])$""")

    fun epochDay(millis: EpochMillis): Long = millis.floorDiv(MILLIS_PER_DAY)

    fun daysFromCivil(year: Int, month: Int, day: Int): Long {
        val y = (if (month <= 2) year - 1 else year).toLong()
        val era = y.floorDiv(400L)
        val yoe = y - era * 400
        val mp = (month + 9) % 12
        val doy = (153 * mp + 2) / 5 + day - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    /** `YYYY-MM-DD` for an epoch day. */
    fun isoDate(epochDay: Long): String {
        val z = epochDay + 719468
        val era = z.floorDiv(146097L)
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val day = doy - (153 * mp + 2) / 5 + 1
        val month = if (mp < 10) mp + 3 else mp - 9
        val year = yoe + era * 400 + (if (month <= 2) 1 else 0)
        return buildString(10) {
            append(year)
            append('-')
            if (month < 10) append('0')
            append(month)
            append('-')
            if (day < 10) append('0')
            append(day)
        }
    }

    /** Half-open [start, end) millis range for `YYYY-MM`, or null if malformed. */
    fun monthRange(month: String): LongRange? {
        val match = MONTH_PATTERN.find(month) ?: return null
        val year = match.groupValues[1].toInt()
        val m = match.groupValues[2].toInt()
        val start = daysFromCivil(year, m, 1) * MILLIS_PER_DAY
        val end = (if (m == 12) daysFromCivil(year + 1, 1, 1) else daysFromCivil(year, m + 1, 1)) * MILLIS_PER_DAY
        return start until end
    }
}
