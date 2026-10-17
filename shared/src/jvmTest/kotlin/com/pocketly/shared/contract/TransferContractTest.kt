package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.AmountRejectReason
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.PhoneLookup
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferAuth
import com.pocketly.shared.domain.TransferAuthMethod
import com.pocketly.shared.domain.TransferAuthOutcome
import com.pocketly.shared.domain.TransferPolicy
import com.pocketly.shared.domain.TransferResult
import com.pocketly.shared.domain.TransferReview
import com.pocketly.shared.domain.TransferState
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.security.MemorySecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
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
 * F5 (ADR-0014): the contract suite's "P2P transfer" block, case for case
 * (packages/core-contract/src/testing/contractSuite.ts). runBlocking: latencies and timeouts
 * here are real time.
 */
class TransferContractTest {
    private val fixtures = File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"))
    private val transfer = Json.parseToJsonElement(File(fixtures, "transfer.json").readText()).jsonObject
    private val golden = Json.parseToJsonElement(File(fixtures, "golden.json").readText()).jsonObject
    private val start = golden["defaultDataset"]!!.jsonObject["wallet"]!!.jsonObject
    private val startBalance = start["balance"]!!.jsonPrimitive.long
    private val startUsed = start["usedToday"]!!.jsonPrimitive.long
    private val directory = transfer["directory"]!!.jsonArray.map {
        val o = it.jsonObject
        Contact(o["userId"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, o["phone"]!!.jsonPrimitive.content)
    }
    private val keyPattern = Regex(transfer["params"]!!.jsonObject["idempotencyKeyPattern"]!!.jsonPrimitive.content)
    private val pinAuth = TransferAuth(TransferAuthMethod.PIN, pin = PIN)

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
    }

    private suspend fun code(block: suspend () -> Unit): ErrorCode? = try {
        block()
        null
    } catch (e: CoreException) {
        e.code
    }

    private suspend fun balance() = core.getWallet().balance.minor

    private suspend fun reviewed(amount: Long = 15_000, recipientId: String = "u-01", note: String? = null): TransferReview {
        core.startTransfer(recipientId)
        return core.reviewTransfer(Money(amount), note)
    }

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

    // ── recipient (FR-TRF-01) ──────────────────────────────────────────────

    @Test
    fun listsRecentRecipientsFromHistoryAndTheWholeDirectory() = runBlocking {
        val result = core.searchContacts("")
        val recent = readAll()
            .filter { it.type == TransactionType.TRANSFER_OUT && it.status in setOf(TransactionStatus.SUCCESS, TransactionStatus.PENDING) && it.counterparty?.kind == CounterpartyKind.USER }
            .map { Contact(it.counterparty!!.id, it.counterparty!!.name, it.counterparty!!.phone!!) }
            .distinctBy { it.userId }
        assertEquals(recent.take(TransferPolicy.RECENT_CONTACTS_LIMIT), result.recent)
        assertEquals(directory, result.contacts)
        assertNull(result.phoneLookup)
    }

    @Test
    fun searchesByNameOrPhoneAndTellsATypedNumberApart() = runBlocking {
        assertEquals(listOf("u-01"), core.searchContacts("andi").contacts.map { it.userId })
        val found = core.searchContacts("+62 812-3456-7781")
        assertEquals(Triple(emptyList(), listOf(directory[0]), PhoneLookup.FOUND), Triple(found.recent, found.contacts, found.phoneLookup))
        val nobody = core.searchContacts("+62 899-0000-1234")
        assertEquals(Triple(emptyList<Contact>(), emptyList(), PhoneLookup.NOT_FOUND), Triple(nobody.recent, nobody.contacts, nobody.phoneLookup))
        assertEquals(PhoneLookup.SELF, core.searchContacts("081234567890").phoneLookup)
    }

