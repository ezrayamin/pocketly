package com.pocketly.shared.bridge

import com.pocketly.shared.bridge.di.coreModule
import com.pocketly.shared.data.CacheStore
import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.data.TransactionIngestor
import com.pocketly.shared.data.UserTimeZone
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.currentTimeMillis
import com.pocketly.shared.data.db.DatabaseDrivers
import com.pocketly.shared.data.fake.FakeWalletApi
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.IngestResult
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.MoneyFormatter
import com.pocketly.shared.domain.MoneyParseResult
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.PriceTick
import com.pocketly.shared.domain.SpendingCalculator
import com.pocketly.shared.domain.SpendingSummary
import com.pocketly.shared.domain.StaleInfo
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.sync.LedgerSync
import com.pocketly.shared.sync.PriceFeed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.withContext
import org.koin.dsl.koinApplication
import kotlin.concurrent.Volatile
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
    private val backend: FakeWalletApi,
    private val cache: CacheStore,
    private val timeZone: TimeZoneHolder,
    initialDataset: DatasetConfig,
    /** All database work runs here (one thread: SQLDelight drivers aren't shared). Tests inject a test dispatcher. */
    private val db: CoroutineDispatcher,
) {
    private val streamScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val ledgerSync = LedgerSync(api, cache)

    /** Databases open lazily, off the caller's thread; every data call awaits this first. */
    private val ready = streamScope.async(db) { backend.open(initialDataset) }

    @Volatile
    private var computeMs = 0.0

    @Volatile
    private var storageMs = 0.0

    private val controls: FakeBackendControls get() = backend

    // ── Data (ADR-0009: fake server DB + the app's local replica) ──────────

    @Throws(CoreException::class, CancellationException::class)
    suspend fun resetData(config: DatasetConfig) = onDb {
        controls.reset(config)
        cache.clear()
        try {
            ledgerSync.sync()
            cache.upsertWallet(api.getWallet(), currentTimeMillis())
        } catch (e: CoreException) {
            if (e.code !in STALEABLE) throw e // offline reset: replica stays empty
        }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getWallet(): Wallet = onDb {
        try {
            api.getWallet().also { cache.upsertWallet(it, currentTimeMillis()) }
        } catch (e: CoreException) {
            val cached = if (e.code in STALEABLE) cache.getWallet() else null
            cached?.let { (wallet, cachedAt) -> wallet.copy(stale = StaleInfo(e.code, cachedAt)) } ?: throw e
        }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getTransactions(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage {
        if (limit !in 1..MAX_PAGE_SIZE) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "limit must be 1..$MAX_PAGE_SIZE, got $limit")
        }
        return onDb {
            var stale: StaleInfo? = null
            if (cursor == null) {
                try {
                    ledgerSync.sync() // the first page is a refresh
                } catch (e: CoreException) {
                    val cachedAt = if (e.code in STALEABLE) cache.lastSyncedAt() else null
                    stale = StaleInfo(e.code, cachedAt ?: throw e)
                }
            }
            cache.page(cursor, limit, filter).copy(stale = stale)
        }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getTransaction(id: String): Transaction = onDb { cache.get(id) ?: api.getTransaction(id) }

    // ── Developer menu / fake backend controls (F11) ──────────────────────

    /** FR-DEV-02/03. resetData leaves it alone. */
    @Throws(CoreException::class)
    fun setNetworkSimulation(simulation: NetworkSimulation) {
        controls.networkSimulation = simulation
    }

    fun getNetworkSimulation(): NetworkSimulation = controls.networkSimulation

    /** FR-DEV-04. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun simulateIncomingTransfer(): Transaction = onDb { controls.simulateIncomingTransfer() }

    // ── Time (ADR-0006) ───────────────────────────────────────────────────

    /** IANA zone for the daily-limit day and month/day boundaries. Default "UTC". */
    @Throws(CoreException::class)
    fun setTimeZone(zoneId: String) {
        if (zoneId != timeZone.current.zoneId) timeZone.current = UserTimeZone(zoneId)
    }

    // ── CPU-heavy work (BM-03, BM-04): compute and storage timed separately ─

    @Throws(CoreException::class, CancellationException::class)
    suspend fun computeSpendingSummary(month: String): SpendingSummary = onDb {
        val mark = TimeSource.Monotonic.markNow()
        val transactions = cache.all()
        val walletBalance = cache.getWallet()?.first?.balance ?: Money.ZERO
        storageMs = mark.elapsedNow().inWholeNanoseconds / 1_000_000.0
        timed { SpendingCalculator.compute(month, timeZone.current.month(month), transactions, walletBalance) }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun ingestTransactions(json: String): IngestResult = onDb {
        val parsed = timed { TransactionIngestor.parseAndValidate(json) }
        val mark = TimeSource.Monotonic.markNow()
        val inserted = cache.insertIfAbsentMany(parsed.valid)
        storageMs = mark.elapsedNow().inWholeNanoseconds / 1_000_000.0
        IngestResult(inserted, parsed.rejected, parsed.valid.size - inserted, parsed.errors)
    }

    // ── Tiny synchronous calls (BM-06) ────────────────────────────────────

    fun formatMoney(minor: Long): String = MoneyFormatter.format(Money(minor))

    fun formatMoneyBatch(minors: LongArray): List<String> {
        storageMs = 0.0
        return timed { List(minors.size) { MoneyFormatter.format(Money(minors[it])) } }
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

    // ── Benchmark harness (benchmarking.md §5.2: compute vs storage) ──────

    fun lastComputeMs(): Double = computeMs

    /** Database time of the same call; the engines differ between builds (ADR-0009). */
    fun lastStorageMs(): Double = storageMs

    private suspend fun <T> onDb(block: suspend () -> T): T = withContext(db) {
        ready.await()
        block()
    }

    private inline fun <T> timed(work: () -> T): T {
        val mark = TimeSource.Monotonic.markNow()
        try {
            return work()
        } finally {
            computeMs = mark.elapsedNow().inWholeNanoseconds / 1_000_000.0
        }
    }

    companion object {
        const val MAX_PAGE_SIZE = 100

        /** Failures where the local replica stands in for the server (ADR-0009). */
        private val STALEABLE = setOf(ErrorCode.NETWORK_UNAVAILABLE, ErrorCode.NETWORK_TIMEOUT, ErrorCode.SERVER_ERROR)

        /**
         * Builds a fully wired core on [drivers] (two databases, ADR-0009). Each call gets its own
         * isolated Koin graph. The server is seeded with [dataset] only if its database is empty.
         * Native adapters pass [DatasetConfig.LIVE] and the platform drivers.
         */
        fun create(drivers: DatabaseDrivers, dataset: DatasetConfig = DatasetConfig.DEFAULT): PocketlyCore =
            create(drivers, dataset, singleThread())

        internal fun create(drivers: DatabaseDrivers, dataset: DatasetConfig, db: CoroutineDispatcher): PocketlyCore =
            koinApplication { modules(coreModule(drivers, dataset, db)) }.koin.get()

        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        private fun singleThread(): CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)
    }
}

fun interface Cancellable {
    fun cancel()
}
