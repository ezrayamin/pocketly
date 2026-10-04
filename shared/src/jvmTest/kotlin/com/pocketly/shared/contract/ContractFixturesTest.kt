package com.pocketly.shared.contract

import com.pocketly.shared.bridge.BridgeConversions
import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.domain.BalanceCheck
import com.pocketly.shared.domain.CategoryTotal
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.DayTotal
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.IngestResult
import com.pocketly.shared.domain.MoneyParseResult
import com.pocketly.shared.domain.PriceTick
import com.pocketly.shared.domain.SpendingSummary
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferEvent
import com.pocketly.shared.domain.TransferState
import com.pocketly.shared.domain.TransferStateMachine
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.sync.PriceFeed
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * BM-PAR-01, Kotlin side. Runs the SAME fixture files as the TypeScript contract suite
 * (packages/core-contract/src/testing/contractSuite.ts) against the SAME facade the
 * native adapters call. If core-js and the KMP core ever disagree, one of the two fails.
 */
class ContractFixturesTest {
    private val dir = File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"))
    private fun fixture(name: String) = Json.parseToJsonElement(File(dir, name).readText()).jsonObject

    private val money = fixture("money.json")
    private val stateMachine = fixture("state-machine.json")
    private val ingest = fixture("ingest.json")
    private val golden = fixture("golden.json")
    private val timeZones = fixture("time-zones.json")

    private lateinit var core: PocketlyCore

    @BeforeTest
    fun setUp() = runTest {
        core = PocketlyCore.create()
        core.resetData(DatasetConfig.DEFAULT)
    }

    // ── money ──────────────────────────────────────────────────────────────

    @Test
    fun formatMoney() {
        for (case in money["format"]!!.jsonArray.map { it.jsonObject }) {
            val minor = case["minor"]!!.jsonPrimitive.long
            assertEquals(case["expected"]!!.jsonPrimitive.content, core.formatMoney(minor), "formatMoney($minor)")
        }
        val minors = money["format"]!!.jsonArray.map { it.jsonObject["minor"]!!.jsonPrimitive.long }.toLongArray()
        assertEquals(minors.map { core.formatMoney(it) }, core.formatMoneyBatch(minors))
    }

    @Test
    fun formatMoneyRejectsNonSafeIntegersAtTheBridge() {
        for (value in money["formatInvalid"]!!.jsonArray) {
            val e = assertFailsWith<CoreException> { BridgeConversions.toLongExact(value.jsonPrimitive.double) }
            assertEquals(ErrorCode.INVALID_ARGUMENT, e.code)
        }
    }

    @Test
    fun parseMoney() {
        for (case in money["parse"]!!.jsonArray.map { it.jsonObject }) {
            val input = case["input"]!!.jsonPrimitive.content
            assertEquals(case["expected"], core.parseMoney(input).toJson(), "parseMoney(\"$input\")")
        }
    }

    // ── state machine ──────────────────────────────────────────────────────

    @Test
    fun stateMachineMatchesFixtureExhaustively() {
        val allowed = stateMachine["transitions"]!!.jsonArray.associate {
            val t = it.jsonObject
            (t["from"]!!.jsonPrimitive.content to t["event"]!!.jsonPrimitive.content) to t["to"]!!.jsonPrimitive.content
        }
        assertEquals(stateMachine["states"]!!.jsonArray.map { it.jsonPrimitive.content }, TransferState.entries.map { it.name })
        assertEquals(stateMachine["events"]!!.jsonArray.map { it.jsonPrimitive.content }, TransferEvent.entries.map { it.name })
        for (state in TransferState.entries) {
            for (event in TransferEvent.entries) {
                assertEquals(allowed[state.name to event.name], TransferStateMachine.next(state, event)?.name, "$state --$event-->")
            }
        }
    }

    // ── fake backend dataset ───────────────────────────────────────────────

