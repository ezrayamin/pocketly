package com.pocketly.shared.data

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.EpochMillis
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Ledger
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.UtcCalendar

/**
 * Local transaction cache (FR-HIST-04). In-memory for now; the SQLDelight-backed
 * implementation comes with the BM-04 storage work (BM-PAR-03, ADR-0004).
 * Mirrors packages/core-js/src/data/transactionStore.ts.
 */
internal interface TransactionStore {
    fun replaceAll(transactions: List<Transaction>, nowMillis: EpochMillis)

    /** Inserts and re-sorts. Callers must have filtered out existing ids. */
    fun insertAll(transactions: List<Transaction>)
    fun has(id: String): Boolean
    fun get(id: String): Transaction?

    /** Newest first. */
    fun all(): List<Transaction>
    fun page(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage
    fun balance(): Money
    fun usedToday(): Money
}

internal class InMemoryTransactionStore : TransactionStore {
    private val items = ArrayList<Transaction>()
    private val byId = HashMap<String, Transaction>()
    private var runningBalance = 0L
    private var runningUsedToday = 0L
    private var dayStart = 0L

    override fun replaceAll(transactions: List<Transaction>, nowMillis: EpochMillis) {
        items.clear()
        byId.clear()
        runningBalance = 0
        runningUsedToday = 0
        dayStart = UtcCalendar.epochDay(nowMillis) * UtcCalendar.MILLIS_PER_DAY
        insertAll(transactions)
    }

    override fun insertAll(transactions: List<Transaction>) {
        for (tx in transactions) {
            items.add(tx)
            byId[tx.id] = tx
            runningBalance += Ledger.effect(tx).minor
            if (tx.createdAt >= dayStart && Ledger.countsTowardDailyLimit(tx)) {
                runningUsedToday += tx.amount.minor
            }
        }
        items.sortWith(NEWEST_FIRST)
    }

    override fun has(id: String) = byId.containsKey(id)

    override fun get(id: String) = byId[id]

    override fun all(): List<Transaction> = items

    override fun balance() = Money(runningBalance)

    override fun usedToday() = Money(runningUsedToday)

    override fun page(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage {
        var index = 0
        if (cursor != null) {
            val match = CURSOR_PATTERN.find(cursor)
            val createdAt = match?.groupValues?.get(1)?.toLongOrNull()
                ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Malformed cursor")
            index = firstAfter(createdAt, match.groupValues[2])
        }

        val page = ArrayList<Transaction>(limit)
        while (index < items.size) {
            val tx = items[index++]
            if (!tx.matches(filter)) continue
            if (page.size == limit) return TransactionPage(page, encodeCursor(page.last()))
            page.add(tx)
        }
        return TransactionPage(page, null)
    }

    /** Binary search: first index whose item sorts strictly after (createdAt, id). */
    private fun firstAfter(createdAt: Long, id: String): Int {
        var lo = 0
        var hi = items.size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            val tx = items[mid]
            val after = tx.createdAt < createdAt || (tx.createdAt == createdAt && tx.id < id)
            if (after) hi = mid else lo = mid + 1
        }
        return lo
    }

    private companion object {
        val CURSOR_PATTERN = Regex("""^(\d+):(.+)$""")

        /** Newest first; ties broken by id descending so the order is total. */
        val NEWEST_FIRST = compareByDescending<Transaction> { it.createdAt }.thenByDescending { it.id }

        fun encodeCursor(tx: Transaction) = "${tx.createdAt}:${tx.id}"

        fun Transaction.matches(filter: TxFilter?): Boolean {
            if (filter == null) return true
            if (!filter.types.isNullOrEmpty() && type !in filter.types) return false
            if (!filter.statuses.isNullOrEmpty() && status !in filter.statuses) return false
            return true
        }
    }
}