    @Test
    fun neverOffersOrSendsToThisInstallsOwnPhone() = runBlocking {
        core.resetAuth()
        core.verifyTestPhone(directory[0].phone) // this install is Andi
        val all = core.searchContacts("")
        assertTrue("u-01" !in all.contacts.map { it.userId })
        assertTrue("u-01" !in all.recent.map { it.userId })
        assertEquals(PhoneLookup.SELF, core.searchContacts(directory[0].phone).phoneLookup)
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.startTransfer("u-01") })
    }

    @Test
    fun anUnknownRecipientIsRecipientNotFound() = runBlocking {
        assertEquals(ErrorCode.RECIPIENT_NOT_FOUND, code { core.startTransfer("u-99") })
    }

    @Test
    fun offlineTransfersCantStart() = runBlocking {
        core.getWallet()
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, 0))
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, code { core.searchContacts("") })
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, code { core.startTransfer("u-01") })
    }

    // ── amount and review (FR-TRF-02/03/05/10) ─────────────────────────────

    @Test
    fun aDraftCarriesFreshLimitsAndAmountsAreCheckedAgainstThem() = runBlocking {
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.checkTransferAmount("10") }.code)
        val draft = core.startTransfer("u-01")
        val remaining = TransferPolicy.DEFAULT_DAILY_LIMIT - startUsed
        assertEquals(directory[0], draft.recipient)
        assertEquals(listOf(startBalance, remaining, TransferPolicy.MIN_AMOUNT, remaining), listOf(draft.balance, draft.dailyRemaining, draft.minAmount, draft.maxAmount).map { it.minor })
        val ok = core.checkTransferAmount("150")
        assertEquals(listOf(true, 15_000L, true, startBalance - 15_000), listOf(ok.ok, ok.minor?.minor, ok.acceptInput, ok.remainingBalance?.minor))
        assertEquals(AmountRejectReason.DAILY_LIMIT_EXCEEDED, core.checkTransferAmount("5000").reason)
        val typo = core.checkTransferAmount("1.234")
        assertEquals(AmountRejectReason.TOO_MANY_DECIMALS to false, typo.reason to typo.acceptInput)
    }

    @Test
    fun startingATransferWaitsForOneBackendRoundTripNotTwo() = runBlocking {
        core.getAuthState()
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, normalLatencyMs = 200))
        val started = System.currentTimeMillis()
        core.startTransfer("u-01")
        assertTrue(System.currentTimeMillis() - started < 350, "sequential would be ≥ 400 ms") // calls in parallel
    }

    @Test
    fun theDeveloperMenusDailyLimitAppliesAtTheAmountStep() = runBlocking {
        core.setDailyLimit(Money(10_000))
        assertEquals(10_000 - startUsed, core.startTransfer("u-02").dailyRemaining.minor)
        assertEquals(AmountRejectReason.DAILY_LIMIT_EXCEEDED, core.checkTransferAmount("100").reason)
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.setDailyLimit(Money(-1)) })
        core.resetData(DatasetConfig.DEFAULT)
        assertEquals(TransferPolicy.DEFAULT_DAILY_LIMIT, core.getWallet().dailyLimit.minor)
    }

    @Test
    fun reviewCreatesTheAttemptAndItsKeyReviewingAgainMakesANewOne() = runBlocking {
        val first = reviewed(15_000, "u-01", "  Dinner  ")
        assertEquals(TransferReview(first.idempotencyKey, first.idempotencyKey, directory[0], Money(15_000), Money(0), "Dinner", Money(startBalance - 15_000)), first)
        assertTrue(keyPattern.matches(first.idempotencyKey))
        val second = core.reviewTransfer(Money(15_000), null)
        assertNotEquals(first.idempotencyKey, second.idempotencyKey)
        assertNull(second.note)
        assertEquals(startBalance, balance())
    }

    @Test
    fun reviewRefusesWhatTheAmountStepRefuses() = runBlocking {
        core.startTransfer("u-01")
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.reviewTransfer(Money(99), null) })
        assertEquals(ErrorCode.INSUFFICIENT_FUNDS, code { core.reviewTransfer(Money(startBalance + 1), null) })
        assertEquals(ErrorCode.DAILY_LIMIT_EXCEEDED, code { core.reviewTransfer(Money(TransferPolicy.DEFAULT_DAILY_LIMIT), null) })
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.reviewTransfer(Money(1_000), "two\nlines") })
    }

    @Test
    fun reviewNeedsADraft() = runBlocking {
        assertEquals(ErrorCode.NOT_FOUND, code { core.reviewTransfer(Money(1_000), null) })
    }

    // ── confirm (FR-TRF-04..08) ────────────────────────────────────────────

    @Test
    fun aWrongPinSendsNothingAndCountsTheRightOneSendsOnce() = runBlocking {
        val review = reviewed(15_000, "u-01", "Dinner")
        val wrong = core.confirmTransfer(review.id, TransferAuth(TransferAuthMethod.PIN, pin = BAD_PIN))
        assertEquals(TransferResult(review.id, TransferState.DRAFT, TransferAuthOutcome.WRONG_PIN, attemptsLeft = 4), wrong)
        assertEquals(startBalance, balance())

        val sent = core.confirmTransfer(review.id, pinAuth)
        assertEquals(listOf(TransferState.SUCCESS, TransferAuthOutcome.OK, startBalance - 15_000), listOf(sent.state, sent.auth, sent.balance?.minor))
        val tx = sent.transaction!!
        assertEquals(listOf("trf-1", review.idempotencyKey, TransactionType.TRANSFER_OUT, 15_000L, "u-01", "Dinner", TransactionStatus.SUCCESS),
            listOf(tx.id, tx.idempotencyKey, tx.type, tx.amount.minor, tx.counterparty?.id, tx.note, tx.status))
        assertEquals(0, core.getAuthState().failedAttempts)
        assertEquals(startBalance - 15_000, balance())
        assertEquals(tx, core.getTransactions(null, 20, null).items.first())
        assertEquals(sent.copy(auth = TransferAuthOutcome.NOT_REQUIRED, balance = null), core.confirmTransfer(review.id, null))
        assertEquals(startBalance - 15_000, balance())
    }

    @Test
    fun aDoubleTapGetsOneTransfer() = runBlocking {
        val review = reviewed(2_000)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, normalLatencyMs = 50))
        val (a, b) = listOf(async { core.confirmTransfer(review.id, pinAuth) }, async { core.confirmTransfer(review.id, pinAuth) }).awaitAll()
        assertEquals(a, b)
        assertEquals(TransferState.SUCCESS, a.state)
        assertEquals(startBalance - 2_000, balance())
    }

    @Test
    fun needsAuthForANewAttemptAndAKnownId() = runBlocking {
        val review = reviewed()
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.confirmTransfer(review.id, null) })
        assertEquals(ErrorCode.NOT_FOUND, code { core.confirmTransfer("no-such-id", pinAuth) })
        assertEquals(startBalance, balance())
    }

    @Test
    fun retryAfterAServerErrorReusesTheKeyAndAppliesOnce() = runBlocking {
        val review = reviewed(3_000)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.ALWAYS_FAIL, 0))
        val failed = core.confirmTransfer(review.id, pinAuth)
        assertEquals(listOf(TransferState.FAILED, TransferAuthOutcome.OK, ErrorCode.SERVER_ERROR, true), listOf(failed.state, failed.auth, failed.failureReason, failed.retryable))
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
        assertEquals(startBalance, balance())
        val retried = core.confirmTransfer(review.id, null)
        assertEquals(TransferState.SUCCESS to TransferAuthOutcome.NOT_REQUIRED, retried.state to retried.auth)
        assertEquals(review.idempotencyKey, retried.transaction!!.idempotencyKey)
        assertEquals(startBalance - 3_000, balance())
    }

    @Test
    fun aRefusalTheServerRecordedIsFinal() = runBlocking {
        val review = reviewed(5_000)
        core.setDailyLimit(Money(2_000))
        val failed = core.confirmTransfer(review.id, pinAuth)
        assertEquals(listOf(TransferState.FAILED, ErrorCode.DAILY_LIMIT_EXCEEDED, false), listOf(failed.state, failed.failureReason, failed.retryable))
        assertEquals(TransactionStatus.FAILED to ErrorCode.DAILY_LIMIT_EXCEEDED, failed.transaction!!.status to failed.transaction!!.failureReason)
        val again = core.confirmTransfer(review.id, null)
        assertEquals(listOf(TransferState.FAILED, TransferAuthOutcome.NOT_REQUIRED, false), listOf(again.state, again.auth, again.retryable))
        assertEquals(startBalance, balance())
        val top = core.getTransactions(null, 20, null).items.first()
        assertEquals(failed.transaction!!.id to TransactionStatus.FAILED, top.id to top.status)
    }

    @Test
    fun fiveWrongPinsLockOutLikeTheLockScreen() = runBlocking {
        val review = reviewed()
        var last: TransferResult? = null
        repeat(5) { last = core.confirmTransfer(review.id, TransferAuth(TransferAuthMethod.PIN, pin = BAD_PIN)) }
        assertEquals(TransferState.DRAFT to TransferAuthOutcome.PIN_LOCKED_OUT, last!!.state to last!!.auth)
        assertTrue(last!!.lockedUntil!! > 0)
        assertEquals(TransferAuthOutcome.PIN_LOCKED_OUT, core.confirmTransfer(review.id, pinAuth).auth)
        assertEquals(startBalance, balance())
    }

    // ── timeouts (FR-TRF-09, ADR-0007, ADR-0014 §4) ────────────────────────

    @Test
    fun noAnswerWithinWriteTimeoutIsPendingThenTheStatusCheckSettlesIt() = runBlocking {
        val review = reviewed(4_000)
        core.getWallet()
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, normalLatencyMs = 300, writeTimeoutMs = 100))
        val pending = core.confirmTransfer(review.id, pinAuth)
        assertEquals(listOf(TransferState.PENDING, TransferAuthOutcome.OK, startBalance - 4_000), listOf(pending.state, pending.auth, pending.balance?.minor))
        assertEquals(listOf("local-${review.idempotencyKey}", TransactionStatus.PENDING, 4_000L), pending.transaction!!.let { listOf(it.id, it.status, it.amount.minor) })
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, readTimeoutMs = 100))
        val page = core.getTransactions(null, 20, TxFilter(statuses = listOf(TransactionStatus.PENDING)))
        assertTrue(review.idempotencyKey in page.items.map { it.idempotencyKey })

        delay(350)
        val settled = core.getTransferStatus(review.id)
        assertEquals(listOf(TransferState.SUCCESS, TransferAuthOutcome.NOT_REQUIRED, startBalance - 4_000), listOf(settled.state, settled.auth, settled.balance?.minor))
        assertEquals("trf-1", settled.transaction!!.id)
        assertEquals(listOf("trf-1"), readAll().filter { it.idempotencyKey == review.idempotencyKey }.map { it.id })
        assertEquals(startBalance - 4_000, balance())
    }

    @Test
    fun timeoutModeHeldByTheServerSettledLater() = runBlocking {
        val review = reviewed(6_000)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 0, readTimeoutMs = 100, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, pinAuth).state)
        assertEquals(ErrorCode.NETWORK_TIMEOUT, code { core.getTransferStatus(review.id) })
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
        val held = core.getTransferStatus(review.id)
        assertEquals(TransferState.PENDING, held.state)
        assertEquals("trf-1" to TransactionStatus.PENDING, held.transaction!!.id to held.transaction!!.status)
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransferState.SUCCESS, core.getTransferStatus(review.id).state)
        assertEquals(startBalance - 6_000, balance())
    }

    @Test
    fun aHeldTransferThatFailsSettlesFailedNotRetryableAndTheBalanceComesBack() = runBlocking {
        val review = reviewed(6_000)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 100, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, pinAuth).state)
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        val failed = core.getTransferStatus(review.id)
        assertEquals(listOf(TransferState.FAILED, ErrorCode.SERVER_ERROR, false, startBalance), listOf(failed.state, failed.failureReason, failed.retryable, failed.balance?.minor))
        assertEquals(startBalance, balance())
    }

    @Test
    fun theStatusCheckFindsNothingFailedRetryableAndARetryAppliesOnce() = runBlocking {
        val review = reviewed(7_000)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, normalLatencyMs = 400, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, pinAuth).state)
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
        val notThere = core.getTransferStatus(review.id)
        assertEquals(listOf(TransferState.FAILED, ErrorCode.NETWORK_TIMEOUT, true, startBalance), listOf(notThere.state, notThere.failureReason, notThere.retryable, notThere.balance?.minor))
        delay(400)
        val retried = core.confirmTransfer(review.id, null)
        assertEquals(TransferState.SUCCESS to TransferAuthOutcome.NOT_REQUIRED, retried.state to retried.auth)
        assertEquals(startBalance - 7_000, balance())
    }

    @Test
    fun logoutForgetsEveryAttempt() = runBlocking {
        val review = reviewed()
        core.logout()
        assertEquals(ErrorCode.NOT_FOUND, code { core.confirmTransfer(review.id, pinAuth) })
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.checkTransferAmount("10") }.code)
    }

    private companion object {
        const val PIN = "482915"
        const val BAD_PIN = "159260"
    }
}