    @Test
    fun defaultDataset() = runTest {
        val expected = golden["defaultDataset"]!!.jsonObject
        assertEquals(expected["wallet"], core.getWallet().toJson())
        assertEquals(expected["firstPage"], core.getTransactions(null, 20, null).toJson())

        val ids = mutableListOf<String>()
        var cursor: String? = null
        do {
            val page = core.getTransactions(cursor, 17, null)
            ids += page.items.map { it.id }
            cursor = page.nextCursor
        } while (cursor != null)
        assertEquals(expected["allIds"]!!.jsonArray.map { it.jsonPrimitive.content }, ids)

        val filtered = core.getTransactions(
            null, 100,
            TxFilter(types = listOf(TransactionType.TRANSFER_OUT), statuses = listOf(TransactionStatus.PENDING, TransactionStatus.FAILED)),
        )
        assertEquals(expected["pendingOrFailedTransferOutIds"]!!.jsonArray.map { it.jsonPrimitive.content }, filtered.items.map { it.id })
    }

    @Test
    fun spendingSummaries() = runTest {
        for ((month, expected) in golden["summaries"]!!.jsonObject) {
            assertEquals(expected, core.computeSpendingSummary(month).toJson(), month)
        }
    }

    @Test
    fun largeBenchmarkDataset() = runTest {
        val large = golden["largeDataset"]!!.jsonObject
        val config = large["config"]!!.jsonObject
        core.resetData(
            DatasetConfig(
                seed = config["seed"]!!.jsonPrimitive.int,
                transactionCount = config["transactionCount"]!!.jsonPrimitive.int,
                nowMillis = config["nowMillis"]!!.jsonPrimitive.long,
            ),
        )
        assertEquals(large["wallet"], core.getWallet().toJson())
        assertEquals(large["summary"], core.computeSpendingSummary(large["month"]!!.jsonPrimitive.content).toJson())
    }

    // ── ingest ─────────────────────────────────────────────────────────────

    @Test
    fun ingestTransactions() = runTest {
        val before = core.getWallet().balance.minor
        assertEquals(ingest["expected"], core.ingestTransactions(ingest["input"].toString()).toJson())
        assertEquals(ingest["expectedBalanceDelta"]!!.jsonPrimitive.long, core.getWallet().balance.minor - before)
        assertEquals("Iced latte", core.getTransaction("ing-0001").note)

        val second = core.ingestTransactions(ingest["input"].toString())
        assertEquals(0, second.accepted)
    }

    // ── time zones (ADR-0006) ──────────────────────────────────────────────

    @Test
    fun timeZoneEdges() = runTest {
        for (case in timeZones["cases"]!!.jsonArray.map { it.jsonObject }) {
            val name = case["name"]!!.jsonPrimitive.content
            val c = PocketlyCore.create()
            c.resetData(DatasetConfig(seed = 1, transactionCount = 1, nowMillis = case["nowMillis"]!!.jsonPrimitive.long))
            c.setTimeZone(case["zone"]!!.jsonPrimitive.content)
            val txs = case["transactions"]!!.jsonArray
            assertEquals(txs.size, c.ingestTransactions(txs.toString()).accepted, name)

            val expected = case["expected"]!!.jsonObject
            assertEquals(expected["usedToday"]!!.jsonPrimitive.long, c.getWallet().usedToday.minor, "$name usedToday")
            for ((month, want) in expected["months"]!!.jsonObject) {
                val s = c.computeSpendingSummary(month)
                val w = want.jsonObject
                assertEquals(w["totalSpent"]!!.jsonPrimitive.long, s.totalSpent.minor, "$name $month totalSpent")
                assertEquals(w["transactionCount"]!!.jsonPrimitive.int, s.transactionCount, "$name $month count")
                val wantDays = w["byDay"]!!.jsonArray.map { d -> d.jsonArray.let { it[0].jsonPrimitive.content to it[1].jsonPrimitive.long } }
                assertEquals(wantDays, s.byDay.map { it.date to it.spent.minor }, "$name $month byDay")
            }
        }
    }

