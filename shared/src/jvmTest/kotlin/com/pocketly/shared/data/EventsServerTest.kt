package com.pocketly.shared.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pocketly.shared.data.fake.FakeWalletApi
import com.pocketly.shared.data.fake.ServerStore
import com.pocketly.shared.db.cache.CacheDatabase
import com.pocketly.shared.db.server.ServerDatabase
import com.pocketly.shared.domain.AppNotification
import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.NotificationKind
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.TopUpMethod
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.sync.EventSync
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import java.io.File
import java.nio.file.Files
import java.util.Properties
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * ADR-0017: the fake server's event log against fixtures/events.json, and the client's rule for what
 * notifies. Mirrors packages/core-js/__tests__/events.test.ts. runBlocking: the server works in real time.
 */
class EventsServerTest {
    private val fixture = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "events.json").readText(),
    ).jsonObject
    private val server = fixture["server"]!!.jsonObject
    private val instant = NetworkSimulation(NetworkMode.NORMAL, 0, topUpProcessingMs = 0)

    private fun openServer(driver: JdbcSqliteDriver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), ServerDatabase.Schema)): FakeWalletApi =
        FakeWalletApi(ServerStore(driver), TimeZoneHolder()).also {
            it.open(DatasetConfig.DEFAULT)
            it.networkSimulation = instant
        }

    private suspend fun error(block: suspend () -> Unit): ErrorCode? = try {
        block()
        null
    } catch (e: CoreException) {
        e.code
    }

    /** An event as the fixture writes it. */
    private fun shape(e: WalletEvent): Map<String, String> = buildMap {
        put("id", "evt-${e.seq}")
        put("kind", e.kind.name)
        put("transactionId", e.transaction.id)
        put("status", e.transaction.status.name)
        e.transaction.failureReason?.let { put("failureReason", it.name) }
    }

    private fun expected(events: kotlinx.serialization.json.JsonElement): List<Map<String, String>> =
        events.jsonArray.map { e -> e.jsonObject.mapValues { it.value.jsonPrimitive.content } }

    private fun simulation(o: JsonObject) = NetworkSimulation(
        mode = NetworkMode.valueOf(o["mode"]!!.jsonPrimitive.content),
        failureRatePercent = o["failureRatePercent"]!!.jsonPrimitive.int,
        seed = o["seed"]?.jsonPrimitive?.intOrNull ?: 1,
        declineTopUps = o["declineTopUps"]?.jsonPrimitive?.booleanOrNull ?: false,
        topUpProcessingMs = o["topUpProcessingMs"]?.jsonPrimitive?.intOrNull,
    )

    /** Runs one fixture step against the server. */
    private suspend fun kotlinx.coroutines.CoroutineScope.run(api: FakeWalletApi, step: JsonObject) {
        when (val action = step["action"]!!.jsonPrimitive.content) {
            "incoming" -> api.simulateIncomingTransfer()
            "advanceClock" -> api.advanceClock(step["ms"]!!.jsonPrimitive.long)
            else -> {
                val sim = simulation(step["simulation"]!!.jsonObject)
                api.networkSimulation = sim
                val key = step["key"]!!.jsonPrimitive.content
                val r = step["request"]!!.jsonObject
                val amount = Money(r["amount"]!!.jsonPrimitive.long)
                val call = async(start = CoroutineStart.UNDISPATCHED) {
                    if (action == "transfer") {
                        api.transfer(TransferRequest(r["recipientId"]!!.jsonPrimitive.content, amount), key)
                    } else {
                        api.topUp(TopUpRequest(TopUpMethod.valueOf(r["method"]!!.jsonPrimitive.content), amount), key)
                    }
                }
                if (sim.mode == NetworkMode.TIMEOUT) {
                    delay(20) // never answered
                    call.cancel()
                } else {
                    call.await()
                }
            }
        }
        api.networkSimulation = instant
    }

    @Test
    fun walksTheStepsEachLogsExactlyItsEventsAndSignalsWhenTheLogGrows() = runBlocking {
        val api = openServer()
        var signals = 0
        val counting = launch(start = CoroutineStart.UNDISPATCHED) { api.incomingEvents().collect { signals++ } }
        var seq = 0L
        for (step in server["steps"]!!.jsonArray.map { it.jsonObject }) {
            val before = signals
            run(api, step)
            val page = api.getEvents(seq, 500)
            val want = expected(step["expect"]!!.jsonObject["events"]!!)
            assertEquals(want, page.items.map(::shape))
            assertEquals(false, page.hasMore)
            page.items.forEach { assertEquals(it.transaction.updatedAt, it.createdAt) }
            seq = page.items.lastOrNull()?.seq ?: seq
            delay(20)
            // Signals are conflated: at least one when the log grew, none when it didn't.
            assertEquals(want.isNotEmpty(), signals > before, "signals for ${step["action"]}")
        }
        counting.cancel()
    }

    @Test
    fun pagesTheLogOldestFirst() = runBlocking {
        val api = openServer()
        server["steps"]!!.jsonArray.forEach { run(api, it.jsonObject) }
        for (c in server["paging"]!!.jsonObject["cases"]!!.jsonArray.map { it.jsonObject }) {
            val page = api.getEvents(c["afterSeq"]!!.jsonPrimitive.long, c["limit"]!!.jsonPrimitive.int)
            assertEquals(c["ids"]!!.jsonArray.map { it.jsonPrimitive.content }, page.items.map { "evt-${it.seq}" })
            assertEquals(c["hasMore"]!!.jsonPrimitive.boolean, page.hasMore)
        }
    }

    @Test
    fun resetDataEmptiesTheLogAndRestartsItsNumbering() = runBlocking {
        val api = openServer()
        server["steps"]!!.jsonArray.forEach { run(api, it.jsonObject) }
        api.reset(DatasetConfig.DEFAULT)
        api.networkSimulation = instant
        assertEquals(emptyList(), api.getEvents(0, 10).items)
        api.simulateIncomingTransfer()
        assertEquals(expected(server["afterReset"]!!.jsonObject["events"]!!), api.getEvents(0, 10).items.map(::shape))
    }

    @Test
    fun refusesABadPageAndReadsNothingOffline() = runBlocking {
        val api = openServer()
        for ((after, limit) in listOf(-1L to 10, 0L to 0, 0L to 501)) {
            assertEquals(ErrorCode.INVALID_ARGUMENT, error { api.getEvents(after, limit) })
        }
        api.networkSimulation = NetworkSimulation(NetworkMode.OFFLINE, 0)
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, error { api.getEvents(0, 10) })
        api.networkSimulation = NetworkSimulation(NetworkMode.ALWAYS_FAIL, 0)
        assertEquals(ErrorCode.SERVER_ERROR, error { api.getEvents(0, 10) })
    }

    @Test
    fun aLogReadTakesNoSimulatedLatency() = runBlocking {
        val api = openServer()
        api.networkSimulation = NetworkSimulation(NetworkMode.NORMAL, 0, normalLatencyMs = 5_000)
        val start = System.currentTimeMillis()
        api.getEvents(0, 10)
        assertTrue(System.currentTimeMillis() - start < 1_000)
    }

    @Test
    fun aLogReadDrawsNothingFromTheSeededSequence() = runBlocking {
        val sim = NetworkSimulation(NetworkMode.NORMAL, 50, seed = 7)
        suspend fun outcomes(api: FakeWalletApi, readEvents: Boolean): List<String> {
            api.networkSimulation = sim
            return List(8) {
                if (readEvents) api.getEvents(0, 10)
                error { api.getWallet() }?.name ?: "OK"
            }
        }
        assertEquals(outcomes(openServer(), false), outcomes(openServer(), true))
    }

    // ── migrations ───────────────────────────────────────────────────────

    @Test
    fun migratesAVersionFourServerDatabase() = runBlocking {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val url = "jdbc:sqlite:" + dir.resolve("server.db").path
        // A version-4 database: today's schema without server_event.
        JdbcSqliteDriver(url, Properties(), ServerDatabase.Schema).close()
        java.sql.DriverManager.getConnection(url).use { c ->
            c.createStatement().use { st ->
                st.execute("DROP TABLE server_event")
                st.execute("INSERT INTO server_meta(key, value) VALUES ('seeded', '1'), ('frozenNowMillis', '${DatasetConfig.DEFAULT.nowMillis}')")
                st.execute("PRAGMA user_version = 4")
            }
        }
        assertEquals(5L, ServerDatabase.Schema.version)
        val api = openServer(JdbcSqliteDriver(url, Properties(), ServerDatabase.Schema))
        api.simulateIncomingTransfer()
        assertEquals(expected(server["afterReset"]!!.jsonObject["events"]!!), api.getEvents(0, 10).items.map(::shape))
        java.sql.DriverManager.getConnection(url).use { c ->
            c.createStatement().use { st -> st.executeQuery("PRAGMA user_version").use { rs -> rs.next(); assertEquals(5, rs.getInt(1)) } }
        }
    }

    @Test
    fun migratesAVersionOneCacheAndKeepsItsRows() {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val url = "jdbc:sqlite:" + dir.resolve("cache.db").path
        val old = incoming("sim-000001")
        // A version-1 replica: today's schema without cache_notification, with a row in it.
        CacheStore(JdbcSqliteDriver(url, Properties(), CacheDatabase.Schema)).upsert(old)
        java.sql.DriverManager.getConnection(url).use { c ->
            c.createStatement().use { st ->
                st.execute("DROP TABLE cache_notification")
                st.execute("PRAGMA user_version = 1")
            }
        }
        assertEquals(2L, CacheDatabase.Schema.version)
        val cache = CacheStore(JdbcSqliteDriver(url, Properties(), CacheDatabase.Schema))
        assertEquals(old, cache.get(old.id))
        cache.applyEvent(1, old, CacheStore.NewNotification("evt-1", NotificationKind.MONEY_RECEIVED, old.createdAt), AppNotification.KEPT)
        assertEquals(listOf(AppNotification("evt-1", NotificationKind.MONEY_RECEIVED, old, old.createdAt, false)), cache.notifications(10))
        assertEquals(1L, cache.eventCursor())
        java.sql.DriverManager.getConnection(url).use { c ->
            c.createStatement().use { st -> st.executeQuery("PRAGMA user_version").use { rs -> rs.next(); assertEquals(2, rs.getInt(1)) } }
        }
    }

    // ── the client's rule (fixtures/events.json → client) ───────────────────

    private fun newCache() = CacheStore(JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), CacheDatabase.Schema))

    private fun incoming(id: String, status: TransactionStatus = TransactionStatus.SUCCESS, key: String = "key-$id"): Transaction {
        val now = DatasetConfig.DEFAULT.nowMillis!!
        return Transaction(
            id, key, TransactionType.TRANSFER_IN, Category.TRANSFER, Money(1_000),
            Counterparty(CounterpartyKind.USER, "u-01", "Andi Pratama", "+6281234567801"), null, status, null, now, now,
        )
    }

    @Test
    fun whichEventsNotify() = runBlocking {
        for (c in fixture["client"]!!.jsonObject["cases"]!!.jsonArray.map { it.jsonObject }) {
            val kind = NotificationKind.valueOf(c["kind"]!!.jsonPrimitive.content)
            val before = c["replicaStatusBefore"]!!.jsonPrimitive.takeIf { it.isString }?.content?.let(TransactionStatus::valueOf)
            val notifies = c["notifies"]!!.jsonPrimitive.boolean
            val cache = newCache()
            val settled = incoming("trf-1", key = "k-1")
            before?.let { cache.upsert(settled.copy(status = it)) }
            val settledCalls = mutableListOf<Transaction>()
            val sync = EventSync(LogApi(listOf(WalletEvent(1, kind, settled, settled.updatedAt))), cache) { settledCalls += it }
            val got = mutableListOf<AppNotification>()
            val collecting = launch(start = CoroutineStart.UNDISPATCHED) { sync.added.collect { got += it } }
            sync.catchUp()
            delay(20)
            collecting.cancel()

            val case = "$kind, replica had $before"
            assertEquals(if (notifies) 1 else 0, got.size, case)
            assertEquals(if (notifies) 1 else 0, cache.notifications(10).size, case)
            assertEquals(if (kind == NotificationKind.TRANSACTION_SETTLED && notifies) 1 else 0, settledCalls.size, case)
            assertEquals(settled, cache.get("trf-1"), case) // applied either way
            assertEquals(1L, cache.eventCursor(), case)
        }
    }

    @Test
    fun theAppsOwnPendingRowByKeyCountsAsPendingAndGoes() = runBlocking {
        val cache = newCache()
        val settled = incoming("trf-1", key = "k-1")
        cache.upsert(settled.copy(id = "local-k-1", status = TransactionStatus.PENDING))
        EventSync(LogApi(listOf(WalletEvent(1, NotificationKind.TRANSACTION_SETTLED, settled, 1))), cache) {}.catchUp()
        assertEquals(listOf("evt-1"), cache.notifications(10).map { it.id })
        assertNull(cache.get("local-k-1"))
    }

    @Test
    fun anEventDeliveredTwiceIsAppliedAndDeliveredOnce() = runBlocking {
        val cache = newCache()
        val sync = EventSync(LogApi(listOf(WalletEvent(1, NotificationKind.MONEY_RECEIVED, incoming("sim-000001"), 1)), replay = true), cache) {}
        val got = mutableListOf<AppNotification>()
        val collecting = launch(start = CoroutineStart.UNDISPATCHED) { sync.added.collect { got += it } }
        sync.catchUp()
        sync.catchUp()
        delay(20)
        collecting.cancel()
        assertEquals(listOf("evt-1"), got.map { it.id })
        assertEquals(1, cache.unreadCount())
    }

    @Test
    fun deliversNewestFirstPagesThroughTheLogAndKeepsTheNewest() = runBlocking {
        val cache = newCache()
        val log = List(120) { i -> WalletEvent(i + 1L, NotificationKind.MONEY_RECEIVED, incoming("sim-" + (i + 1).toString().padStart(6, '0')), i.toLong()) }
        val sync = EventSync(LogApi(log), cache) {}
        val batches = mutableListOf<List<String>>()
        val collecting = launch(start = CoroutineStart.UNDISPATCHED) { sync.added.collect { batches += it.map { n -> n.id } } }
        sync.catchUp()
        delay(20)
        collecting.cancel()
        assertEquals(1, batches.size)
        assertEquals(120, batches[0].size)
        assertEquals(listOf("evt-120", "evt-119"), batches[0].take(2))
        assertEquals(List(AppNotification.KEPT) { "evt-${120 - it}" }, cache.notifications(AppNotification.KEPT + 10).map { it.id })
        assertEquals(120L, cache.eventCursor())
    }

    @Test
    fun aClearMeanwhileStopsItWithoutWriting() = runBlocking {
        val cache = newCache()
        val tx = incoming("sim-000001")
        val reading = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val api = object : LogApi(listOf(WalletEvent(1, NotificationKind.MONEY_RECEIVED, tx, 1))) {
            override suspend fun getEvents(afterSeq: Long, limit: Int): EventsPage {
                reading.complete(Unit)
                gate.await()
                return super.getEvents(afterSeq, limit)
            }
        }
        val sync = EventSync(api, cache) {}
        val got = mutableListOf<AppNotification>()
        val collecting = launch(start = CoroutineStart.UNDISPATCHED) { sync.added.collect { got += it } }
        val running = launch { sync.catchUp() }
        reading.await()
        cache.clear()
        gate.complete(Unit)
        running.join()
        delay(20)
        collecting.cancel()
        assertTrue(got.isEmpty())
        assertNull(cache.get(tx.id))
        assertEquals(0L, cache.eventCursor())
    }

    /** A WalletApi that only serves [log]; it honors afterSeq unless [replay]. */
    private open class LogApi(private val log: List<WalletEvent>, private val replay: Boolean = false) : WalletApi {
        override suspend fun getEvents(afterSeq: Long, limit: Int): EventsPage {
            val after = if (replay) log else log.filter { it.seq > afterSeq }
            return EventsPage(after.take(limit), hasMore = after.size > limit)
        }

        override fun incomingEvents(): Flow<Unit> = emptyFlow()
        override suspend fun getWallet(): Wallet = unused()
        override suspend fun getChanges(afterToken: String?, limit: Int): ChangesPage = unused()
        override suspend fun getTransaction(id: String): Transaction = unused()
        override suspend fun requestOtp(phone: String): OtpSendResult = unused()
        override suspend fun verifyOtp(phone: String, code: String): ServerOtpVerify = unused()
        override suspend fun searchContacts(query: String): List<Contact> = unused()
        override suspend fun getContact(userId: String): Contact = unused()
        override suspend fun transfer(request: TransferRequest, idempotencyKey: String): Transaction = unused()
        override suspend fun topUp(request: TopUpRequest, idempotencyKey: String): Transaction = unused()
        override suspend fun getPaymentTarget(merchantId: String, requestId: String?): PaymentTarget = unused()
        override suspend fun payMerchant(request: QrPaymentRequest, idempotencyKey: String): Transaction = unused()
        override suspend fun getAccountUserId(phone: String): String = unused()
        override suspend fun getTransferByKey(idempotencyKey: String): Transaction = unused()

        private fun unused(): Nothing = error("not used by EventSync")
    }
}
