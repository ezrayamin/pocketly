package com.margelo.nitro.pocketly.corekmp

import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.domain.AmountCheck as KAmountCheck
import com.pocketly.shared.domain.BalanceCheck as KBalanceCheck
import com.pocketly.shared.domain.Category as KCategory
import com.pocketly.shared.domain.CategoryTotal as KCategoryTotal
import com.pocketly.shared.domain.Contact as KContact
import com.pocketly.shared.domain.ContactSearchResult as KContactSearch
import com.pocketly.shared.domain.Counterparty as KCounterparty
import com.pocketly.shared.domain.CounterpartyKind as KCounterpartyKind
import com.pocketly.shared.domain.DatasetConfig as KDatasetConfig
import com.pocketly.shared.domain.DayTotal as KDayTotal
import com.pocketly.shared.domain.ErrorCode as KErrorCode
import com.pocketly.shared.domain.IngestResult as KIngestResult
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.MoneyParseResult as KMoneyParseResult
import com.pocketly.shared.domain.AuthState as KAuthState
import com.pocketly.shared.domain.OtpSendResult as KOtpSendResult
import com.pocketly.shared.domain.OtpVerifyResult as KOtpVerifyResult
import com.pocketly.shared.domain.PhoneCheck as KPhoneCheck
import com.pocketly.shared.domain.BiometricEnableResult as KBiometricEnableResult
import com.pocketly.shared.domain.BiometricPromptText as KBiometricPromptText
import com.pocketly.shared.domain.BiometricStatus as KBiometricStatus
import com.pocketly.shared.domain.BiometricUnlockResult as KBiometricUnlockResult
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
import com.pocketly.shared.domain.TransferAuth as KTransferAuth
import com.pocketly.shared.domain.TransferAuthMethod as KTransferAuthMethod
import com.pocketly.shared.domain.TransferDraft as KTransferDraft
import com.pocketly.shared.domain.TransferResult as KTransferResult
import com.pocketly.shared.domain.TransferReview as KTransferReview
import com.pocketly.shared.domain.TxFilter as KTxFilter
import com.pocketly.shared.domain.Wallet as KWallet

// Domain (com.pocketly.shared.domain, "K*") ⇄ Nitro structs (this package).
// Enum constants share names across both sides (they come from the same TS string unions).

// ── JS → Kotlin ─────────────────────────────────────────────────────────────

internal fun DatasetSeed.toDomain() = KDatasetConfig(
    seed = BridgeConversions.toIntExact(seed, "seed"),
    transactionCount = BridgeConversions.toIntExact(transactionCount, "transactionCount"),
    nowMillis = nowMillis?.let { BridgeConversions.toLongExact(it, "nowMillis") },
)

internal fun NetworkSimulation.toDomain() = KNetworkSimulation(
    mode = KNetworkMode.valueOf(mode.name),
    failureRatePercent = BridgeConversions.toIntExact(failureRatePercent, "failureRatePercent"),
    normalLatencyMs = normalLatencyMs?.let { BridgeConversions.toIntExact(it, "normalLatencyMs") } ?: 0,
    readTimeoutMs = readTimeoutMs?.let { BridgeConversions.toIntExact(it, "readTimeoutMs") } ?: 10_000,
    seed = seed?.let { BridgeConversions.toIntExact(it, "seed") } ?: 1,
    writeTimeoutMs = writeTimeoutMs?.let { BridgeConversions.toIntExact(it, "writeTimeoutMs") } ?: 15_000,
)

internal fun KNetworkSimulation.toNitro() = NetworkSimulation(
    mode = NetworkMode.valueOf(mode.name),
    failureRatePercent = failureRatePercent.toDouble(),
    normalLatencyMs = normalLatencyMs.toDouble(),
    readTimeoutMs = readTimeoutMs.toDouble(),
    writeTimeoutMs = writeTimeoutMs.toDouble(),
    seed = seed.toDouble(),
)

