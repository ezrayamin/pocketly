package com.pocketly.shared.data.fake

import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType

/**
 * FR-FAKE-01 dataset generator. Mirrors packages/core-js/src/data/seedData.ts draw-for-draw:
 * every entry consumes exactly 8 random numbers in the same order, whatever branch it takes.
 */
internal object SeedData {
    const val WALLET_ID = "w-main"
    val DAILY_LIMIT = Money(500_000)
    val OPENING_BALANCE = Money(1_000_000)

    private const val MINUTE = 60_000L
    private const val WINDOW_MINUTES = 60 * 24 * 60

    val CONTACTS: List<Counterparty> = listOf(
        "Andi Pratama", "Budi Santoso", "Citra Lestari", "Dewi Anggraini", "Eko Saputra",
        "Fajar Nugroho", "Gita Permata", "Hadi Wijaya", "Intan Maharani", "Joko Susilo",
    ).mapIndexed { i, name ->
        val n = (i + 1).toString().padStart(2, '0')
        Counterparty(CounterpartyKind.USER, "u-$n", name, "+155500000$n")
    }

    private class Merchant(val counterparty: Counterparty, val category: Category)

    private val MERCHANTS: List<Merchant> = listOf(
        "Corner Coffee" to Category.FOOD,
        "Noodle House" to Category.FOOD,
        "Metro Transit" to Category.TRANSPORT,
        "QuickRide" to Category.TRANSPORT,
        "Fresh Mart" to Category.SHOPPING,
        "Style Outlet" to Category.SHOPPING,
        "City Power" to Category.BILLS,
        "Net Fiber" to Category.BILLS,
        "Star Cinema" to Category.ENTERTAINMENT,
        "Game Arcade" to Category.ENTERTAINMENT,
    ).mapIndexed { i, (name, category) ->
        val id = "m-" + (i + 1).toString().padStart(2, '0')
        Merchant(Counterparty(CounterpartyKind.MERCHANT, id, name), category)
    }

    private val PAYMENT_METHODS = listOf(
        Counterparty(CounterpartyKind.PAYMENT_METHOD, "pm-bank", "Bank transfer"),
        Counterparty(CounterpartyKind.PAYMENT_METHOD, "pm-card", "Card"),
    )

    private val NOTES = listOf("Lunch", "Rent share", "Thanks!", "Groceries", "Birthday gift", "Dinner split")
    private val FAILURE_REASONS =
        listOf(ErrorCode.INSUFFICIENT_FUNDS, ErrorCode.SERVER_ERROR, ErrorCode.RECIPIENT_NOT_FOUND)

    /** FR-DEV-04: the n-th simulated incoming transfer (n ≥ 1). Deterministic, so both cores agree. */
    fun simulatedIncomingTransfer(n: Int, now: Long) = Transaction(
        id = "sim-" + n.toString().padStart(6, '0'),
        idempotencyKey = "sim-key-$n",
        type = TransactionType.TRANSFER_IN,
        category = Category.TRANSFER,
        amount = Money(1_000L + (n.toLong() * 7_919) % 49_000),
        counterparty = CONTACTS[(n - 1) % CONTACTS.size],
        note = "Simulated incoming transfer",
        status = TransactionStatus.SUCCESS,
        failureReason = null,
        createdAt = now,
        updatedAt = now,
    )

    private fun txId(i: Int) = "tx-" + i.toString().padStart(6, '0')

    private fun pickType(roll: Int) = when {
        roll < 45 -> TransactionType.QR_PAYMENT
        roll < 70 -> TransactionType.TRANSFER_OUT
        roll < 88 -> TransactionType.TRANSFER_IN
        else -> TransactionType.TOP_UP
    }

    private fun pickStatus(roll: Int) = when {
        roll < 90 -> TransactionStatus.SUCCESS
        roll < 95 -> TransactionStatus.FAILED
        roll < 98 -> TransactionStatus.PENDING
        else -> TransactionStatus.REVERSED
    }

    /** [now] is the backend clock at seeding time (config.nowMillis when frozen). */
    fun generate(config: DatasetConfig, now: Long): List<Transaction> {
        val rng = SeededRandom(config.seed)
        val out = ArrayList<Transaction>(config.transactionCount)

        val openingAt = now - (WINDOW_MINUTES + 24 * 60) * MINUTE
        out += Transaction(
            id = txId(0),
            idempotencyKey = "seed-${config.seed}-0",
            type = TransactionType.TOP_UP,
            category = Category.TOP_UP,
            amount = OPENING_BALANCE,
            counterparty = PAYMENT_METHODS[0],
            note = "Opening balance",
            status = TransactionStatus.SUCCESS,
            failureReason = null,
            createdAt = openingAt,
            updatedAt = openingAt,
        )

        for (i in 1 until config.transactionCount) {
            val minutesAgo = rng.nextInt(WINDOW_MINUTES) + 1
            val typeRoll = rng.nextInt(100)
            val amountRoll = rng.nextInt(1_000_000)
            val statusRoll = rng.nextInt(100)
            val failureRoll = rng.nextInt(FAILURE_REASONS.size)
            val counterpartyRoll = rng.nextInt(1000)
            val noteRoll = rng.nextInt(4)
            val notePick = rng.nextInt(NOTES.size)

            val type = pickType(typeRoll)
            val status = pickStatus(statusRoll)
            val createdAt = now - minutesAgo * MINUTE

            val amount: Long
            val category: Category
            val counterparty: Counterparty
            when (type) {
                TransactionType.QR_PAYMENT -> {
                    val merchant = MERCHANTS[counterpartyRoll % MERCHANTS.size]
                    amount = 100L + amountRoll % 15_000
                    category = merchant.category
                    counterparty = merchant.counterparty
                }
                TransactionType.TRANSFER_OUT -> {
                    amount = 500L + amountRoll % 50_000
                    category = Category.TRANSFER
                    counterparty = CONTACTS[counterpartyRoll % CONTACTS.size]
                }
                TransactionType.TRANSFER_IN -> {
                    amount = 500L + amountRoll % 60_000
                    category = Category.TRANSFER
                    counterparty = CONTACTS[counterpartyRoll % CONTACTS.size]
                }
                TransactionType.TOP_UP -> {
                    amount = (1L + amountRoll % 20) * 5_000
                    category = Category.TOP_UP
                    counterparty = PAYMENT_METHODS[counterpartyRoll % PAYMENT_METHODS.size]
                }
            }

            val isTransfer = type == TransactionType.TRANSFER_OUT || type == TransactionType.TRANSFER_IN
            out += Transaction(
                id = txId(i),
                idempotencyKey = "seed-${config.seed}-$i",
                type = type,
                category = category,
                amount = Money(amount),
                counterparty = counterparty,
                note = if (isTransfer && noteRoll == 0) NOTES[notePick] else null,
                status = status,
                failureReason = if (status == TransactionStatus.FAILED) FAILURE_REASONS[failureRoll] else null,
                createdAt = createdAt,
                updatedAt = createdAt,
            )
        }
        return out
    }
}
