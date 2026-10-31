package com.pocketly.shared.domain

/**
 * Top-up rules (FR-TOP-01/02, ADR-0015). Pure functions, cases in fixtures/topup.json.
 * Constants identical to core-contract/src/constants.ts. Mirrors packages/core-js/src/domain/topUpPolicy.ts.
 */
object TopUpPolicy {
    const val MIN_AMOUNT = 500L
    const val MAX_AMOUNT = 100_000L
    val PRESETS = listOf(1_000L, 2_500L, 5_000L, 10_000L)
    const val FEE = 0L
    const val PROCESSING_MIN_MS = 2_000L
    const val PROCESSING_MAX_MS = 5_000L

    /** FR-TOP-02: each method's counterparty, the seed's PAYMENT_METHOD ones (SeedData.kt). */
    private val METHODS = mapOf(
        TopUpMethod.BANK_TRANSFER to Counterparty(CounterpartyKind.PAYMENT_METHOD, "pm-bank", "Bank transfer"),
        TopUpMethod.CARD to Counterparty(CounterpartyKind.PAYMENT_METHOD, "pm-card", "Card"),
    )

    /** FR-TOP-01, on every keystroke: the keypad rules, then BELOW_MINIMUM, then ABOVE_MAXIMUM. */
    fun checkAmount(text: String): AmountCheck {
        val parsed = TransferPolicy.parseKeypad(text)
        val minor = parsed.minor?.minor ?: return parsed
        val reason = when {
            minor < MIN_AMOUNT -> AmountRejectReason.BELOW_MINIMUM
            minor > MAX_AMOUNT -> AmountRejectReason.ABOVE_MAXIMUM
            else -> null
        }
        return parsed.copy(reason = reason)
    }

    /** A whole number of minor units a top-up may carry (the server checks this too). */
    fun isValidAmount(minor: Long): Boolean = minor in MIN_AMOUNT..MAX_AMOUNT

    fun counterparty(method: TopUpMethod): Counterparty = METHODS.getValue(method)

    /** The method a top-up's counterparty stands for (an attempt rebuilt from the replica), if any. */
    fun methodOf(counterparty: Counterparty?): TopUpMethod? {
        if (counterparty?.kind != CounterpartyKind.PAYMENT_METHOD) return null
        return METHODS.entries.firstOrNull { it.value.id == counterparty.id }?.key
    }
}
