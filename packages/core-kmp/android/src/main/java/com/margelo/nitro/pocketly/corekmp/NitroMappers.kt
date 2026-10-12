package com.margelo.nitro.pocketly.corekmp

import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.domain.BalanceCheck as KBalanceCheck
import com.pocketly.shared.domain.Category as KCategory
import com.pocketly.shared.domain.CategoryTotal as KCategoryTotal
import com.pocketly.shared.domain.Counterparty as KCounterparty
import com.pocketly.shared.domain.CounterpartyKind as KCounterpartyKind
import com.pocketly.shared.domain.DatasetConfig as KDatasetConfig
import com.pocketly.shared.domain.DayTotal as KDayTotal
import com.pocketly.shared.domain.ErrorCode as KErrorCode
import com.pocketly.shared.domain.IngestResult as KIngestResult
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.MoneyParseResult as KMoneyParseResult
import com.pocketly.shared.domain.AuthState as KAuthState
import com.pocketly.shared.domain.PinCheck as KPinCheck
import com.pocketly.shared.domain.UnlockResult as KUnlockResult
import com.pocketly.shared.domain.NetworkMode as KNetworkMode
import com.pocketly.shared.domain.NetworkSimulation as KNetworkSimulation
import com.pocketly.shared.domain.PriceTick as KPriceTick
import com.pocketly.shared.domain.SpendingSummary as KSpendingSummary
import com.pocketly.shared.domain.StaleInfo as KStaleInfo
import com.pocketly.shared.domain.Transaction as KTransaction
import com.pocketly.shared.domain.TransactionPage as KTransactionPage
import com.pocketly.shared.domain.TransactionStatus as KTransactionStatus
import com.pocketly.shared.domain.TransactionType as KTransactionType
import com.pocketly.shared.domain.TxFilter as KTxFilter
import com.pocketly.shared.domain.Wallet as KWallet

// Domain (com.pocketly.shared.domain, "K*") ⇄ Nitro structs (this package).
// Enum constants share names across both sides (they come from the same TS string unions).

// ── JS → Kotlin ─────────────────────────────────────────────────────────────

internal fun DatasetSeed.toDomain(extraTransactions: Array<Transaction>) = KDatasetConfig(
    seed = BridgeConversions.toIntExact(seed, "seed"),
    transactionCount = BridgeConversions.toIntExact(transactionCount, "transactionCount"),
    nowMillis = nowMillis?.let { BridgeConversions.toLongExact(it, "nowMillis") },
    extraTransactions = extraTransactions.map { it.toDomain() },
)

// Shape only: the fake server validates the values like ingest input (INVALID_ARGUMENT).
private fun Transaction.toDomain() = KTransaction(
    id = id,
    idempotencyKey = idempotencyKey,
    type = KTransactionType.valueOf(type.name),
    category = KCategory.valueOf(category.name),
    amount = Money(BridgeConversions.toLongExact(amount, "amount")),
    counterparty = counterparty?.let { KCounterparty(KCounterpartyKind.valueOf(it.kind.name), it.id, it.name, it.phone) },
    note = note,
    status = KTransactionStatus.valueOf(status.name),
    failureReason = failureReason?.let { KErrorCode.valueOf(it.name) },
    createdAt = BridgeConversions.toLongExact(createdAt, "createdAt"),
    updatedAt = BridgeConversions.toLongExact(updatedAt, "updatedAt"),
)

internal fun NetworkSimulation.toDomain() = KNetworkSimulation(
    mode = KNetworkMode.valueOf(mode.name),
    failureRatePercent = BridgeConversions.toIntExact(failureRatePercent, "failureRatePercent"),
    normalLatencyMs = normalLatencyMs?.let { BridgeConversions.toIntExact(it, "normalLatencyMs") } ?: 0,
    readTimeoutMs = readTimeoutMs?.let { BridgeConversions.toIntExact(it, "readTimeoutMs") } ?: 10_000,
    seed = seed?.let { BridgeConversions.toIntExact(it, "seed") } ?: 1,
)

