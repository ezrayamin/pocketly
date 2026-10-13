package com.pocketly.shared.data.fake

import com.pocketly.shared.data.ChangesPage
import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.ServerOtpVerify
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.data.TransactionDtoValidator
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.currentTimeMillis
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.domain.ZonedCalendar
import kotlin.concurrent.Volatile

/**
 * In-process fake backend (requirements §4.2) on its own database (ADR-0009). Its clock is
 * frozen at `DatasetConfig.nowMillis` when given (tests, benchmarks) and is the device clock
 * otherwise (the app). State survives restarts (FR-FAKE-07).
 * Mirrors packages/core-js/src/data/fake/fakeWalletApi.ts.
 */
internal class FakeWalletApi(
    private val store: ServerStore,
    private val timeZone: TimeZoneHolder,
    /** The OTP side's clock (ADR-0013): the device's, not the dataset's frozen one. */
    otpClock: () -> Long = ::currentTimeMillis,
) : WalletApi, FakeBackendControls {
    private val network = NetworkSimulator()
    private val otp = OtpServer(otpClock)

    override suspend fun requestOtp(phone: String): OtpSendResult {
        network.beforeCall()
        return otp.send(phone)
    }

    override suspend fun verifyOtp(phone: String, code: String): ServerOtpVerify {
        network.beforeCall()
        return otp.verify(phone, code)
    }

    @Volatile
    private var frozenNow: Long? = null
    private var simulatedIncoming = 0

    override var networkSimulation: NetworkSimulation
        get() = network.get()
        set(value) = network.set(value)

    fun now(): Long = frozenNow ?: currentTimeMillis()

    /** Seeds the database with [config] only if it's empty (the app keeps its data). */
    fun open(config: DatasetConfig) {
        if (store.getMeta(META_SEEDED) == null) {
            reset(config)
            return
        }
        frozenNow = store.getMeta(META_FROZEN_NOW)?.takeIf { it.isNotEmpty() }?.toLong()
        simulatedIncoming = store.getMeta(META_SIMULATED_INCOMING)?.toInt() ?: 0
    }

    override fun reset(config: DatasetConfig) {
        if (config.transactionCount < 1) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "transactionCount must be >= 1")
        }
        config.extraTransactions.forEachIndexed { index, tx ->
            TransactionDtoValidator.validate(tx)?.let {
                throw CoreException(ErrorCode.INVALID_ARGUMENT, "extraTransactions[$index]: $it")
            }
        }
        frozenNow = config.nowMillis
        simulatedIncoming = 0
        store.replaceAll(
            SeedData.generate(config, now()) + config.extraTransactions,
            mapOf(
                META_SEEDED to "1",
                META_FROZEN_NOW to (config.nowMillis?.toString() ?: ""),
                META_SIMULATED_INCOMING to "0",
            ),
        )
    }

    override fun simulateIncomingTransfer(): Transaction {
        val tx = SeedData.simulatedIncomingTransfer(simulatedIncoming + 1, now())
        store.insert(tx)
        simulatedIncoming += 1
        store.setMeta(META_SIMULATED_INCOMING, simulatedIncoming.toString())
        return tx
    }

    override suspend fun getWallet(): Wallet {
        network.beforeCall()
        val now = now()
        val zone = timeZone.current.offsetAt
        // FR-TRF-10: the daily limit resets at local midnight in the user's zone (ADR-0006).
        val todayStart = ZonedCalendar.localMidnight(ZonedCalendar.localEpochDay(now, zone), zone)
        return Wallet(
            id = SeedData.WALLET_ID,
            balance = Money(store.balance()),
            dailyLimit = SeedData.DAILY_LIMIT,
            usedToday = Money(store.usedSince(todayStart)),
            updatedAt = now,
        )
    }

    override suspend fun getChanges(afterToken: String?, limit: Int): ChangesPage {
        network.beforeCall()
        if (limit !in 1..MAX_CHANGES_PAGE) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "limit must be 1..$MAX_CHANGES_PAGE")
        }
        var afterUpdatedAt = -1L
        var afterId = ""
        if (afterToken != null) {
            val m = TOKEN.find(afterToken) ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Malformed sync token")
            afterUpdatedAt = m.groupValues[1].toLong()
            afterId = m.groupValues[2]
        }
        val rows = store.changesSince(afterUpdatedAt, afterId, limit + 1L)
        val items = rows.take(limit)
        val next = items.lastOrNull()?.let { "${it.updatedAt}:${it.id}" } ?: afterToken
        return ChangesPage(items, next, hasMore = rows.size > limit)
    }

    override suspend fun getTransaction(id: String): Transaction {
        network.beforeCall()
        return store.get(id) ?: throw CoreException(ErrorCode.NOT_FOUND, "No transaction $id")
    }

    companion object {
        /** Server-side page size cap for getChanges (sync). Same as core-js. */
        const val MAX_CHANGES_PAGE = 500
        private const val META_SEEDED = "seeded"
        private const val META_FROZEN_NOW = "frozenNowMillis"
        private const val META_SIMULATED_INCOMING = "simulatedIncoming"
        private val TOKEN = Regex("""^(-?\d+):(.*)$""")
    }
}
