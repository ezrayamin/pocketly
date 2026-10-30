package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.TopUpMethod
import com.pocketly.shared.domain.TopUpPolicy
import com.pocketly.shared.domain.TopUpReview
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferAuth
import com.pocketly.shared.domain.TransferAuthMethod
import com.pocketly.shared.domain.TransferAuthOutcome
import com.pocketly.shared.domain.TransferPolicy
import com.pocketly.shared.domain.TransferState
import com.pocketly.shared.security.MemorySecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * F6 (ADR-0015): the contract suite's "Top-up" block, case for case
 * (packages/core-contract/src/testing/contractSuite.ts). The amount cases are in TopUpServerTest.
 * runBlocking: processing, latencies and timeouts here are real time.
 */
class TopUpContractTest {
    private val fixtures = File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"))
    private val topUp = Json.parseToJsonElement(File(fixtures, "topup.json").readText()).jsonObject
    private val golden = Json.parseToJsonElement(File(fixtures, "golden.json").readText()).jsonObject
    private val startBalance = golden["defaultDataset"]!!.jsonObject["wallet"]!!.jsonObject["balance"]!!.jsonPrimitive.long
    private val keyPattern = Regex(topUp["params"]!!.jsonObject["idempotencyKeyPattern"]!!.jsonPrimitive.content)
    private val bank = Counterparty(CounterpartyKind.PAYMENT_METHOD, "pm-bank", "Bank transfer")
    private val card = Counterparty(CounterpartyKind.PAYMENT_METHOD, "pm-card", "Card")

    /** No processing wait: tests that need one set topUpProcessingMs themselves. */
    private val instant = NetworkSimulation(NetworkMode.NORMAL, 0, topUpProcessingMs = 0)

    private lateinit var core: PocketlyCore

