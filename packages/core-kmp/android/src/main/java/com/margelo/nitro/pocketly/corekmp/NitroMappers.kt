package com.margelo.nitro.pocketly.corekmp

import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.domain.BalanceCheck as KBalanceCheck
import com.pocketly.shared.domain.CategoryTotal as KCategoryTotal
import com.pocketly.shared.domain.Counterparty as KCounterparty
import com.pocketly.shared.domain.DatasetConfig as KDatasetConfig
import com.pocketly.shared.domain.DayTotal as KDayTotal
import com.pocketly.shared.domain.IngestResult as KIngestResult
import com.pocketly.shared.domain.MoneyParseResult as KMoneyParseResult
import com.pocketly.shared.domain.PriceTick as KPriceTick
import com.pocketly.shared.domain.SpendingSummary as KSpendingSummary
import com.pocketly.shared.domain.Transaction as KTransaction
import com.pocketly.shared.domain.TransactionPage as KTransactionPage
import com.pocketly.shared.domain.TransactionStatus as KTransactionStatus
import com.pocketly.shared.domain.TransactionType as KTransactionType
import com.pocketly.shared.domain.TxFilter as KTxFilter
import com.pocketly.shared.domain.Wallet as KWallet

// Domain (com.pocketly.shared.domain, "K*") ⇄ Nitro structs (this package).
// Enum constants share names across both sides (they come from the same TS string unions).

// ── JS → Kotlin ─────────────────────────────────────────────────────────────

internal fun DatasetConfig.toDomain() = KDatasetConfig(
    seed = BridgeConversions.toIntExact(seed, "seed"),
    transactionCount = BridgeConversions.toIntExact(transactionCount, "transactionCount"),
    nowMillis = BridgeConversions.toLongExact(nowMillis, "nowMillis"),
)

internal fun TxFilter.toDomain() = KTxFilter(
    types = types?.map { KTransactionType.valueOf(it.name) },
    statuses = statuses?.map { KTransactionStatus.valueOf(it.name) },
)

// ── Kotlin → JS ─────────────────────────────────────────────────────────────

internal fun KWallet.toNitro() = Wallet(
    id = id,
    balance = balance.minor.toDouble(),
    dailyLimit = dailyLimit.minor.toDouble(),
    usedToday = usedToday.minor.toDouble(),
    updatedAt = updatedAt.toDouble(),
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

internal fun KPriceTick.toNitro() = PriceTick(symbol, price.minor.toDouble(), changeBps.toDouble(), seq.toDouble())
