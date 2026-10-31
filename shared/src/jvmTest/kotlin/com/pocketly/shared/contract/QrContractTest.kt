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
import com.pocketly.shared.domain.QrCode
import com.pocketly.shared.domain.QrKind
import com.pocketly.shared.domain.QrPaymentReview
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
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * F7, F8 (ADR-0016): the contract suite's "QR Pay & My QR" block, case for case
 * (packages/core-contract/src/testing/contractSuite.ts). The parse cases are in QrServerTest.
 */
class QrContractTest {
    private val fixtures = File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"))
    private val qr = Json.parseToJsonElement(File(fixtures, "qr.json").readText()).jsonObject
    private val golden = Json.parseToJsonElement(File(fixtures, "golden.json").readText()).jsonObject
    private val start = golden["defaultDataset"]!!.jsonObject["wallet"]!!.jsonObject
    private val startBalance = start["balance"]!!.jsonPrimitive.long
    private val startUsed = start["usedToday"]!!.jsonPrimitive.long
    private val keyPattern = Regex(qr["params"]!!.jsonObject["idempotencyKeyPattern"]!!.jsonPrimitive.content)
    private val cornerCoffee = Counterparty(CounterpartyKind.MERCHANT, "m-01", "Corner Coffee")
    private val pinAuth = TransferAuth(TransferAuthMethod.PIN, pin = PIN)
    private val offline = NetworkSimulation(NetworkMode.OFFLINE, 0)
    private val now = DatasetConfig.DEFAULT.nowMillis!!

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

    // ── parseQr (FR-QR-02) ─────────────────────────────────────────────────

    @Test
    fun parsingNeedsNoServer() {
        core.setNetworkSimulation(offline)
        assertTrue(core.parseQr("pocketly://pay/v1?m=m-01").ok)
    }

    // ── paying a merchant (FR-QR-03/04) ────────────────────────────────────

