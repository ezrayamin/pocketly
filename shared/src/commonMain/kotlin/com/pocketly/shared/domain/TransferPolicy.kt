package com.pocketly.shared.domain

/** checkTransferAmount's refusals: the money parse errors, then the transfer limits. Mirrors AmountRejectReason. */
enum class AmountRejectReason {
    EMPTY,
    NEGATIVE,
    TOO_MANY_DECIMALS,
    INVALID_FORMAT,
    OUT_OF_RANGE,
    BELOW_MINIMUM,
    INSUFFICIENT_FUNDS,
    DAILY_LIMIT_EXCEEDED,
}

/** Mirrors core-contract's AmountCheck. */
data class AmountCheck(
    val minor: Money?,
    val reason: AmountRejectReason?,
    val acceptInput: Boolean,
    val remainingBalance: Money?,
) {
    val ok: Boolean get() = reason == null

    /** [minor] unwrapped for Swift: a nullable value class is exported as an opaque `id`. */
    val minorUnits: Long? get() = minor?.minor
    val remainingBalanceMinor: Long? get() = remainingBalance?.minor
}

data class AmountLimits(val balance: Money, val dailyRemaining: Money)

/**
 * Transfer rules (FR-TRF-02/03/08/10, ADR-0014). Pure functions, cases in
 * fixtures/transfer.json. Constants identical to core-contract/src/constants.ts.
 * Mirrors packages/core-js/src/domain/transferPolicy.ts.
 */
object TransferPolicy {
    const val MIN_AMOUNT = 100L
    const val FEE = 0L
    const val DEFAULT_DAILY_LIMIT = 500_000L
    const val TIMEOUT_MS = 15_000L
    const val NOTE_MAX_LENGTH = 100
    const val RECENT_CONTACTS_LIMIT = 4
    const val PENDING_RESOLVE_MIN_MS = 5_000L
    const val PENDING_RESOLVE_MAX_MS = 20_000L

    /** What the keypad can produce: a whole number without leading zeros, then up to 2 decimals. */
    private val KEYPAD_TEXT = Regex("""^(0|[1-9][0-9]*)(\.[0-9]{0,2})?$""")
    private val TOO_MANY_DECIMALS = Regex("""^(0|[1-9][0-9]*)\.[0-9]{3,}$""")

    /** Whole digits of MAX_AMOUNT_MINOR (99,999,999,999.99). */
    private const val MAX_WHOLE_DIGITS = 11

    /** FR-TRF-02, on every keystroke. A trailing "." is accepted while typing. */
    fun checkAmount(text: String, limits: AmountLimits): AmountCheck {
        if (text.isEmpty()) return refuse(AmountRejectReason.EMPTY, accept = true)
        if (text.startsWith("-")) return refuse(AmountRejectReason.NEGATIVE)
        if (TOO_MANY_DECIMALS.matches(text)) return refuse(AmountRejectReason.TOO_MANY_DECIMALS)
        val match = KEYPAD_TEXT.matchEntire(text) ?: return refuse(AmountRejectReason.INVALID_FORMAT)
        val whole = match.groupValues[1]
        if (whole.length > MAX_WHOLE_DIGITS) return refuse(AmountRejectReason.OUT_OF_RANGE)
        val fraction = match.groupValues[2].removePrefix(".").padEnd(2, '0')
        val minor = whole.toLong() * 100 + fraction.toLong()
        if (minor > Money.MAX_AMOUNT_MINOR) return refuse(AmountRejectReason.OUT_OF_RANGE)

        val remaining = Money(limits.balance.minor - minor)
        val reason = if (minor < MIN_AMOUNT) AmountRejectReason.BELOW_MINIMUM else exceededLimit(minor, limits)
        return AmountCheck(Money(minor), reason, acceptInput = true, remainingBalance = remaining)
    }

    /** min(balance, dailyRemaining). */
    fun maxAmount(limits: AmountLimits): Money = minOf(limits.balance, limits.dailyRemaining)

    /** The bound an amount breaks: the balance first, then today's limit (the server's order too). */
    fun exceededLimit(minor: Long, limits: AmountLimits): AmountRejectReason? = when {
        minor > limits.balance.minor -> AmountRejectReason.INSUFFICIENT_FUNDS
        minor > limits.dailyRemaining.minor -> AmountRejectReason.DAILY_LIMIT_EXCEEDED
        else -> null
    }

    /** A whole number of minor units a transfer may carry (the server checks this too). */
    fun isValidAmount(minor: Long): Boolean = minor in MIN_AMOUNT..Money.MAX_AMOUNT_MINOR

    /**
     * FR-TRF-03: trimmed; empty means no note. Throws INVALID_ARGUMENT when too long or not one
     * line (the request the key protects must be unambiguous).
     */
    fun normalizeNote(note: String?): String? {
        val trimmed = note?.trim() ?: return null
        if (trimmed.isEmpty()) return null
        if (trimmed.length > NOTE_MAX_LENGTH) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "note must be at most $NOTE_MAX_LENGTH characters")
        }
        if (trimmed.any { it == '\n' || it == '\r' }) throw CoreException(ErrorCode.INVALID_ARGUMENT, "note must be one line")
        return trimmed
    }

    /** requirements §4.3: may a FAILED transfer be sent again with the same key? */
    fun isRetryable(code: ErrorCode): Boolean =
        code == ErrorCode.NETWORK_UNAVAILABLE || code == ErrorCode.SERVER_ERROR || code == ErrorCode.NETWORK_TIMEOUT

    private fun refuse(reason: AmountRejectReason, accept: Boolean = false) = AmountCheck(null, reason, accept, null)
}
