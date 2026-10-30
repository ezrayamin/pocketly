package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.AppNotification
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.NotificationKind
import com.pocketly.shared.domain.NotificationList
import com.pocketly.shared.domain.TopUpMethod
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransferAuth
import com.pocketly.shared.domain.TransferAuthMethod
import com.pocketly.shared.domain.TransferPolicy
import com.pocketly.shared.domain.TransferState
import com.pocketly.shared.security.MemorySecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import java.util.Collections
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * F9 (ADR-0017): the contract suite's "Notifications" block, case for case
 * (packages/core-contract/src/testing/contractSuite.ts). The server's log is in EventsServerTest.
 * runBlocking: delivery, processing and timeouts here are real time.
 */
class NotificationsContractTest {
    private val fixtures = File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"))
    private val events = Json.parseToJsonElement(File(fixtures, "events.json").readText()).jsonObject
    private val golden = Json.parseToJsonElement(File(fixtures, "golden.json").readText()).jsonObject
    private val startBalance = golden["defaultDataset"]!!.jsonObject["wallet"]!!.jsonObject["balance"]!!.jsonPrimitive.long
    private val idPattern = Regex(events["params"]!!.jsonObject["idPattern"]!!.jsonPrimitive.content)
    private val pinAuth = TransferAuth(TransferAuthMethod.PIN, pin = PIN)
    private val instant = NetworkSimulation(NetworkMode.NORMAL, 0, topUpProcessingMs = 0)
    private val offline = NetworkSimulation(NetworkMode.OFFLINE, 0)

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

    /** Delivery is asynchronous: polls until [check] holds (at most 3 s). */
    private suspend fun until(check: suspend () -> Boolean) {
        val end = System.currentTimeMillis() + 3_000
        while (!check()) {
            if (System.currentTimeMillis() > end) error("timed out waiting for notifications")
            delay(10)
        }
    }

    private fun subscribe(): Pair<MutableList<AppNotification>, com.pocketly.shared.bridge.Cancellable> {
        val got = Collections.synchronizedList(mutableListOf<AppNotification>())
        return got to core.subscribeNotifications { got += it }
    }

    @Test
    fun startsEmpty() = runBlocking {
        assertEquals(events["params"]!!.jsonObject["kept"]!!.jsonPrimitive.int, AppNotification.KEPT)
        assertEquals(NotificationList(emptyList(), 0), core.getNotifications())
    }

    @Test
    fun anIncomingTransferNotifiesOnceUpdatesHistoryAndReadingClearsTheBadge() = runBlocking {
        val (got, sub) = subscribe()
        val tx = core.simulateIncomingTransfer()
        until { got.size == 1 }
        val n = got[0]
        assertEquals(Triple(NotificationKind.MONEY_RECEIVED, false, tx.id), Triple(n.kind, n.read, n.transaction.id))
        assertEquals(TransactionStatus.SUCCESS, n.transaction.status)
        assertTrue(idPattern.matches(n.id), n.id)
        assertEquals(NotificationList(listOf(n), 1), core.getNotifications())
        core.setNetworkSimulation(offline) // the replica has it already
        assertEquals(tx.id, core.getTransactions(null, 1, null).items[0].id)
        core.setNetworkSimulation(instant)

        core.markNotificationsRead()
        assertEquals(NotificationList(listOf(n.copy(read = true)), 0), core.getNotifications())
        core.getTransactions(null, 20, null) // another catch-up: nothing new
        delay(50)
        assertEquals(1, got.size)
        sub.cancel()
    }

    @Test
    fun aHeldTransferThatSettlesNotifiesAndItsAttemptAgreesWithoutAsking() = runBlocking {
        core.startTransfer("u-02")
        val review = core.reviewTransfer(Money(1_000), null)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, 0, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(review.id, pinAuth).state)
        core.setNetworkSimulation(instant)
        val (got, sub) = subscribe()
        core.advanceServerClock(TransferPolicy.PENDING_RESOLVE_MAX_MS) // the server's timer settles it
        until { got.size == 1 }
        val n = got[0]
        assertEquals(NotificationKind.TRANSACTION_SETTLED, n.kind)
        assertEquals(Triple("trf-1", review.idempotencyKey, TransactionStatus.SUCCESS), Triple(n.transaction.id, n.transaction.idempotencyKey, n.transaction.status))
        core.setNetworkSimulation(offline) // no status check needed: the event moved the attempt
        assertEquals(TransferState.SUCCESS, core.getTransferStatus(review.id).state)
        core.setNetworkSimulation(instant)
        assertEquals(startBalance - 1_000, core.getWallet().balance.minor)
        sub.cancel()
    }

    @Test
    fun aTopUpAnsweredAtOnceDoesNotNotifyOneLeftPendingDoes() = runBlocking {
        val (got, sub) = subscribe()
        val quick = core.reviewTopUp(Money(5_000), TopUpMethod.BANK_TRANSFER)
        assertEquals(TransferState.SUCCESS, core.confirmTransfer(quick.id, null).state)
        core.getTransactions(null, 20, null) // a catch-up that applies its settled event
        delay(100)
        assertEquals(0, got.size)

        val slow = core.reviewTopUp(Money(2_500), TopUpMethod.CARD)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, 0, topUpProcessingMs = 300, writeTimeoutMs = 100))
        assertEquals(TransferState.PENDING, core.confirmTransfer(slow.id, null).state)
        until { got.size == 1 }
        assertEquals(Triple(NotificationKind.TRANSACTION_SETTLED, "tup-2", TransactionStatus.SUCCESS), Triple(got[0].kind, got[0].transaction.id, got[0].transaction.status))
        core.setNetworkSimulation(instant)
        assertEquals(startBalance + 5_000 + 2_500, core.getWallet().balance.minor)
        sub.cancel()
    }

    @Test
    fun keepsTheNewest50() = runBlocking {
        repeat(AppNotification.KEPT + 1) { core.simulateIncomingTransfer() }
        until { core.getNotifications().items.firstOrNull()?.transaction?.id == "sim-000051" }
        val list = core.getNotifications()
        assertEquals(AppNotification.KEPT, list.items.size)
        assertEquals(AppNotification.KEPT, list.unreadCount)
        assertEquals("sim-000002", list.items[AppNotification.KEPT - 1].transaction.id) // sim-000001 dropped
    }

    @Test
    fun unsubscribingStopsDeliveryNotTheCatchingUp() = runBlocking {
        val (got, sub) = subscribe()
        sub.cancel()
        core.simulateIncomingTransfer()
        until { core.getNotifications().unreadCount == 1 }
        assertEquals(0, got.size)
    }

    @Test
    fun worksOfflineResetDataAndLogoutClearThem() = runBlocking {
        core.simulateIncomingTransfer()
        until { core.getNotifications().unreadCount == 1 }
        core.setNetworkSimulation(offline)
        assertEquals(1, core.getNotifications().items.size)
        core.setNetworkSimulation(instant)
        core.resetData(DatasetConfig.DEFAULT)
        assertEquals(NotificationList(emptyList(), 0), core.getNotifications())
        core.simulateIncomingTransfer()
        until { core.getNotifications().unreadCount == 1 }
        core.logout()
        assertEquals(NotificationList(emptyList(), 0), core.getNotifications())
    }

    private companion object {
        const val PIN = "482915"
    }
}
