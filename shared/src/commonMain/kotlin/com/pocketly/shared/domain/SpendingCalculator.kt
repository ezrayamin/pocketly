package com.pocketly.shared.domain

/**
 * BM-03: group by category and day, totals, balance check. [range] is the month in the
 * user's time zone (ZonedCalendar); days are local days.
 * Mirrors packages/core-js/src/domain/spendingSummary.ts — same single pass, same maps, same sorts.
 */
internal object SpendingCalculator {
    private class CategoryAcc(var total: Long = 0, var count: Int = 0)
    private class DayAcc(var spent: Long = 0, var income: Long = 0)

    fun compute(month: String, range: ZonedMonth?, transactions: List<Transaction>, walletBalance: Money): SpendingSummary {
        range ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "month must be YYYY-MM, got \"$month\"")

        var totalSpent = 0L
        var totalIncome = 0L
        var transactionCount = 0
        var ledgerBalance = 0L
        val byCategory = HashMap<Category, CategoryAcc>()
        val byDay = HashMap<Long, DayAcc>()

        for (tx in transactions) {
            ledgerBalance += Ledger.effect(tx).minor

            if (tx.createdAt < range.start || tx.createdAt >= range.end) continue
            transactionCount++
            if (tx.status != TransactionStatus.SUCCESS) continue

            val localDay = (tx.createdAt + ZonedCalendar.segmentOffset(range.segments, tx.createdAt))
                .floorDiv(UtcCalendar.MILLIS_PER_DAY)
            val day = byDay.getOrPut(localDay) { DayAcc() }
            val amount = tx.amount.minor
            if (Ledger.isOutgoing(tx.type)) {
                totalSpent += amount
                day.spent += amount
                val cat = byCategory.getOrPut(tx.category) { CategoryAcc() }
                cat.total += amount
                cat.count++
            } else {
                totalIncome += amount
                day.income += amount
            }
        }

        val categories = byCategory.entries
            .map { (category, acc) -> CategoryTotal(category, Money(acc.total), acc.count) }
            .sortedWith(compareByDescending<CategoryTotal> { it.total }.thenBy { it.category.name })
        val days = byDay.entries
            .sortedBy { it.key }
            .map { (key, acc) -> DayTotal(UtcCalendar.isoDate(key), Money(acc.spent), Money(acc.income)) }

        return SpendingSummary(
            month = month,
            totalSpent = Money(totalSpent),
            totalIncome = Money(totalIncome),
            net = Money(totalIncome - totalSpent),
            transactionCount = transactionCount,
            byCategory = categories,
            byDay = days,
            balanceCheck = BalanceCheck(
                ledgerBalance = Money(ledgerBalance),
                walletBalance = walletBalance,
                consistent = ledgerBalance == walletBalance.minor,
            ),
        )
    }
}
