package com.pocketly.shared.data

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pocketly.shared.data.fake.FakeWalletApi
import com.pocketly.shared.data.fake.PaymentRequestRow
import com.pocketly.shared.data.fake.SeedData
import com.pocketly.shared.data.fake.ServerStore
import com.pocketly.shared.db.server.ServerDatabase
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.OtpVerifyOutcome
import com.pocketly.shared.domain.QrCode
import com.pocketly.shared.domain.QrKind
import com.pocketly.shared.domain.QrPolicy
import com.pocketly.shared.domain.QrRejectReason
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferPolicy
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import java.util.Properties
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * ADR-0016: the QR rules and the fake server's merchant endpoints, against fixtures/qr.json.
 * Mirrors packages/core-js/__tests__/qrServer.test.ts. runBlocking, not runTest: the server works
 * on Dispatchers.Default in real time (ADR-0007 §2).
 */
class QrServerTest {
    private val fixture = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "qr.json").readText(),
    ).jsonObject
    private val now = DatasetConfig.DEFAULT.nowMillis!!

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content

    private fun openServer(otpClock: () -> Long = { 0L }): FakeWalletApi = FakeWalletApi(
        ServerStore(JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY, Properties(), ServerDatabase.Schema)),
        TimeZoneHolder(),
        otpClock,
    ).also { it.open(DatasetConfig.DEFAULT) }

    private suspend fun error(block: suspend () -> Unit): ErrorCode? = try {
        block()
        null
    } catch (e: CoreException) {
        e.code
    }

    private fun expectedCode(e: JsonObject) = if (e["ok"]!!.jsonPrimitive.boolean) {
        QrCode(
            kind = QrKind.valueOf(e.str("kind")!!),
            merchantId = e.str("merchantId"),
            requestId = e.str("requestId"),
            userId = e.str("userId"),
        )
    } else {
        QrCode(QrRejectReason.valueOf(e.str("reason")!!))
    }

    // ── rules ────────────────────────────────────────────────────────────

    @Test
    fun usesTheParametersInTheFixture() {
        val p = fixture["params"]!!.jsonObject
        assertEquals(p["maxLength"]!!.jsonPrimitive.int, QrPolicy.MAX_LENGTH)
        assertEquals(p["minAmount"]!!.jsonPrimitive.long, TransferPolicy.MIN_AMOUNT)
        assertEquals(p["fee"]!!.jsonPrimitive.long, TransferPolicy.FEE)
    }

    @Test
    fun parseCases() {
        val parse = fixture["parse"]!!.jsonObject
        for (c in parse["cases"]!!.jsonArray.map { it.jsonObject }) {
            val input = c.str("input")!!
            assertEquals(expectedCode(c["expected"]!!.jsonObject), QrPolicy.parse(input), "\"$input\"")
        }
        val tooLong = parse["tooLong"]!!.jsonObject
        val prefix = tooLong.str("prefix")!!
        for (c in tooLong["cases"]!!.jsonArray.map { it.jsonObject }) {
            val length = c["length"]!!.jsonPrimitive.int
            val code = QrPolicy.parse(prefix + "x".repeat(length - prefix.length))
            assertEquals(QrRejectReason.valueOf(c.str("reason")!!), code.reason, "length $length")
        }
    }

    @Test
    fun neverThrowsWhateverTheInput() {
        for (input in listOf("\u0000", "\uD800", "pocketly://pay/v1?m=m-01&r", "pocketly://pay/v99999999999999999999?m=x", "%%%", "?&=&")) {
            assertFalse(QrPolicy.parse(input).ok, input)
        }
    }

    @Test
    fun seedMerchantsAndRequestsAreTheFixtures() {
        val merchants = fixture["merchants"]!!.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
        assertEquals(
            merchants.map { Triple(it.str("id"), it.str("name"), it.str("category")) },
            SeedData.MERCHANTS.map { Triple(it.counterparty.id, it.counterparty.name, it.category.name) },
        )
        val seeded = fixture["paymentRequests"]!!.jsonObject["seeded"]!!.jsonArray.map { it.jsonObject }
        assertEquals(
            seeded.map {
                PaymentRequestRow(
                    it.str("id")!!, it.str("merchantId")!!, it["amount"]!!.jsonPrimitive.long,
                    now + it["expiresInMs"]!!.jsonPrimitive.long, if (it["paid"]!!.jsonPrimitive.boolean) "external" else null,
                )
            },
            SeedData.seedPaymentRequests(now),
        )
    }

    @Test
    fun myQrPayloadsRoundTrip() {
        val payload = QrPolicy.userPayload("u-0123456789ab")
        assertEquals(fixture["myQr"]!!.jsonObject.str("payloadPrefix") + "u-0123456789ab", payload)
        assertEquals(QrCode(kind = QrKind.USER, userId = "u-0123456789ab"), QrPolicy.parse(payload))
    }

    // ── server ───────────────────────────────────────────────────────────

    @Test
    fun lookupCases() = runBlocking {
        for (c in fixture["lookup"]!!.jsonObject["cases"]!!.jsonArray.map { it.jsonObject }) {
            val api = openServer()
            val merchantId = c.str("merchantId")!!
            val requestId = c.str("requestId")
            val e = c["expect"]!!.jsonObject
            val label = "$merchantId $requestId"
            if (e.containsKey("error")) {
                assertEquals(e.str("error"), error { api.getPaymentTarget(merchantId, requestId) }?.name, label)
                continue
            }
            val target = api.getPaymentTarget(merchantId, requestId)
            assertEquals(Counterparty(CounterpartyKind.MERCHANT, merchantId, e.str("merchantName")!!), target.merchant, label)
            val expected = e["amount"]?.let { OpenPaymentRequest(requestId!!, Money(it.jsonPrimitive.long), now + e["expiresInMs"]!!.jsonPrimitive.long) }
            assertEquals(expected, target.request, label)
        }
    }

    @Test
    fun walksTheServerSteps() = runBlocking {
        val api = openServer()
        val merchants = fixture["merchants"]!!.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
        val results = mutableListOf<Transaction?>()
        for ((i, stepEl) in fixture["server"]!!.jsonObject["steps"]!!.jsonArray.withIndex()) {
            val step = stepEl.jsonObject
            val key = step.str("key")!!
            val before = api.getWallet()
            val request = step["request"]?.jsonObject
            val transfer = step["transfer"]?.jsonObject
            var tx: Transaction? = null
            val code = error {
                tx = if (transfer != null) {
                    api.transfer(TransferRequest(transfer.str("recipientId")!!, Money(transfer["amount"]!!.jsonPrimitive.long)), key)
                } else {
                    api.payMerchant(QrPaymentRequest(request!!.str("merchantId")!!, request.str("requestId"), Money(request["amount"]!!.jsonPrimitive.long)), key)
                }
            }
            val e = step["expect"]!!.jsonObject
            val label = "step $i"
            when {
                e.containsKey("error") -> assertEquals(e.str("error"), code?.name, label)
                e.containsKey("sameAs") -> assertEquals(results[e["sameAs"]!!.jsonPrimitive.int], tx, label)
                else -> {
                    assertEquals(listOf(e.str("status"), e.str("failureReason"), e.str("id")), listOf(tx?.status?.name, tx?.failureReason?.name, tx?.id), label)
                    val m = merchants.first { it.str("id") == request!!.str("merchantId") }
                    assertEquals(
                        listOf(key, TransactionType.QR_PAYMENT, m.str("category"), Counterparty(CounterpartyKind.MERCHANT, m.str("id")!!, m.str("name")!!)),
                        listOf(tx!!.idempotencyKey, tx!!.type, tx!!.category.name, tx!!.counterparty),
                        label,
                    )
                }
            }
            results += tx
            val after = api.getWallet()
            assertEquals(
                step["balanceDelta"]!!.jsonPrimitive.long to step["usedTodayDelta"]!!.jsonPrimitive.long,
                (after.balance.minor - before.balance.minor) to (after.usedToday.minor - before.usedToday.minor),
                label,
            )
        }
    }

    @Test
    fun aHeldPaymentHoldsItsRequestOneThatFailsGivesItBack() = runBlocking {
        val api = openServer()
        api.networkSimulation = NetworkSimulation(NetworkMode.TIMEOUT, 100)
        val job = launch { api.payMerchant(QrPaymentRequest("m-01", "pr-0001", Money(1_250)), "held") }
        delay(50)
        api.networkSimulation = NetworkSimulation.NORMAL
        assertEquals(ErrorCode.QR_ALREADY_PAID, error { api.getPaymentTarget("m-01", "pr-0001") })
        api.advanceClock(TransferPolicy.PENDING_RESOLVE_MAX_MS)
        assertEquals(TransactionStatus.FAILED, api.getTransferByKey("held").status)
        assertEquals("pr-0001", api.getPaymentTarget("m-01", "pr-0001").request?.id)
        job.cancel()
    }

    @Test
    fun resetReseedsTheRequestsAndRestartsTheNumbering() = runBlocking {
        val api = openServer()
        api.payMerchant(QrPaymentRequest("m-01", "pr-0001", Money(1_250)), "a")
        api.reset(DatasetConfig.DEFAULT)
        assertEquals("qrp-1", api.payMerchant(QrPaymentRequest("m-01", "pr-0001", Money(1_250)), "b").id)
    }

    // ── the account's user id (ADR-0016 §6) ──────────────────────────────

    private suspend fun verify(api: FakeWalletApi, phone: String): String? {
        api.requestOtp(phone)
        val answer = api.verifyOtp(phone, "123456")
        assertEquals(OtpVerifyOutcome.VERIFIED, answer.result.outcome)
        return answer.userId
    }

    @Test
    fun theUserIdIsRandomKeptForTheSamePhoneAndAcrossResetsNewForAnotherPhone() = runBlocking {
        val pattern = Regex(fixture["myQr"]!!.jsonObject.str("userIdPattern")!!)
        var otpNow = 0L
        val api = openServer { otpNow }
        val first = verify(api, "+6281234567890")!!
        assertTrue(pattern.matches(first), first)
        assertEquals(first, api.getAccountUserId("+6281234567890"))
        assertEquals(ErrorCode.NOT_FOUND, error { api.getAccountUserId("+6285712345678") }) // not this account
        api.reset(DatasetConfig.DEFAULT)
        assertEquals(first, api.getAccountUserId("+6281234567890"))
        otpNow += 60_000 // past the resend wait
        assertEquals(first, verify(api, "+6281234567890"))
        otpNow += 60_000
        val other = verify(api, "+6285712345678")!!
        assertTrue(pattern.matches(other), other)
        assertNotEquals(first, other)
    }

    @Test
    fun adoptsAnAccountVerifiedBeforeTheServerRecordedIt() = runBlocking {
        val api = openServer()
        val userId = api.getAccountUserId("+6281234567890")
        assertTrue(Regex(fixture["myQr"]!!.jsonObject.str("userIdPattern")!!).matches(userId), userId)
        assertEquals(userId, api.getAccountUserId("+6281234567890"))
        assertEquals(ErrorCode.NOT_FOUND, error { api.getAccountUserId("+6285712345678") })
    }

    @Test
    fun looksTheAccountUpAsItselfSoTheClientCanRefusePayingYourself() = runBlocking {
        val api = openServer()
        val userId = verify(api, "+6281234567890")!!
        assertEquals(com.pocketly.shared.domain.Contact(userId, "You", "+6281234567890"), api.getContact(userId))
        assertEquals(ErrorCode.NOT_FOUND, error { api.getContact("u-ffffffffffff") })
    }
}