    @Test
    fun staticCodeTheServerNamesTheMerchantTheUserTypesTheAmountThePinApprovesIt() = runBlocking {
        val before = core.getWallet()
        val draft = core.startQrPayment("m-01", null)
        val remaining = TransferPolicy.DEFAULT_DAILY_LIMIT - startUsed
        assertEquals(cornerCoffee, draft.merchant)
        assertEquals(
            listOf(null, null, null, startBalance, remaining, TransferPolicy.MIN_AMOUNT, remaining),
            listOf(draft.requestId, draft.amount, draft.expiresAt, draft.balance.minor, draft.dailyRemaining.minor, draft.minAmount.minor, draft.maxAmount.minor),
        )
        val check = core.checkTransferAmount("12.5")
        assertEquals(true to 1_250L, check.ok to check.minor?.minor)
        val review = core.reviewQrPayment(Money(1_250))
        assertEquals(
            QrPaymentReview(review.idempotencyKey, review.idempotencyKey, cornerCoffee, null, Money(1_250), Money(0), Money(startBalance - 1_250)),
            review,
        )
        assertTrue(keyPattern.matches(review.idempotencyKey))
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.confirmTransfer(review.id, null) }) // money leaves: approval needed

        val paid = core.confirmTransfer(review.id, pinAuth)
        assertEquals(listOf(TransferState.SUCCESS, TransferAuthOutcome.OK, startBalance - 1_250), listOf(paid.state, paid.auth, paid.balance?.minor))
        val tx = paid.transaction!!
        assertEquals(
            listOf("qrp-1", review.idempotencyKey, TransactionType.QR_PAYMENT, Category.FOOD, Money(1_250), cornerCoffee, TransactionStatus.SUCCESS),
            listOf(tx.id, tx.idempotencyKey, tx.type, tx.category, tx.amount, tx.counterparty, tx.status),
        )
        val after = core.getWallet()
        assertEquals(before.balance.minor - 1_250 to before.usedToday.minor + 1_250, after.balance.minor to after.usedToday.minor)
        assertEquals(tx, core.getTransactions(null, 20, null).items[0])
    }

    @Test
    fun dynamicCodeTheAmountIsTheRequestsLockedAndTheCodePaysOnce() = runBlocking {
        val draft = core.startQrPayment("m-01", "pr-0001")
        assertEquals(listOf<Any?>(cornerCoffee, "pr-0001", 1_250L, now + 31_536_000_000), listOf(draft.merchant, draft.requestId, draft.amount?.minor, draft.expiresAt))
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.reviewQrPayment(Money(1_000)) })
        val review = core.reviewQrPayment(Money(1_250))
        assertEquals("pr-0001", review.requestId)
        assertEquals(TransferState.SUCCESS, core.confirmTransfer(review.id, pinAuth).state)
        assertEquals(ErrorCode.QR_ALREADY_PAID, code { core.startQrPayment("m-01", "pr-0001") })
    }

    @Test
    fun aRefusalDoesntUseUpADynamicCode() = runBlocking {
        val draft = core.startQrPayment("m-05", "pr-0004")
        assertEquals(2_000_000L, draft.amount?.minor)
        assertTrue(draft.maxAmount.minor < 2_000_000)
        assertEquals(ErrorCode.INSUFFICIENT_FUNDS, code { core.reviewQrPayment(Money(2_000_000)) })
        assertEquals("pr-0004", core.startQrPayment("m-05", "pr-0004").requestId)
    }

    @Test
    fun lookupErrors() = runBlocking {
        assertEquals(ErrorCode.INVALID_QR, code { core.startQrPayment("m-99", null) })
        assertEquals(ErrorCode.INVALID_QR, code { core.startQrPayment("m-03", "pr-0001") })
        assertEquals(ErrorCode.INVALID_QR, code { core.startQrPayment("m-01", "pr-9999") })
        assertEquals(ErrorCode.QR_EXPIRED, code { core.startQrPayment("m-02", "pr-0002") })
        assertEquals(ErrorCode.QR_ALREADY_PAID, code { core.startQrPayment("m-02", "pr-0003") })
    }

    @Test
    fun offlineQrPaymentsCantStart() = runBlocking {
        core.getWallet()
        core.setNetworkSimulation(offline)
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, code { core.startQrPayment("m-01", null) })
    }

    @Test
    fun oneDraftAtATime() = runBlocking {
        core.startTransfer("u-01")
        core.startQrPayment("m-03", null)
        assertEquals(ErrorCode.NOT_FOUND, code { core.reviewTransfer(Money(1_000), null) })
        core.startTransfer("u-01")
        assertEquals(ErrorCode.NOT_FOUND, code { core.reviewQrPayment(Money(1_000)) })
    }

    @Test
    fun qrPaymentsTransfersAndTopUpsAreNumberedSeparately() = runBlocking {
        core.startTransfer("u-01")
        val transfer = core.reviewTransfer(Money(1_000), null)
        assertEquals("trf-1", core.confirmTransfer(transfer.id, pinAuth).transaction!!.id)
        core.startQrPayment("m-03", null)
        val qrReview = core.reviewQrPayment(Money(500))
        assertEquals("qrp-1", core.confirmTransfer(qrReview.id, pinAuth).transaction!!.id)
    }

    @Test
    fun aHeldPaymentKeepsTheCodePaidItSettlesLikeATransfer() = runBlocking {
        core.startQrPayment("m-01", "pr-0001")
        val review = core.reviewQrPayment(Money(1_250))
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 0, writeTimeoutMs = 100))
        val pending = core.confirmTransfer(review.id, pinAuth)
        assertEquals(TransferState.PENDING to startBalance - 1_250, pending.state to pending.balance?.minor)
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
        assertEquals(ErrorCode.QR_ALREADY_PAID, code { core.startQrPayment("m-01", "pr-0001") })
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransferState.SUCCESS, core.getTransferStatus(review.id).state)
        assertEquals(startBalance - 1_250, balance())
    }

    @Test
    fun logoutForgetsEveryAttemptAndTheDraft() = runBlocking {
        core.startQrPayment("m-03", null)
        val review = core.reviewQrPayment(Money(500))
        core.logout()
        assertEquals(ErrorCode.NOT_FOUND, code { core.confirmTransfer(review.id, pinAuth) })
        assertEquals(ErrorCode.NOT_FOUND, code { core.reviewQrPayment(Money(500)) })
    }

    // ── My QR (FR-QR-05) ───────────────────────────────────────────────────

    private val prefix = qr["myQr"]!!.jsonObject["payloadPrefix"]!!.jsonPrimitive.content
    private val userIdPattern = Regex(qr["myQr"]!!.jsonObject["userIdPattern"]!!.jsonPrimitive.content)

    @Test
    fun myQrIsThisAccountsRandomUserIdAndScanningItIsRefusedAsYourself() = runBlocking {
        val payload = core.getMyQr()
        assertTrue(payload.startsWith(prefix), payload)
        val userId = payload.removePrefix(prefix)
        assertTrue(userIdPattern.matches(userId), userId)
        assertEquals(QrCode(kind = QrKind.USER, userId = userId), core.parseQr(payload))
        assertEquals(ErrorCode.INVALID_ARGUMENT, code { core.startTransfer(userId) })
        assertNull(code { core.startTransfer("u-01") }) // another user's code: the Send flow
    }

    @Test
    fun myQrStaysTheSameOfflineAndAfterResetDataResetAuthForgetsIt() = runBlocking {
        val payload = core.getMyQr()
        core.setNetworkSimulation(offline)
        assertEquals(payload, core.getMyQr())
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
        core.resetData(DatasetConfig.DEFAULT)
        assertEquals(payload, core.getMyQr())
        core.resetAuth()
        assertEquals(ErrorCode.NOT_FOUND, code { core.getMyQr() })
    }

    /** Device check 2026-10-30: a session from before user ids, on a server that never recorded the account. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun myQrWorksForASessionFromBeforeUserIds() = runBlocking {
        val old = PocketlyCore.create(JvmDatabaseDrivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), MemorySecureStore(), pinIterations = 1000)
        old.resetData(DatasetConfig.DEFAULT)
        old.pinForTests().rememberVerifiedPhone("+6281234567890", "old-token")
        val payload = old.getMyQr()
        assertTrue(payload.startsWith(prefix) && userIdPattern.matches(payload.removePrefix(prefix)), payload)
        assertEquals(payload, old.getMyQr()) // kept in the session
    }

    private companion object {
        const val PIN = "482915"
    }
}
