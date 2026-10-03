package com.pocketly.shared.domain

/**
 * The one place money is formatted and parsed (NFR-MONEY-02).
 * Mirrors packages/core-js/src/domain/money.ts — keep the algorithms identical (BM-PAR-02).
 */
object MoneyFormatter {
    private val AMOUNT_PATTERN = Regex("""^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$""")
    private val LEADING_ZEROS = Regex("""^0+(?=\d)""")
    private const val MAX_WHOLE_DIGITS = 11

    fun format(money: Money): String {
        val minor = money.minor
        val negative = minor < 0
        val abs = if (negative) -minor else minor
        val whole = abs / 100
        val cents = abs % 100

        val digits = whole.toString()
        val out = StringBuilder(digits.length + digits.length / 3 + 5)
        if (negative) out.append('-')
        out.append('$')
        for (i in digits.indices) {
            if (i > 0 && (digits.length - i) % 3 == 0) out.append(',')
            out.append(digits[i])
        }
        out.append('.')
        if (cents < 10) out.append('0')
        out.append(cents)
        return out.toString()
    }

    fun parse(input: String): MoneyParseResult {
        var s = input.trim()
        if (s.isEmpty()) return MoneyParseResult.error(MoneyParseError.EMPTY)
        if (s.startsWith('-')) return MoneyParseResult.error(MoneyParseError.NEGATIVE)
        if (s.startsWith('$')) s = s.substring(1)

        val match = AMOUNT_PATTERN.find(s) ?: return MoneyParseResult.error(MoneyParseError.INVALID_FORMAT)
        val fraction = match.groupValues[2]
        if (fraction.length > 2) return MoneyParseResult.error(MoneyParseError.TOO_MANY_DECIMALS)

        val whole = LEADING_ZEROS.replace(match.groupValues[1].replace(",", ""), "")
        if (whole.length > MAX_WHOLE_DIGITS) return MoneyParseResult.error(MoneyParseError.OUT_OF_RANGE)

        val minor = whole.toLong() * 100 + fraction.padEnd(2, '0').toLong()
        if (minor > Money.MAX_AMOUNT_MINOR) return MoneyParseResult.error(MoneyParseError.OUT_OF_RANGE)
        return MoneyParseResult.ok(Money(minor))
    }
}
