package com.pocketly.shared.bridge

import com.pocketly.shared.bridge.di.coreModule
import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.TransactionIngestor
import com.pocketly.shared.data.TransactionStore
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.IngestResult
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.MoneyFormatter
import com.pocketly.shared.domain.MoneyParseResult
import com.pocketly.shared.domain.PriceTick
import com.pocketly.shared.domain.SpendingCalculator
import com.pocketly.shared.domain.SpendingSummary
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.sync.PriceFeed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.withContext
import kotlin.concurrent.Volatile
import org.koin.dsl.koinApplication
import kotlin.time.TimeSource

/**
 * The facade both native adapters call:
 *  - Android: packages/core-kmp/android/.../HybridPocketlyCore.kt
 *  - iOS:     packages/core-kmp/ios/HybridPocketlyCore.swift
 *
 * It speaks domain types; the adapters only map them to and from Nitro structs.
 * Counterpart of packages/core-js/src/jsCore.ts.
 */
class PocketlyCore internal constructor(
    private val api: WalletApi,
    private val backend: FakeBackendControls,
    private val store: TransactionStore,
    private val ingestor: TransactionIngestor,
) {
    private val streamScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile
    private var computeMs = 0.0

    init {
        backend.reset(DatasetConfig.DEFAULT)
    }

    // ── Data / fake backend ────────────────────────────────────────────────

    @Throws(CoreException::class, CancellationException::class)
    suspend fun resetData(config: DatasetConfig) = withContext(Dispatchers.Default) { backend.reset(config) }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getWallet(): Wallet = api.getWallet()

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getTransactions(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage =
        api.getTransactions(cursor, limit, filter)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getTransaction(id: String): Transaction = api.getTransaction(id)

    // ── CPU-heavy work (BM-03, BM-04) ─────────────────────────────────────
    // Off the caller's thread on both platforms (Swift calls suspend funs on the main thread).

    @Throws(CoreException::class, CancellationException::class)
    suspend fun computeSpendingSummary(month: String): SpendingSummary = withContext(Dispatchers.Default) {
        timed { SpendingCalculator.compute(month, store.all(), store.balance()) }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun ingestTransactions(json: String): IngestResult = withContext(Dispatchers.Default) {
        timed { ingestor.ingest(json) }
    }

    // ── Tiny synchronous calls (BM-06) ────────────────────────────────────

    fun formatMoney(minor: Long): String = MoneyFormatter.format(Money(minor))

    fun formatMoneyBatch(minors: LongArray): List<String> = timed {
        List(minors.size) { MoneyFormatter.format(Money(minors[it])) }
    }

    fun parseMoney(input: String): MoneyParseResult = MoneyFormatter.parse(input)

    // ── Streams (BM-05, NFR-ARCH-04) ──────────────────────────────────────

    fun priceTicks(symbols: List<String>, intervalMs: Long, seed: Int): Flow<List<PriceTick>> =
        PriceFeed.ticks(symbols, intervalMs, seed)

    /** Callback form of [priceTicks] for the native adapters (Swift can't collect a Flow directly). */
    fun subscribePrices(
        symbols: List<String>,
        intervalMs: Long,
        seed: Int,
        onTicks: (List<PriceTick>) -> Unit,
    ): Cancellable {
        val job = priceTicks(symbols, intervalMs, seed).onEach(onTicks).launchIn(streamScope)
        return Cancellable { job.cancel() }
    }

    // ── Benchmark harness (benchmarking.md §5.2: "compute only" timing) ───

    fun lastComputeMs(): Double = computeMs

    private inline fun <T> timed(work: () -> T): T {
        val mark = TimeSource.Monotonic.markNow()
        try {
            return work()
        } finally {
            computeMs = mark.elapsedNow().inWholeNanoseconds / 1_000_000.0
        }
    }

    companion object {
        /** Builds a fully wired core. Each call gets its own isolated Koin graph. */
        fun create(): PocketlyCore = koinApplication { modules(coreModule()) }.koin.get()
    }
}

fun interface Cancellable {
    fun cancel()
}
