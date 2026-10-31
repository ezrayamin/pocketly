package com.pocketly.shared.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.data.fake.FakeWalletApi
import com.pocketly.shared.data.fake.NetworkSimulator
import com.pocketly.shared.data.fake.SeedData
import com.pocketly.shared.data.fake.ServerStore
import com.pocketly.shared.db.server.ServerDatabase
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
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferPolicy
import kotlinx.coroutines.async
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
import kotlin.test.assertTrue

/**
 * ADR-0015: the top-up rules and the fake server's endpoint, against fixtures/topup.json.
 * Mirrors packages/core-js/__tests__/topUpServer.test.ts. runBlocking, not runTest: the server
 * works on Dispatchers.Default in real time (ADR-0007 §2), which virtual time would skip.
 */
class TopUpServerTest {
    private val fixture = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "topup.json").readText(),
    ).jsonObject

    private val instant = NetworkSimulation(NetworkMode.NORMAL, 0, topUpProcessingMs = 0)

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content

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

    private fun counterparty(o: JsonObject) = Counterparty(CounterpartyKind.valueOf(o.str("kind")!!), o.str("id")!!, o.str("name")!!)

    private fun simulation(o: JsonObject) = NetworkSimulation(
        NetworkMode.valueOf(o.str("mode")!!),
        o["failureRatePercent"]!!.jsonPrimitive.int,
        seed = o["seed"]!!.jsonPrimitive.int,
        declineTopUps = o["declineTopUps"]?.jsonPrimitive?.boolean ?: false,
    )

    // ── rules ────────────────────────────────────────────────────────────

    @Test
    fun usesTheParametersInTheFixture() {
        val p = fixture["params"]!!.jsonObject
        assertEquals(p["minAmount"]!!.jsonPrimitive.long, TopUpPolicy.MIN_AMOUNT)
        assertEquals(p["maxAmount"]!!.jsonPrimitive.long, TopUpPolicy.MAX_AMOUNT)
        assertEquals(p["fee"]!!.jsonPrimitive.long, TopUpPolicy.FEE)
        assertEquals(p["presets"]!!.jsonArray.map { it.jsonPrimitive.long }, TopUpPolicy.PRESETS)
        assertEquals(p["processingMinMs"]!!.jsonPrimitive.long, TopUpPolicy.PROCESSING_MIN_MS)
        assertEquals(p["processingMaxMs"]!!.jsonPrimitive.long, TopUpPolicy.PROCESSING_MAX_MS)
    }

    @Test
    fun eachMethodsCounterpartyIsTheFixturesAndOneTheSeedUses() {
        val seeded = SeedData.generate(DatasetConfig.DEFAULT, DatasetConfig.DEFAULT.nowMillis!!)
            .filter { it.type == TransactionType.TOP_UP }
            .map { it.counterparty }
        val methods = fixture["methods"]!!.jsonObject
        for (method in TopUpMethod.entries) {
            val cp = TopUpPolicy.counterparty(method)
            assertEquals(counterparty(methods[method.name]!!.jsonObject), cp, method.name)
            assertTrue(cp in seeded, method.name)
            assertEquals(method, TopUpPolicy.methodOf(cp))
        }
        assertEquals(null, TopUpPolicy.methodOf(Counterparty(CounterpartyKind.USER, "pm-bank", "Bank transfer")))
    }

    @Test
    fun amountCases() {
        for (c in fixture["amountCheck"]!!.jsonObject["cases"]!!.jsonArray.map { it.jsonObject }) {
            val input = c.str("input")!!
            val e = c["expected"]!!.jsonObject
            val got = TopUpPolicy.checkAmount(input)
            val label = "\"$input\""
            assertEquals(e["ok"]!!.jsonPrimitive.boolean, got.ok, label)
            assertEquals(e["minor"]?.jsonPrimitive?.longOrNull, got.minor?.minor, "$label minor")
            assertEquals(e.str("reason"), got.reason?.name, "$label reason")
            assertEquals(e["acceptInput"]!!.jsonPrimitive.boolean, got.acceptInput, "$label acceptInput")
            assertEquals(null, got.remainingBalance, "$label remaining")
        }
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
        val usedBefore = api.getWallet().usedToday.minor
        val methods = fixture["methods"]!!.jsonObject
        val results = mutableListOf<Transaction?>()
        for ((i, stepEl) in fixture["server"]!!.jsonObject["steps"]!!.jsonArray.withIndex()) {
            val step = stepEl.jsonObject
            val key = step.str("key")!!
            api.networkSimulation = instant.copy(declineTopUps = step["declineTopUps"]?.jsonPrimitive?.boolean ?: false)
            val before = api.getWallet().balance.minor
            val request = step["request"]?.jsonObject
            val transfer = step["transfer"]?.jsonObject
            var tx: Transaction? = null
            val code = error {
                tx = if (transfer != null) {
                    api.transfer(TransferRequest(transfer.str("recipientId")!!, Money(transfer["amount"]!!.jsonPrimitive.long)), key)
                } else {
                    api.topUp(TopUpRequest(TopUpMethod.valueOf(request!!.str("method")!!), Money(request["amount"]!!.jsonPrimitive.long)), key)
                }
            }
            val e = step["expect"]!!.jsonObject
            val label = "step $i"
            when {
                e.containsKey("error") -> assertEquals(e.str("error"), code?.name, label)
                e.containsKey("sameAs") -> assertEquals(results[e["sameAs"]!!.jsonPrimitive.int], tx, label)
                else -> {
                    assertEquals(listOf(e.str("status"), e.str("failureReason"), e.str("id")), listOf(tx?.status?.name, tx?.failureReason?.name, tx?.id), label)
                    if (request != null) {
                        val cp = counterparty(methods[request.str("method")!!]!!.jsonObject)
                        assertEquals(
                            listOf(key, TransactionType.TOP_UP, Money(request["amount"]!!.jsonPrimitive.long), cp),
                            listOf(tx!!.idempotencyKey, tx!!.type, tx!!.amount, tx!!.counterparty),
                            label,
                        )
                    }
                }
            }
            results += tx
            assertEquals(step["balanceDelta"]!!.jsonPrimitive.long, api.getWallet().balance.minor - before, label)
        }
        assertEquals(results[0], api.getTransferByKey("k-1"))
        assertEquals(ErrorCode.NOT_FOUND, error { api.getTransferByKey("k-2") }) // refused requests aren't recorded
        assertEquals(usedBefore + 1_000, api.getWallet().usedToday.minor) // only the transfer step counts
    }

    @Test
    fun processingDrawsFollowTheSeed() = runBlocking {
        val processing = fixture["processing"]!!.jsonObject
        val api = openServer()
        api.networkSimulation = simulation(processing["simulation"]!!.jsonObject)
        val drawn = processing["processingMs"]!!.jsonArray.map {
            (api.simulatorForTests().beforeTopUp() as NetworkSimulator.TopUpHandling.Processed).processingMs
        }
        assertEquals(processing["processingMs"]!!.jsonArray.map { it.jsonPrimitive.long }, drawn)
    }

    @Test
    fun recordsPendingOnArrivalAndProcessesOutsideTheLock() = runBlocking {
        val api = openServer()
        val before = api.getWallet().balance.minor
        api.networkSimulation = instant.copy(topUpProcessingMs = 150)
        val answer = async { api.topUp(TopUpRequest(TopUpMethod.CARD, Money(2_500)), "slow") }
        delay(50)
        // Meanwhile the server answers other calls; the top-up is PENDING and not in the balance yet.
        assertEquals(TransactionStatus.PENDING, api.getTransferByKey("slow").status)
        assertEquals(before, api.getWallet().balance.minor)
        // A retry while processing gets the PENDING row: no second charge.
        val replay = api.topUp(TopUpRequest(TopUpMethod.CARD, Money(2_500)), "slow")
        assertEquals("tup-1" to TransactionStatus.PENDING, replay.id to replay.status)
        val done = answer.await()
        assertEquals("tup-1" to TransactionStatus.SUCCESS, done.id to done.status)
        assertEquals(done, api.getTransferByKey("slow"))
        assertEquals(before + 2_500, api.getWallet().balance.minor)
    }

    @Test
    fun aDeclinedTopUpIsRecordedFailedWithPaymentDeclined() = runBlocking {
        val api = openServer()
        val before = api.getWallet().balance.minor
        api.networkSimulation = instant.copy(declineTopUps = true)
        val declined = api.topUp(TopUpRequest(TopUpMethod.BANK_TRANSFER, Money(5_000)), "no")
        assertEquals(TransactionStatus.FAILED to ErrorCode.PAYMENT_DECLINED, declined.status to declined.failureReason)
        assertEquals(before, api.getWallet().balance.minor)
    }

    @Test
    fun numberingRestartsAfterResetSeparatelyFromTransfers() = runBlocking {
        val api = openServer()
        api.topUp(TopUpRequest(TopUpMethod.CARD, Money(1_000)), "a")
        api.reset(DatasetConfig.DEFAULT)
        assertEquals("tup-1", api.topUp(TopUpRequest(TopUpMethod.CARD, Money(1_000)), "b").id)
        assertEquals("trf-1", api.transfer(TransferRequest("u-01", Money(100)), "c").id)
    }

    // ── TIMEOUT mode (FR-FAKE-05) ────────────────────────────────────────

    @Test
    fun timeoutModeHoldsAndSettlesWithTheSeededDraws() = runBlocking {
        val timeout = fixture["timeoutMode"]!!.jsonObject
        val declined = timeout["declined"]!!.jsonObject
        for ((sim, holds) in listOf(timeout to timeout["holds"]!!, declined to declined["holds"]!!)) {
            val api = openServer()
            for ((i, expectedEl) in holds.jsonArray.withIndex()) {
                val expected = expectedEl.jsonObject
                api.networkSimulation = simulation(sim["simulation"]!!.jsonObject)
                repeat(i) { api.simulatorForTests().beforeTopUp() } // re-setting reseeds: skip earlier draws
                var answered = false
                val job = launch { api.topUp(TopUpRequest(TopUpMethod.BANK_TRANSFER, Money(1_000)), "held-$i"); answered = true }
                delay(50)
                assertEquals(false, answered)
                api.networkSimulation = instant
                assertEquals(TransactionStatus.PENDING, api.getTransferByKey("held-$i").status)
                val holdMs = expected["holdMs"]!!.jsonPrimitive.long
                api.advanceClock(holdMs - 1)
                assertEquals(TransactionStatus.PENDING, api.getTransferByKey("held-$i").status)
                api.advanceClock(1)
                val done = api.getTransferByKey("held-$i")
                val label = "$i ${sim["simulation"]}"
                assertEquals(expected.str("status") to expected.str("failureReason"), done.status.name to done.failureReason?.name, label)
                job.cancel()
            }
        }
    }

    @Test
    fun aDeclinedTopUpHeldAcrossARestartSettlesDeclined() = runBlocking {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val path = dir.resolve("server.db").path
        val first = FakeWalletApi(ServerStore(JvmDatabaseDrivers(path, null).server()), TimeZoneHolder()).also { it.open(DatasetConfig.DEFAULT) }
        first.networkSimulation = NetworkSimulation(NetworkMode.TIMEOUT, 0, declineTopUps = true)
        val job = launch { first.topUp(TopUpRequest(TopUpMethod.CARD, Money(900)), "across") }
        delay(50)
        job.cancel()
        val second = FakeWalletApi(ServerStore(JvmDatabaseDrivers(path, null).server()), TimeZoneHolder()).also { it.open(DatasetConfig.DEFAULT) }
        second.networkSimulation = instant
        assertEquals(TransactionStatus.PENDING, second.getTransferByKey("across").status)
        second.advanceClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        val settled = second.getTransferByKey("across")
        assertEquals(TransactionStatus.FAILED to ErrorCode.PAYMENT_DECLINED, settled.status to settled.failureReason)
        assertEquals("tup-2", second.topUp(TopUpRequest(TopUpMethod.CARD, Money(900)), "next").id)
    }
}