    @Test
    fun unknownTimeZonesAreRejected() {
        for (zone in timeZones["invalidZones"]!!.jsonArray) {
            val e = assertFailsWith<CoreException> { core.setTimeZone(zone.jsonPrimitive.content) }
            assertEquals(ErrorCode.INVALID_ARGUMENT, e.code)
        }
    }

    @Test
    fun liveClockReportsCurrentTime() = runTest {
        core.resetData(DatasetConfig(seed = 42, transactionCount = 10, nowMillis = null))
        val before = System.currentTimeMillis()
        val updatedAt = core.getWallet().updatedAt
        kotlin.test.assertTrue(updatedAt in before..System.currentTimeMillis())
    }

    // ── prices ─────────────────────────────────────────────────────────────

    @Test
    fun priceTicks() {
        val prices = golden["prices"]!!.jsonObject
        val feed = PriceFeed(prices["symbols"]!!.jsonArray.map { it.jsonPrimitive.content }, prices["seed"]!!.jsonPrimitive.int)
        val actual = JsonArray(List(prices["batches"]!!.jsonArray.size) { JsonArray(feed.step().map { it.toJson() }) })
        assertEquals(prices["batches"], actual)
    }
}

// ── Domain → JSON, in exactly the shape core-contract's TS types use (absent = omitted) ──

private fun JsonObject.Companion.of(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    for ((k, v) in pairs) {
        when (v) {
            null -> Unit
            is JsonElement -> put(k, v)
            is String -> put(k, v)
            is Number -> put(k, v)
            is Boolean -> put(k, v)
            is Enum<*> -> put(k, v.name)
            else -> error("unsupported $v")
        }
    }
}

private fun Counterparty.toJson() = JsonObject.of("kind" to kind, "id" to id, "name" to name, "phone" to phone)

private fun Wallet.toJson() = JsonObject.of(
    "id" to id, "balance" to balance.minor, "dailyLimit" to dailyLimit.minor,
    "usedToday" to usedToday.minor, "updatedAt" to updatedAt,
)

private fun Transaction.toJson() = JsonObject.of(
    "id" to id, "idempotencyKey" to idempotencyKey, "type" to type, "category" to category,
    "amount" to amount.minor, "counterparty" to counterparty?.toJson(), "note" to note, "status" to status,
    "failureReason" to failureReason, "createdAt" to createdAt, "updatedAt" to updatedAt,
)

private fun TransactionPage.toJson() =
    JsonObject.of("items" to JsonArray(items.map { it.toJson() }), "nextCursor" to nextCursor)

private fun CategoryTotal.toJson() = JsonObject.of("category" to category, "total" to total.minor, "count" to count)
private fun DayTotal.toJson() = JsonObject.of("date" to date, "spent" to spent.minor, "income" to income.minor)
private fun BalanceCheck.toJson() = JsonObject.of(
    "ledgerBalance" to ledgerBalance.minor, "walletBalance" to walletBalance.minor, "consistent" to consistent,
)

private fun SpendingSummary.toJson() = JsonObject.of(
    "month" to month, "totalSpent" to totalSpent.minor, "totalIncome" to totalIncome.minor, "net" to net.minor,
    "transactionCount" to transactionCount,
    "byCategory" to JsonArray(byCategory.map { it.toJson() }),
    "byDay" to JsonArray(byDay.map { it.toJson() }),
    "balanceCheck" to balanceCheck.toJson(),
)

private fun IngestResult.toJson() = JsonObject.of(
    "accepted" to accepted, "rejected" to rejected, "duplicates" to duplicates,
    "errors" to buildJsonArray { errors.forEach { add(JsonObject.of("index" to it.index, "reason" to it.reason)) } },
)

private fun MoneyParseResult.toJson() = JsonObject.of("ok" to ok, "minor" to minor?.minor, "error" to error)

private fun PriceTick.toJson() =
    JsonObject.of("symbol" to symbol, "price" to price.minor, "changeBps" to changeBps, "seq" to seq)

