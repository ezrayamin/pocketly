package com.pocketly.shared.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class UtcCalendarTest {
    @Test
    fun knownDates() {
        assertEquals("1970-01-01", UtcCalendar.isoDate(0))
        assertEquals("2024-02-29", UtcCalendar.isoDate(UtcCalendar.daysFromCivil(2024, 2, 29)))
        assertEquals("2100-02-28", UtcCalendar.isoDate(UtcCalendar.daysFromCivil(2100, 3, 1) - 1))
        assertEquals("2026-10-01", UtcCalendar.isoDate(UtcCalendar.epochDay(DatasetConfig.DEFAULT.nowMillis)))
    }

    @Test
    fun roundTrip() {
        var day = 0L
        while (day < 47_500) {
            val (y, m, d) = UtcCalendar.isoDate(day).split('-').map { it.toInt() }
            assertEquals(day, UtcCalendar.daysFromCivil(y, m, d))
            day += 13
        }
    }

    @Test
    fun monthRanges() {
        val dec = UtcCalendar.monthRange("2026-12")!!
        assertEquals(UtcCalendar.daysFromCivil(2026, 12, 1) * UtcCalendar.MILLIS_PER_DAY, dec.first)
        assertEquals(UtcCalendar.daysFromCivil(2027, 1, 1) * UtcCalendar.MILLIS_PER_DAY - 1, dec.last)
        assertNull(UtcCalendar.monthRange("2026-00"))
        assertNull(UtcCalendar.monthRange("Sept"))
    }
}
