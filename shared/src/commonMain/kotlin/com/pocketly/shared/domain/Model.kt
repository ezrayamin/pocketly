package com.pocketly.shared.domain

// Entities (requirements §3.1). Mirrors packages/core-contract/src/types.ts; enum
// constant names are the exact strings used on the JS side.

enum class TransactionType { TRANSFER_OUT, TRANSFER_IN, TOP_UP, QR_PAYMENT }

enum class TransactionStatus { PENDING, SUCCESS, FAILED, REVERSED }

enum class Category { FOOD, TRANSPORT, SHOPPING, BILLS, ENTERTAINMENT, TRANSFER, TOP_UP }

enum class CounterpartyKind { USER, MERCHANT, PAYMENT_METHOD }

data class Counterparty(
    val kind: CounterpartyKind,
    val id: String,
    val name: String,
    val phone: String? = null,
)

data class Contact(val userId: String, val name: String, val phone: String)

data class Wallet(
    val id: String,
    val balance: Money,
    val dailyLimit: Money,
    val usedToday: Money,
    val updatedAt: EpochMillis,
)

data class Transaction(
    val id: String,
    val idempotencyKey: String,
    val type: TransactionType,
    val category: Category,
    val amount: Money,
    val counterparty: Counterparty?,
    val note: String?,
    val status: TransactionStatus,
    val failureReason: ErrorCode?,
    val createdAt: EpochMillis,
    val updatedAt: EpochMillis,
)

data class TransactionPage(val items: List<Transaction>, val nextCursor: String?)

data class TxFilter(
    val types: List<TransactionType>? = null,
    val statuses: List<TransactionStatus>? = null,
)

data class CategoryTotal(val category: Category, val total: Money, val count: Int)

data class DayTotal(val date: String, val spent: Money, val income: Money)

data class BalanceCheck(val ledgerBalance: Money, val walletBalance: Money, val consistent: Boolean)

data class SpendingSummary(
    val month: String,
    val totalSpent: Money,
    val totalIncome: Money,
    val net: Money,
    val transactionCount: Int,
    val byCategory: List<CategoryTotal>,
    val byDay: List<DayTotal>,
    val balanceCheck: BalanceCheck,
)

enum class IngestRejectReason {
    INVALID_SHAPE,
    INVALID_ID,
    INVALID_TYPE,
    INVALID_CATEGORY,
    INVALID_AMOUNT,
    INVALID_STATUS,
    INVALID_FAILURE_REASON,
    INVALID_TIMESTAMP,
    INVALID_COUNTERPARTY,
    INVALID_NOTE,
}

data class IngestError(val index: Int, val reason: IngestRejectReason)

data class IngestResult(
    val accepted: Int,
    val rejected: Int,
    val duplicates: Int,
    val errors: List<IngestError>,
) {
    companion object {
        const val MAX_ERRORS = 20
    }
}

enum class MoneyParseError { EMPTY, NEGATIVE, TOO_MANY_DECIMALS, INVALID_FORMAT, OUT_OF_RANGE }

data class MoneyParseResult(val minor: Money?, val error: MoneyParseError?) {
    val ok: Boolean get() = error == null

    /** `minor` unwrapped for Swift: a nullable value class is exported as an opaque `id`. */
    val minorUnits: Long? get() = minor?.minor

    companion object {
        fun ok(minor: Money) = MoneyParseResult(minor, null)
        fun error(error: MoneyParseError) = MoneyParseResult(null, error)
    }
}

data class PriceTick(val symbol: String, val price: Money, val changeBps: Int, val seq: Int)

data class DatasetConfig(val seed: Int, val transactionCount: Int, val nowMillis: EpochMillis) {
    companion object {
        /** FR-FAKE-01. Same as DEFAULT_DATASET in core-contract. 2026-10-01T12:00:00Z. */
        val DEFAULT = DatasetConfig(seed = 42, transactionCount = 200, nowMillis = 1_790_856_000_000L)
    }
}