    @OptIn(ExperimentalCoroutinesApi::class)
    @BeforeTest
    fun setUp() = runBlocking {
        core = PocketlyCore.create(JvmDatabaseDrivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), MemorySecureStore(), pinIterations = 1000)
        core.setTimeZone("UTC")
        core.resetData(DatasetConfig.DEFAULT)
        core.resetAuth()
        core.verifyTestPhone()
        core.setPin(PIN)
        core.setNetworkSimulation(instant)
    }

    private suspend fun code(block: suspend () -> Unit): ErrorCode? = try {
        block()
        null
    } catch (e: CoreException) {
        e.code
    }

    private suspend fun balance() = core.getWallet().balance.minor

    private suspend fun reviewed(amount: Long, method: TopUpMethod): TopUpReview = core.reviewTopUp(Money(amount), method)

    private suspend fun readAll(): List<Transaction> {
        val all = mutableListOf<Transaction>()
        var cursor: String? = null
        do {
            val page = core.getTransactions(cursor, 100, null)
            all += page.items
            cursor = page.nextCursor
        } while (cursor != null)
        return all
    }

    // ── amount (FR-TOP-01) ─────────────────────────────────────────────────

    @Test
    fun needsNoDraftAndNoServerAndLeavesATransfersDraftAlone() {
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, 0))
        val check = core.checkTopUpAmount("25")
        assertEquals(Triple(true, 2_500L, null), Triple(check.ok, check.minor?.minor, check.remainingBalance))
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.checkTransferAmount("25") }.code)
    }

    @Test
    fun everyPresetIsAValidAmount() {
        for (preset in TopUpPolicy.PRESETS) {
            val check = core.checkTopUpAmount((preset / 100).toString())
            assertEquals(true to preset, check.ok to check.minor?.minor)
        }
    }

    // ── review (FR-TOP-01/02) ──────────────────────────────────────────────

    @Test
    fun createsTheAttemptAndItsKeyReviewingAgainMakesANewOne() = runBlocking {
        val first = reviewed(5_000, TopUpMethod.BANK_TRANSFER)
        assertEquals(
            TopUpReview(first.idempotencyKey, first.idempotencyKey, TopUpMethod.BANK_TRANSFER, Money(5_000), Money(0), Money(startBalance + 5_000)),
            first,
        )
        assertTrue(keyPattern.matches(first.idempotencyKey))
        val second = reviewed(5_000, TopUpMethod.CARD)
        assertNotEquals(first.idempotencyKey, second.idempotencyKey)
        assertEquals(TopUpMethod.CARD, second.method)
        assertEquals(startBalance, balance()) // nothing sent
    }

    @Test
    fun refusesWhatTheAmountStepRefuses() = runBlocking {
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { reviewed(TopUpPolicy.MIN_AMOUNT - 1, TopUpMethod.BANK_TRANSFER) })
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { reviewed(TopUpPolicy.MAX_AMOUNT + 1, TopUpMethod.CARD) })
        assertNull(code { reviewed(TopUpPolicy.MIN_AMOUNT, TopUpMethod.CARD) })
        assertNull(code { reviewed(TopUpPolicy.MAX_AMOUNT, TopUpMethod.CARD) })
    }

    @Test
    fun hasNoDailyLimitAndNoBalanceCap() = runBlocking {
        core.setDailyLimit(Money(0))
        val review = reviewed(TopUpPolicy.MAX_AMOUNT, TopUpMethod.BANK_TRANSFER)
        assertEquals(TransferState.SUCCESS, core.confirmTransfer(review.id, null).state)
    }

    @Test
    fun offlineTopUpsCantStart() = runBlocking {
        core.getWallet() // cached
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, 0))
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, code { reviewed(5_000, TopUpMethod.BANK_TRANSFER) })
    }

    // ── confirm (FR-TOP-03, ADR-0015 §2) ───────────────────────────────────

    @Test
    fun needsNoAuthAndAddsTheMoneyOnceToTheBalanceAndToHistory() = runBlocking {
        val before = core.getWallet()
        val review = reviewed(5_000, TopUpMethod.BANK_TRANSFER)
        val done = core.confirmTransfer(review.id, null)
        assertEquals(
            listOf(review.id, TransferState.SUCCESS, TransferAuthOutcome.NOT_REQUIRED, startBalance + 5_000),
            listOf(done.id, done.state, done.auth, done.balance?.minor),
        )
        val tx = done.transaction!!
        assertEquals(
            listOf("tup-1", review.idempotencyKey, TransactionType.TOP_UP, Category.TOP_UP, Money(5_000), bank, TransactionStatus.SUCCESS, null),
            listOf(tx.id, tx.idempotencyKey, tx.type, tx.category, tx.amount, tx.counterparty, tx.status, tx.note),
        )
        val after = core.getWallet()
        assertEquals(startBalance + 5_000, after.balance.minor)
        assertEquals(before.usedToday, after.usedToday) // the daily limit counts money leaving only
        assertEquals(tx, core.getTransactions(null, 20, null).items[0])
        // Asking again changes nothing.
        assertEquals(done.copy(balance = null), core.confirmTransfer(review.id, null))
        assertEquals(startBalance + 5_000, balance())
    }

    @Test
    fun aCardTopUpHasTheCardAsItsCounterparty() = runBlocking {
        val review = reviewed(2_500, TopUpMethod.CARD)
        val tx = core.confirmTransfer(review.id, null).transaction!!
        assertEquals("tup-1" to card, tx.id to tx.counterparty)
    }

    @Test
    fun passingAuthIsInvalidArgumentAndSendsNothing() = runBlocking {
        val review = reviewed(5_000, TopUpMethod.BANK_TRANSFER)
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.confirmTransfer(review.id, TransferAuth(TransferAuthMethod.PIN, pin = PIN)) })
        assertEquals(startBalance, balance())
        assertEquals(0, core.getAuthState().failedAttempts)
    }

    @Test
    fun aDoubleTapGetsOneTopUp() = runBlocking {
        val review = reviewed(2_000, TopUpMethod.CARD)
        core.setNetworkSimulation(instant.copy(normalLatencyMs = 50))
        val (a, b) = listOf(async { core.confirmTransfer(review.id, null) }, async { core.confirmTransfer(review.id, null) }).awaitAll()
        assertEquals(a, b)
        assertEquals(TransferState.SUCCESS, a.state)
        assertEquals(startBalance + 2_000, balance())
    }

    @Test
    fun declinedIsFailedWithPaymentDeclinedNotRetryableInHistory() = runBlocking {
        val review = reviewed(2_500, TopUpMethod.CARD)
        core.setNetworkSimulation(instant.copy(declineTopUps = true))
        val declined = core.confirmTransfer(review.id, null)
        assertEquals(
            listOf(TransferState.FAILED, TransferAuthOutcome.NOT_REQUIRED, ErrorCode.PAYMENT_DECLINED, false, startBalance),
            listOf(declined.state, declined.auth, declined.failureReason, declined.retryable, declined.balance?.minor),
        )
        val tx = declined.transaction!!
        assertEquals(listOf("tup-1", TransactionStatus.FAILED, ErrorCode.PAYMENT_DECLINED), listOf(tx.id, tx.status, tx.failureReason))
        core.setNetworkSimulation(instant)
        val again = core.confirmTransfer(review.id, null)
        assertEquals(Triple(TransferState.FAILED, ErrorCode.PAYMENT_DECLINED, false), Triple(again.state, again.failureReason, again.retryable))
        assertEquals(startBalance, balance())
        val first = core.getTransactions(null, 20, null).items[0]
        assertEquals("tup-1" to TransactionStatus.FAILED, first.id to first.status)
    }

    @Test
    fun retryAfterAServerErrorReusesTheKeyAndAppliesOnce() = runBlocking {
        val review = reviewed(3_000, TopUpMethod.BANK_TRANSFER)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.ALWAYS_FAIL, 0))
        val failed = core.confirmTransfer(review.id, null)
        assertEquals(
            listOf(TransferState.FAILED, TransferAuthOutcome.NOT_REQUIRED, ErrorCode.SERVER_ERROR, true),
            listOf(failed.state, failed.auth, failed.failureReason, failed.retryable),
        )
        core.setNetworkSimulation(instant)
        assertEquals(startBalance, balance())
        val retried = core.confirmTransfer(review.id, null)
        assertEquals(TransferState.SUCCESS to TransferAuthOutcome.NOT_REQUIRED, retried.state to retried.auth)
        assertEquals(review.idempotencyKey, retried.transaction!!.idempotencyKey)
        assertEquals(startBalance + 3_000, balance())
    }

    @Test
    fun topUpsAndTransfersAreNumberedSeparatelyAndATransferStillNeedsItsPin() = runBlocking {
        val topUp = reviewed(5_000, TopUpMethod.BANK_TRANSFER)
        assertEquals("tup-1", core.confirmTransfer(topUp.id, null).transaction!!.id)
        core.startTransfer("u-01")
        val transfer = core.reviewTransfer(Money(1_000), null)
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.confirmTransfer(transfer.id, null) })
        assertEquals("trf-1", core.confirmTransfer(transfer.id, TransferAuth(TransferAuthMethod.PIN, pin = PIN)).transaction!!.id)
        assertEquals(startBalance + 5_000 - 1_000, balance())
    }

    // ── processing and timeouts (FR-TOP-02/03, ADR-0015 §4) ────────────────

    @Test
    fun processingOutlastsWriteTimeoutPendingNotInTheBalanceUntilSettled() = runBlocking {
        val review = reviewed(4_000, TopUpMethod.CARD)
        core.getWallet()
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, topUpProcessingMs = 300, writeTimeoutMs = 100))
        val pending = core.confirmTransfer(review.id, null)
        assertEquals(
            listOf(TransferState.PENDING, TransferAuthOutcome.NOT_REQUIRED, startBalance),
            listOf(pending.state, pending.auth, pending.balance?.minor),
        )
        assertEquals(
            listOf("local-${review.idempotencyKey}", TransactionStatus.PENDING, TransactionType.TOP_UP, 4_000L),
            pending.transaction!!.let { listOf(it.id, it.status, it.type, it.amount.minor) },
        )

        // Still processing: the server has it as PENDING, so the check doesn't start a second charge.
        val processing = core.getTransferStatus(review.id)
        assertEquals(TransferState.PENDING, processing.state)
        assertEquals("tup-1" to TransactionStatus.PENDING, processing.transaction!!.id to processing.transaction!!.status)
        assertEquals(startBalance, balance())

        delay(350)
        val settled = core.getTransferStatus(review.id)
        assertEquals(
            listOf(TransferState.SUCCESS, TransferAuthOutcome.NOT_REQUIRED, startBalance + 4_000),
            listOf(settled.state, settled.auth, settled.balance?.minor),
        )
        assertEquals("tup-1", settled.transaction!!.id)
        assertEquals(listOf("tup-1"), readAll().filter { it.idempotencyKey == review.idempotencyKey }.map { it.id })
        assertEquals(startBalance + 4_000, balance())
    }

    @Test
    fun timeoutModeHeldByTheServerSettledLater() = runBlocking {
        val review = reviewed(6_000, TopUpMethod.BANK_TRANSFER)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 0, readTimeoutMs = 100, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, null).state)
        assertEquals(ErrorCode.NETWORK_TIMEOUT, code { core.getTransferStatus(review.id) })
        core.setNetworkSimulation(instant)
        val held = core.getTransferStatus(review.id)
        assertEquals(TransferState.PENDING, held.state)
        assertEquals("tup-1" to TransactionStatus.PENDING, held.transaction!!.id to held.transaction!!.status)
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransferState.SUCCESS, core.getTransferStatus(review.id).state)
        assertEquals(startBalance + 6_000, balance())
    }

    @Test
    fun aHeldTopUpKeepsTheDeclineItArrivedWith() = runBlocking {
        val review = reviewed(6_000, TopUpMethod.CARD)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 0, writeTimeoutMs = 100, declineTopUps = true))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, null).state)
        core.setNetworkSimulation(instant) // decline off again: the held row already carries it
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        val failed = core.getTransferStatus(review.id)
        assertEquals(
            listOf(TransferState.FAILED, ErrorCode.PAYMENT_DECLINED, false, startBalance),
            listOf(failed.state, failed.failureReason, failed.retryable, failed.balance?.minor),
        )
        assertEquals(startBalance, balance())
    }

    @Test
    fun aHeldTopUpThatFailsSettlesFailedWithServerErrorNotRetryable() = runBlocking {
        val review = reviewed(6_000, TopUpMethod.BANK_TRANSFER)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 100, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, null).state)
        core.setNetworkSimulation(instant)
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        val failed = core.getTransferStatus(review.id)
        assertEquals(
            listOf(TransferState.FAILED, ErrorCode.SERVER_ERROR, false, startBalance),
            listOf(failed.state, failed.failureReason, failed.retryable, failed.balance?.minor),
        )
    }

    @Test
    fun logoutForgetsEveryAttempt() = runBlocking {
        val review = reviewed(5_000, TopUpMethod.BANK_TRANSFER)
        core.logout()
        assertEquals(ErrorCode.NOT_FOUND, code { core.confirmTransfer(review.id, null) })
    }

    private companion object {
        const val PIN = "482915"
    }
}
