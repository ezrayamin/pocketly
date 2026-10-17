package com.pocketly.shared.data

import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.bridge.CoreProbe
import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.PriceTick
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TxFilter
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Behaviour checks on in-memory SQLite. Exact-value parity is in contract/ContractFixturesTest. */
class PocketlyCoreTest {
    private val core = PocketlyCore.create(JvmDatabaseDrivers(), MemorySecureStore())

    /** On the test scheduler, so latencies and timeouts run on virtual time. */
    private fun TestScope.virtualTimeCore() = PocketlyCore.create(JvmDatabaseDrivers(), DatasetConfig.DEFAULT, StandardTestDispatcher(testScheduler), MemorySecureStore())

    @Test
    fun walletBalanceMatchesLedger() = runTest {
        core.getWallet() // cached
        core.getTransactions(null, 20, null) // replica synced
        val summary = core.computeSpendingSummary("2026-09")
        assertTrue(summary.balanceCheck.consistent)
        assertEquals(core.getWallet().balance, summary.balanceCheck.walletBalance)
    }

    @Test
    fun paginationHasNoDuplicates() = runTest {
        val ids = mutableListOf<String>()
        var cursor: String? = null
        do {
            val page = core.getTransactions(cursor, 17, null)
            ids += page.items.map { it.id }
            cursor = page.nextCursor
        } while (cursor != null)
        assertEquals(DatasetConfig.DEFAULT.transactionCount, ids.size)
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun filterAppliesToEveryItem() = runTest {
        val page = core.getTransactions(null, 100, TxFilter(statuses = listOf(TransactionStatus.PENDING)))
        assertTrue(page.items.all { it.status == TransactionStatus.PENDING })
    }

    @Test
    fun errorsCarryCodes() = runTest {
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.getTransaction("nope") }.code)
        assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { core.getTransactions(null, 0, null) }.code)
        assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { core.getTransactions("x", 20, null) }.code)
        assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { CoreProbe(core).ingestTransactions("{") }.code)
        assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { core.computeSpendingSummary("2026-13") }.code)
    }

    @Test
    fun priceFlowIsDeterministic() = runTest {
        val a = core.priceTicks(listOf("BTC", "ETH"), 1, 7).take(3).toList()
        val b = core.priceTicks(listOf("BTC", "ETH"), 1, 7).take(3).toList()
        assertEquals(a, b)
        assertEquals(listOf(1, 2, 3), a.map { it.first().seq })
    }

    @Test
    fun callbackSubscriptionCancels() = runTest {
        val received = CompletableDeferred<List<PriceTick>>()
        val sub = core.subscribePrices(listOf("SOL"), 1, 1) { received.complete(it) }
        assertEquals("SOL", received.await().first().symbol)
        sub.cancel()
        assertNull(core.priceTicks(emptyList(), 1, 1).first().firstOrNull())
    }

    // Timing on runTest's virtual clock (the JS mirror uses Jest fake timers).

    @Test
    fun slowModeAnswersAfterTwoToFiveSeconds() = runTest {
        val core = virtualTimeCore()
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.SLOW, failureRatePercent = 0))
        core.getTransactions(null, 1, null) // let the databases open first
        val start = testScheduler.currentTime
        core.getWallet()
        assertTrue(testScheduler.currentTime - start in 2_000L..5_000L)
    }

    @Test
    fun timeoutModeFailsWithNetworkTimeoutAfterTenSeconds() = runTest {
        val core = virtualTimeCore() // nothing cached yet, so the timeout is an error
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.TIMEOUT, failureRatePercent = 0))
        val start = testScheduler.currentTime
        assertEquals(ErrorCode.NETWORK_TIMEOUT, assertFailsWith<CoreException> { core.getWallet() }.code)
        assertEquals(10_000L, testScheduler.currentTime - start)
    }

    @Test
    fun normalLatencyIsExact() = runTest {
        val core = virtualTimeCore()
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, failureRatePercent = 0, normalLatencyMs = 300))
        val start = testScheduler.currentTime
        core.getWallet()
        assertEquals(300L, testScheduler.currentTime - start)
    }

    @Test
    fun computeTimingIsRecorded() = runTest {
        core.resetData(DatasetConfig(seed = 7, transactionCount = 10_000, nowMillis = DatasetConfig.DEFAULT.nowMillis))
        core.computeSpendingSummary("2026-09")
        assertTrue(CoreProbe(core).lastComputeMs() > 0.0)
    }
}
