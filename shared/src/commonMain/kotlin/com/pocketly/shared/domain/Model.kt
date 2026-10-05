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

/** Data from the local replica because the server was unreachable (ADR-0009). */
data class StaleInfo(val reason: ErrorCode, val cachedAt: EpochMillis)

data class Wallet(
    val id: String,
    val balance: Money,
    val dailyLimit: Money,
    val usedToday: Money,
    val updatedAt: EpochMillis,
    val stale: StaleInfo? = null,
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

data class TransactionPage(val items: List<Transaction>, val nextCursor: String?, val stale: StaleInfo? = null)

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

/**
 * [nowMillis] set = the fake backend's clock is frozen there (tests, golden, benchmarks);
 * null = it follows the device clock (the app). Mirrors core-contract's DatasetConfig.
 */
data class DatasetConfig(
    val seed: Int,
    val transactionCount: Int,
    val nowMillis: EpochMillis?,
    /** Extra server seed rows (tests, demos); validated like ingest input. */
    val extraTransactions: List<Transaction> = emptyList(),
) {
    companion object {
        /** FR-FAKE-01, frozen at 2026-10-01T12:00:00Z. Same as DEFAULT_DATASET. */
        val DEFAULT = DatasetConfig(seed = 42, transactionCount = 200, nowMillis = 1_790_856_000_000L)

        /** Same data on the device clock: what the app uses. Same as LIVE_DATASET. */
        val LIVE = DatasetConfig(seed = 42, transactionCount = 200, nowMillis = null)
    }
}

/** FR-DEV-02. Mirrors core-contract's NetworkMode. */
enum class NetworkMode { NORMAL, SLOW, ALWAYS_FAIL, TIMEOUT, OFFLINE }

/** FR-DEV-02/03, FR-FAKE-04. Mirrors core-contract's NetworkSimulation. */
data class NetworkSimulation(
    val mode: NetworkMode,
    val failureRatePercent: Int,
    val normalLatencyMs: Int = 0,
    /** Client-side read timeout (NFR-REL-01, ADR-0007). Same default as READ_TIMEOUT_MS. */
    val readTimeoutMs: Int = 10_000,
    val seed: Int = 1,
) {
    companion object {
        val NORMAL = NetworkSimulation(NetworkMode.NORMAL, failureRatePercent = 0)
    }
}
