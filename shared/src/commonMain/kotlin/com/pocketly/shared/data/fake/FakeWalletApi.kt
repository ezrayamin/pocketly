package com.pocketly.shared.data.fake

import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.data.TransactionStore
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.currentTimeMillis
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.domain.ZonedCalendar
import kotlin.concurrent.Volatile

/**
 * In-process fake backend (requirements §4.2). Serves straight from the store.
 * Its clock is frozen at `DatasetConfig.nowMillis` when given (tests, benchmarks) and is
 * the device clock otherwise (the app). Latency/failure simulation (FR-FAKE-04) arrives
 * with the developer menu. Mirrors packages/core-js/src/data/fakeWalletApi.ts.
 */
internal class FakeWalletApi(
    private val store: TransactionStore,
    private val timeZone: TimeZoneHolder,
) : WalletApi, FakeBackendControls {
    private val network = NetworkSimulator()

    @Volatile
    private var frozenNow: Long? = null
    private var simulatedIncoming = 0

    override var networkSimulation: NetworkSimulation
        get() = network.get()
        set(value) = network.set(value)

    fun now(): Long = frozenNow ?: currentTimeMillis()

    override fun reset(config: DatasetConfig) {
        if (config.transactionCount < 1) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "transactionCount must be >= 1")
        }
        frozenNow = config.nowMillis
        simulatedIncoming = 0
        store.replaceAll(SeedData.generate(config, now()))
    }

    override fun simulateIncomingTransfer(): Transaction {
        val tx = SeedData.simulatedIncomingTransfer(++simulatedIncoming, now())
        store.insertAll(listOf(tx))
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
            balance = store.balance(),
            dailyLimit = SeedData.DAILY_LIMIT,
            usedToday = store.usedSince(todayStart),
            updatedAt = now,
        )
    }

    override suspend fun getTransactions(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage {
        network.beforeCall()
        if (limit !in 1..MAX_PAGE_SIZE) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "limit must be 1..$MAX_PAGE_SIZE, got $limit")
        }
        return store.page(cursor, limit, filter)
    }

    override suspend fun getTransaction(id: String): Transaction {
        network.beforeCall()
        return store.get(id) ?: throw CoreException(ErrorCode.NOT_FOUND, "No transaction $id")
    }

    companion object {
        const val MAX_PAGE_SIZE = 100
    }
}