internal fun KNetworkSimulation.toNitro() = NetworkSimulation(
    mode = NetworkMode.valueOf(mode.name),
    failureRatePercent = failureRatePercent.toDouble(),
    normalLatencyMs = normalLatencyMs.toDouble(),
    readTimeoutMs = readTimeoutMs.toDouble(),
    seed = seed.toDouble(),
)

internal fun TxFilter.toDomain() = KTxFilter(
    types = types?.map { KTransactionType.valueOf(it.name) },
    statuses = statuses?.map { KTransactionStatus.valueOf(it.name) },
)

// ── Kotlin → JS ─────────────────────────────────────────────────────────────

private fun KStaleInfo.toNitro() = StaleInfo(ErrorCode.valueOf(reason.name), cachedAt.toDouble())

internal fun KWallet.toNitro() = Wallet(
    id = id,
    balance = balance.minor.toDouble(),
    dailyLimit = dailyLimit.minor.toDouble(),
    usedToday = usedToday.minor.toDouble(),
    updatedAt = updatedAt.toDouble(),
    stale = stale?.toNitro(),
)

internal fun KCounterparty.toNitro() = Counterparty(
    kind = CounterpartyKind.valueOf(kind.name),
    id = id,
    name = name,
    phone = phone,
)

internal fun KTransaction.toNitro() = Transaction(
    id = id,
    idempotencyKey = idempotencyKey,
    type = TransactionType.valueOf(type.name),
    category = Category.valueOf(category.name),
    amount = amount.minor.toDouble(),
    counterparty = counterparty?.toNitro(),
    note = note,
    status = TransactionStatus.valueOf(status.name),
    failureReason = failureReason?.let { ErrorCode.valueOf(it.name) },
    createdAt = createdAt.toDouble(),
    updatedAt = updatedAt.toDouble(),
)

internal fun KTransactionPage.toNitro() = TransactionPage(
    items = Array(items.size) { items[it].toNitro() },
    nextCursor = nextCursor,
    stale = stale?.toNitro(),
)

private fun KCategoryTotal.toNitro() =
    CategoryTotal(Category.valueOf(category.name), total.minor.toDouble(), count.toDouble())

private fun KDayTotal.toNitro() = DayTotal(date, spent.minor.toDouble(), income.minor.toDouble())

private fun KBalanceCheck.toNitro() =
    BalanceCheck(ledgerBalance.minor.toDouble(), walletBalance.minor.toDouble(), consistent)

internal fun KSpendingSummary.toNitro() = SpendingSummary(
    month = month,
    totalSpent = totalSpent.minor.toDouble(),
    totalIncome = totalIncome.minor.toDouble(),
    net = net.minor.toDouble(),
    transactionCount = transactionCount.toDouble(),
    byCategory = Array(byCategory.size) { byCategory[it].toNitro() },
    byDay = Array(byDay.size) { byDay[it].toNitro() },
    balanceCheck = balanceCheck.toNitro(),
)

internal fun KIngestResult.toNitro() = IngestResult(
    accepted = accepted.toDouble(),
    rejected = rejected.toDouble(),
    duplicates = duplicates.toDouble(),
    errors = Array(errors.size) { IngestError(errors[it].index.toDouble(), IngestRejectReason.valueOf(errors[it].reason.name)) },
)

internal fun KMoneyParseResult.toNitro() = MoneyParseResult(
    ok = ok,
    minor = minor?.minor?.toDouble(),
    error = error?.let { MoneyParseError.valueOf(it.name) },
)

internal fun KPinCheck.toNitro() = PinCheck(ok, reason?.let { PinRejectReason.valueOf(it.name) })

internal fun KUnlockResult.toNitro() =
    UnlockResult(UnlockOutcome.valueOf(outcome.name), attemptsLeft.toDouble(), lockedUntil?.toDouble())

internal fun KAuthState.toNitro() = AuthState(pinSet, failedAttempts.toDouble(), lockedUntil?.toDouble())

internal fun KPriceTick.toNitro() = PriceTick(symbol, price.minor.toDouble(), changeBps.toDouble(), seq.toDouble())