internal fun TransferAuth.toDomain() = KTransferAuth(KTransferAuthMethod.valueOf(method.name), pin, prompt?.toDomain())

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

internal fun KMoneyParseResult.toNitro() = MoneyParseResult(
    ok = ok,
    minor = minor?.minor?.toDouble(),
    error = error?.let { MoneyParseError.valueOf(it.name) },
)

internal fun KPinCheck.toNitro() = PinCheck(ok, reason?.let { PinRejectReason.valueOf(it.name) })

internal fun KUnlockResult.toNitro() =
    UnlockResult(UnlockOutcome.valueOf(outcome.name), attemptsLeft.toDouble(), lockedUntil?.toDouble())

internal fun KAuthState.toNitro() = AuthState(phone, pinSet, failedAttempts.toDouble(), lockedUntil?.toDouble())

internal fun KPhoneCheck.toNitro() = PhoneCheck(ok, e164, reason?.let { PhoneRejectReason.valueOf(it.name) })

internal fun KOtpSendResult.toNitro() = OtpSendResult(OtpSendOutcome.valueOf(outcome.name), resendAt.toDouble())

internal fun KOtpVerifyResult.toNitro() =
    OtpVerifyResult(OtpVerifyOutcome.valueOf(outcome.name), attemptsLeft?.toDouble(), retryAt?.toDouble())

internal fun KBiometricStatus.toNitro() = BiometricStatus(
    available,
    reason?.let { BiometricUnavailableReason.valueOf(it.name) },
    kind?.let { BiometricKind.valueOf(it.name) },
    enabled,
)

internal fun BiometricPromptText.toDomain() = KBiometricPromptText(title, subtitle, cancel)

internal fun KBiometricEnableResult.toNitro() =
    BiometricEnableResult(BiometricEnableOutcome.valueOf(outcome.name), attemptsLeft?.toDouble(), lockedUntil?.toDouble())

internal fun KBiometricUnlockResult.toNitro() = BiometricUnlockResult(BiometricUnlockOutcome.valueOf(outcome.name), pinLockedOut)

internal fun KPriceTick.toNitro() = PriceTick(symbol, price.minor.toDouble(), changeBps.toDouble(), seq.toDouble())

// ── P2P transfer (F5, ADR-0014) ─────────────────────────────────────────────

private fun KContact.toNitro() = Contact(userId, name, phone)

internal fun KContactSearch.toNitro() = ContactSearch(
    recent = Array(recent.size) { recent[it].toNitro() },
    contacts = Array(contacts.size) { contacts[it].toNitro() },
    phoneLookup = phoneLookup?.let { PhoneLookup.valueOf(it.name) },
)

internal fun KTransferDraft.toNitro() = TransferDraft(
    recipient.toNitro(),
    balance.minor.toDouble(),
    dailyRemaining.minor.toDouble(),
    minAmount.minor.toDouble(),
    maxAmount.minor.toDouble(),
)

internal fun KAmountCheck.toNitro() = AmountCheck(
    ok = ok,
    minor = minor?.minor?.toDouble(),
    reason = reason?.let { AmountRejectReason.valueOf(it.name) },
    acceptInput = acceptInput,
    remainingBalance = remainingBalance?.minor?.toDouble(),
)

internal fun KTransferReview.toNitro() = TransferReview(
    id, idempotencyKey, recipient.toNitro(), amount.minor.toDouble(), fee.minor.toDouble(), note, balanceAfter.minor.toDouble(),
)

internal fun KTransferResult.toNitro() = TransferResult(
    id = id,
    state = TransferState.valueOf(state.name),
    auth = TransferAuthOutcome.valueOf(auth.name),
    transaction = transaction?.toNitro(),
    failureReason = failureReason?.let { ErrorCode.valueOf(it.name) },
    retryable = retryable,
    attemptsLeft = attemptsLeft?.toDouble(),
    lockedUntil = lockedUntil?.toDouble(),
    balance = balance?.minor?.toDouble(),
)
