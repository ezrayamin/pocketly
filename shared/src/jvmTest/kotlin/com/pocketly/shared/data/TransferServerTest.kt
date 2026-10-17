package com.pocketly.shared.data

import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.data.fake.FakeWalletApi
import com.pocketly.shared.data.fake.SeedData
import com.pocketly.shared.data.fake.ServerStore
import com.pocketly.shared.db.server.ServerDatabase
import com.pocketly.shared.domain.AmountLimits
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.Counterparty
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
import com.pocketly.shared.domain.TransferPolicy
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
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
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * ADR-0014: the transfer rules and the fake server's endpoint, against fixtures/transfer.json.
 * Mirrors packages/core-js/__tests__/transferServer.test.ts. runBlocking, not runTest: the server
 * works on Dispatchers.Default in real time (ADR-0007 §2), which virtual time would skip.
 */
class TransferServerTest {
    private val fixture = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "transfer.json").readText(),
    ).jsonObject

    private val directory = fixture["directory"]!!.jsonArray.map {
        val o = it.jsonObject
        Contact(o.str("userId")!!, o.str("name")!!, o.str("phone")!!)
    }

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content

    private fun openServer(driver: JdbcSqliteDriver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), ServerDatabase.Schema)): FakeWalletApi =
        FakeWalletApi(ServerStore(driver), TimeZoneHolder()).also { it.open(DatasetConfig.DEFAULT) }

    private suspend fun error(block: suspend () -> Unit): ErrorCode? = try {
        block()
        null
    } catch (e: CoreException) {
        e.code
    }

    private fun request(o: JsonObject) = TransferRequest(o.str("recipientId")!!, Money(o["amount"]!!.jsonPrimitive.long), o.str("note"))

    // ── rules ────────────────────────────────────────────────────────────

    @Test
    fun usesTheParametersInTheFixture() {
        val p = fixture["params"]!!.jsonObject
        assertEquals(p["minAmount"]!!.jsonPrimitive.long, TransferPolicy.MIN_AMOUNT)
        assertEquals(p["fee"]!!.jsonPrimitive.long, TransferPolicy.FEE)
        assertEquals(p["defaultDailyLimit"]!!.jsonPrimitive.long, TransferPolicy.DEFAULT_DAILY_LIMIT)
        assertEquals(p["timeoutMs"]!!.jsonPrimitive.long, TransferPolicy.TIMEOUT_MS)
        assertEquals(p["noteMaxLength"]!!.jsonPrimitive.int, TransferPolicy.NOTE_MAX_LENGTH)
        assertEquals(p["recentLimit"]!!.jsonPrimitive.int, TransferPolicy.RECENT_CONTACTS_LIMIT)
        assertEquals(p["pendingResolveMinMs"]!!.jsonPrimitive.long, TransferPolicy.PENDING_RESOLVE_MIN_MS)
        assertEquals(p["pendingResolveMaxMs"]!!.jsonPrimitive.long, TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransferPolicy.TIMEOUT_MS.toInt(), NetworkSimulation.NORMAL.writeTimeoutMs)
    }

    @Test
    fun seedDirectoryIsTheFixtureDirectory() {
        assertEquals(directory, SeedData.CONTACTS.map { Contact(it.id, it.name, it.phone!!) })
    }

    @Test
    fun searchCases() {
        val search = fixture["search"]!!.jsonObject
        val self = search.str("selfPhone")
        for (c in search["cases"]!!.jsonArray.map { it.jsonObject }) {
            val query = c.str("query")!!
            val result = ContactSearch.search(query, directory, self)
            assertEquals(c["userIds"]!!.jsonArray.map { it.jsonPrimitive.content }, result.contacts.map { it.userId }, "\"$query\"")
            assertEquals(c.str("phoneLookup")?.let(PhoneLookup::valueOf), result.phoneLookup, "\"$query\" lookup")
        }
    }

    @Test
    fun amountCases() {
        val amount = fixture["amountCheck"]!!.jsonObject
        for (set in listOf(amount, amount["fundsCases"]!!.jsonObject, amount["equalCases"]!!.jsonObject)) {
            val l = set["limits"]!!.jsonObject
            val limits = AmountLimits(Money(l["balance"]!!.jsonPrimitive.long), Money(l["dailyRemaining"]!!.jsonPrimitive.long))
            for (c in set["cases"]!!.jsonArray.map { it.jsonObject }) {
                val input = c.str("input")!!
                val e = c["expected"]!!.jsonObject
                val got = TransferPolicy.checkAmount(input, limits)
                val label = "\"$input\""
                assertEquals(e["ok"]!!.jsonPrimitive.boolean, got.ok, label)
                assertEquals(e["minor"]?.jsonPrimitive?.longOrNull, got.minor?.minor, "$label minor")
                assertEquals(e.str("reason"), got.reason?.name, "$label reason")
                assertEquals(e["acceptInput"]!!.jsonPrimitive.boolean, got.acceptInput, "$label acceptInput")
                assertEquals(e["remainingBalance"]?.jsonPrimitive?.longOrNull, got.remainingBalance?.minor, "$label remaining")
            }
        }
    }

    @Test
    fun notes() {
        val notes = fixture["notes"]!!.jsonObject
        for (v in notes["valid"]!!.jsonArray.map { it.jsonObject }) assertEquals(v.str("note"), TransferPolicy.normalizeNote(v.str("input")))
        for (bad in notes["invalid"]!!.jsonArray) {
            assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { TransferPolicy.normalizeNote(bad.jsonPrimitive.content) }.code)
        }
        assertNull(TransferPolicy.normalizeNote(null))
    }

    @Test
    fun retryableCodes() {
        for ((code, retryable) in fixture["retryable"]!!.jsonObject) {
            if (code.startsWith("_")) continue
            assertEquals(retryable.jsonPrimitive.booleanOrNull, TransferPolicy.isRetryable(ErrorCode.valueOf(code)), code)
        }
    }

    // ── server ───────────────────────────────────────────────────────────

    @Test
    fun walksTheServerSteps() = runBlocking {
        val api = openServer()
        val results = mutableListOf<Transaction?>()
        for ((i, stepEl) in fixture["server"]!!.jsonObject["steps"]!!.jsonArray.withIndex()) {
            val step = stepEl.jsonObject
            val key = step.str("key")!!
            val req = request(step["request"]!!.jsonObject)
            val before = api.getWallet().balance.minor
            var tx: Transaction? = null
            val code = error { tx = api.transfer(req, key) }
            val e = step["expect"]!!.jsonObject
            val label = "step $i"
            when {
                e.containsKey("error") -> assertEquals(e.str("error"), code?.name, label)
                e.containsKey("sameAs") -> assertEquals(results[e["sameAs"]!!.jsonPrimitive.int], tx, label)
                else -> {
                    assertEquals(listOf(e.str("status"), e.str("failureReason"), e.str("id")), listOf(tx?.status?.name, tx?.failureReason?.name, tx?.id), label)
                    assertEquals(listOf(key, TransactionType.TRANSFER_OUT, req.amount), listOf(tx!!.idempotencyKey, tx!!.type, tx!!.amount), label)
                }
            }
            results += tx
            assertEquals(step["balanceDelta"]!!.jsonPrimitive.long, api.getWallet().balance.minor - before, label)
        }
        val sent = api.getTransferByKey("k-1")
        assertEquals(results[0], sent)
        assertEquals(Counterparty(CounterpartyKind.USER, "u-01", "Andi Pratama", "+6281234567781"), sent.counterparty)
        assertEquals(ErrorCode.NOT_FOUND, error { api.getTransferByKey("k-2") })
    }

    @Test
    fun appliesAKeyOnceWhenTheSameRequestArrivesTwiceAtOnce() = runBlocking {
        val api = openServer()
        val before = api.getWallet().balance.minor
        val req = TransferRequest("u-04", Money(2_500))
        val (a, b) = listOf(async { api.transfer(req, "twice") }, async { api.transfer(req, "twice") }).awaitAll()
        assertEquals(a, b)
        assertEquals(before - 2_500, api.getWallet().balance.minor)
    }

    @Test
    fun serverErrorOrOfflineAppliesNothingSoTheSameKeyWorksAfterwards() = runBlocking {
        val api = openServer()
        val before = api.getWallet().balance.minor
        val req = TransferRequest("u-05", Money(1_000))
        api.networkSimulation = NetworkSimulation(NetworkMode.ALWAYS_FAIL, 0)
        assertEquals(ErrorCode.SERVER_ERROR, error { api.transfer(req, "retry-me") })
        api.networkSimulation = NetworkSimulation(NetworkMode.OFFLINE, 0)
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, error { api.transfer(req, "retry-me") })
        api.networkSimulation = NetworkSimulation.NORMAL
        assertEquals(ErrorCode.NOT_FOUND, error { api.getTransferByKey("retry-me") })
        assertEquals(TransactionStatus.SUCCESS, api.transfer(req, "retry-me").status)
        assertEquals(before - 1_000, api.getWallet().balance.minor)
    }

    @Test
    fun aRequestStillOnItsWayWhenTheClientGivesUpIsAppliedAnyway() = runBlocking {
        val api = openServer()
        val client = TimeoutWalletApi(api) { kind -> if (kind == CallKind.WRITE) 20 else 1_000 }
        api.networkSimulation = NetworkSimulation(NetworkMode.NORMAL, 0, normalLatencyMs = 60)
        assertEquals(ErrorCode.NETWORK_TIMEOUT, error { client.transfer(TransferRequest("u-06", Money(700)), "slow") })
        delay(150)
        api.networkSimulation = NetworkSimulation.NORMAL
        assertEquals(TransactionStatus.SUCCESS, client.getTransferByKey("slow").status)
    }

    @Test
    fun dailyLimitIsTheServersChangeableAndRestoredByReset() = runBlocking {
        val api = openServer()
        assertEquals(TransferPolicy.DEFAULT_DAILY_LIMIT, api.getWallet().dailyLimit.minor)
        api.setDailyLimit(Money(2_000))
        assertEquals(2_000, api.getWallet().dailyLimit.minor)
        val refused = api.transfer(TransferRequest("u-01", Money(500)), "over") // 1578 used already
        assertEquals(TransactionStatus.FAILED to ErrorCode.DAILY_LIMIT_EXCEEDED, refused.status to refused.failureReason)
        for (bad in listOf(-1L, Money.MAX_SAFE_INTEGER)) assertEquals(ErrorCode.INVALID_ARGUMENT, error { api.setDailyLimit(Money(bad)) })
        api.reset(DatasetConfig.DEFAULT)
        assertEquals(TransferPolicy.DEFAULT_DAILY_LIMIT, api.getWallet().dailyLimit.minor)
        assertEquals("trf-1", api.transfer(TransferRequest("u-01", Money(500)), "k").id)
    }

    @Test
    fun searchesTheDirectory() = runBlocking {
        val api = openServer()
        assertEquals(listOf("u-04"), api.searchContacts("dewi").map { it.userId })
        assertEquals(10, api.searchContacts("").size)
    }

    // ── TIMEOUT mode (FR-FAKE-05) ────────────────────────────────────────

    private suspend fun settle(api: FakeWalletApi, key: String): Transaction {
        api.networkSimulation = NetworkSimulation.NORMAL
        return api.getTransferByKey(key)
    }

    private fun simulation(o: JsonObject) = NetworkSimulation(
        NetworkMode.valueOf(o.str("mode")!!), o["failureRatePercent"]!!.jsonPrimitive.int, seed = o["seed"]!!.jsonPrimitive.int,
    )

    @Test
    fun timeoutModeRecordsPendingNeverAnswersThenSettlesWithTheSeededDraws() = runBlocking {
        val timeout = fixture["timeoutMode"]!!.jsonObject
        val holds = timeout["holds"]!!.jsonArray.map { it.jsonObject }
        val api = openServer()
        val before = api.getWallet().balance.minor
        val outcomes = mutableListOf<Pair<Long, Boolean>>()
        for ((i, expected) in holds.withIndex()) {
            api.networkSimulation = simulation(timeout["simulation"]!!.jsonObject)
            repeat(i) { simulatorOf(api).beforeTransfer() } // re-setting reseeds: skip earlier draws
            var answered = false
            val job = launch { api.transfer(TransferRequest("u-02", Money(1_000)), "held-$i"); answered = true }
            delay(50)
            assertEquals(false, answered)
            val held = settle(api, "held-$i")
            assertEquals(TransactionStatus.PENDING, held.status)
            val holdMs = expected["holdMs"]!!.jsonPrimitive.long
            api.advanceClock(holdMs - 1)
            assertEquals(TransactionStatus.PENDING, api.getTransferByKey("held-$i").status)
            api.advanceClock(1)
            val done = api.getTransferByKey("held-$i")
            assertTrue(done.updatedAt > held.updatedAt)
            outcomes += holdMs to (done.status == TransactionStatus.FAILED)
            if (done.status == TransactionStatus.FAILED) assertEquals(ErrorCode.SERVER_ERROR, done.failureReason)
            job.cancel()
        }
        assertEquals(holds.map { it["holdMs"]!!.jsonPrimitive.long to it["fails"]!!.jsonPrimitive.boolean }, outcomes)
        val succeeded = holds.count { !it["fails"]!!.jsonPrimitive.boolean }
        assertEquals(before - succeeded * 1_000, api.getWallet().balance.minor)
    }

    @Test
    fun aHeldTransferCountsAgainstBalanceAndLimitUntilItSettles() = runBlocking {
        val api = openServer()
        val wallet = api.getWallet()
        api.networkSimulation = NetworkSimulation(NetworkMode.TIMEOUT, 100)
        val job = launch { api.transfer(TransferRequest("u-02", Money(4_000)), "held") }
        delay(50)
        assertEquals(TransactionStatus.PENDING, settle(api, "held").status)
        val during = api.getWallet()
        assertEquals(wallet.balance.minor - 4_000 to wallet.usedToday.minor + 4_000, during.balance.minor to during.usedToday.minor)
        api.advanceClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransactionStatus.FAILED, api.getTransferByKey("held").status)
        val after = api.getWallet()
        assertEquals(wallet.balance to wallet.usedToday, after.balance to after.usedToday)
        job.cancel()
    }

    @Test
    fun settlesOnTheNextStartAfterARestart() = runBlocking {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val path = dir.resolve("server.db").path
        val first = FakeWalletApi(ServerStore(JvmDatabaseDrivers(path, null).server()), TimeZoneHolder()).also { it.open(DatasetConfig.DEFAULT) }
        first.networkSimulation = NetworkSimulation(NetworkMode.TIMEOUT, 0)
        val job = launch { first.transfer(TransferRequest("u-03", Money(900)), "across") }
        delay(50)
        job.cancel()
        val second = FakeWalletApi(ServerStore(JvmDatabaseDrivers(path, null).server()), TimeZoneHolder()).also { it.open(DatasetConfig.DEFAULT) }
        assertEquals(TransactionStatus.PENDING, second.getTransferByKey("across").status)
        second.advanceClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransactionStatus.SUCCESS, second.getTransferByKey("across").status)
        assertEquals("trf-2", second.transfer(TransferRequest("u-03", Money(900)), "next").id)
    }

    // ── migration ────────────────────────────────────────────────────────

    @Test
    fun migratesAVersionOneDatabase() = runBlocking {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val url = "jdbc:sqlite:" + dir.resolve("server.db").path
        // A slice-5 database: version 1, without the tables 1.sqm adds.
        java.sql.DriverManager.getConnection(url).use { c ->
            c.createStatement().use { st ->
                st.execute(
                    "CREATE TABLE server_transaction (id TEXT NOT NULL PRIMARY KEY, idempotency_key TEXT NOT NULL, type TEXT NOT NULL, " +
                        "category TEXT NOT NULL, amount INTEGER NOT NULL, counterparty_kind TEXT, counterparty_id TEXT, counterparty_name TEXT, " +
                        "counterparty_phone TEXT, note TEXT, status TEXT NOT NULL, failure_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
                )
                st.execute("CREATE INDEX server_transaction_changes ON server_transaction(updated_at, id)")
                st.execute("CREATE TABLE server_meta (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)")
                st.execute("INSERT INTO server_meta(key, value) VALUES ('seeded', '1'), ('frozenNowMillis', '${DatasetConfig.DEFAULT.nowMillis}')")
                st.execute("PRAGMA user_version = 1")
            }
        }
        assertEquals(2L, ServerDatabase.Schema.version)
        val api = FakeWalletApi(ServerStore(JdbcSqliteDriver(url, Properties(), ServerDatabase.Schema)), TimeZoneHolder()).also { it.open(DatasetConfig.DEFAULT) }
        assertEquals(TransactionStatus.FAILED, api.transfer(TransferRequest("u-01", Money(100)), "after-migration").status) // empty ledger
        java.sql.DriverManager.getConnection(url).use { c ->
            c.createStatement().use { st -> st.executeQuery("PRAGMA user_version").use { rs -> rs.next(); assertEquals(2, rs.getInt(1)) } }
        }
    }

    private fun simulatorOf(api: FakeWalletApi) = api.simulatorForTests()
}
