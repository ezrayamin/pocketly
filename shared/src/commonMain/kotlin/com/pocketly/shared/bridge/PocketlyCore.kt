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
import com.pocketly.shared.domain.AmountCheck
import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.BiometricEnableResult
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.BiometricStatus
import com.pocketly.shared.domain.BiometricUnlockResult
import com.pocketly.shared.domain.ContactSearchResult
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.IngestResult
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.MoneyFormatter
import com.pocketly.shared.domain.MoneyParseResult
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.OtpVerifyOutcome
import com.pocketly.shared.domain.OtpVerifyResult
import com.pocketly.shared.domain.PhoneCheck
import com.pocketly.shared.domain.PinCheck
import com.pocketly.shared.domain.PriceTick
import com.pocketly.shared.domain.SpendingCalculator
import com.pocketly.shared.domain.SpendingSummary
import com.pocketly.shared.domain.StaleInfo
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TransferAuth
import com.pocketly.shared.domain.TransferDraft
import com.pocketly.shared.domain.TransferResult
import com.pocketly.shared.domain.TransferReview
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.UnlockResult
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.security.BiometricAuthenticator
import com.pocketly.shared.security.BiometricSigner
import com.pocketly.shared.security.InstallMarker
import com.pocketly.shared.security.NoBiometricSigner
import com.pocketly.shared.security.PhonePolicy
import com.pocketly.shared.security.PinAuthenticator
import com.pocketly.shared.security.PinCrypto
import com.pocketly.shared.security.PinPolicy
import com.pocketly.shared.security.SecureStore
import com.pocketly.shared.security.platformPinCrypto
import com.pocketly.shared.sync.LedgerSync
import com.pocketly.shared.sync.PriceFeed
import com.pocketly.shared.sync.TransferFlow
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
    /** Builds the PIN logic (ADR-0010) around this core's install marker (the replica's cache_meta). */
    pin: (InstallMarker) -> PinAuthenticator,
    /** Builds biometric unlock (ADR-0012) on top of the PIN logic. */
    biometric: (PinAuthenticator) -> BiometricAuthenticator,
    /** Secure random for idempotency keys (ADR-0014). */
    randomBytes: (Int) -> ByteArray,
    /** Device clock, for the app's own pending transfer rows. */
    clock: () -> Long,
) {
    private val streamScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val ledgerSync = LedgerSync(api, cache)

    /** Databases open lazily, off the caller's thread; every data call awaits this first. */
    private val ready = streamScope.async(db) { backend.open(initialDataset) }

    private val pin = pin(object : InstallMarker {
        override suspend fun get(): String? = onDb { cache.installId() }
        override suspend fun set(id: String) {
            onDb { cache.setInstallId(id) }
        }
    })

    private val biometric = biometric(this.pin)

    private val transfers = TransferFlow(api, cache, this.pin, this.biometric, ::fetchWallet, randomBytes, clock)

    @Volatile
    internal var computeMs = 0.0

    @Volatile
    internal var storageMs = 0.0

    private val controls: FakeBackendControls get() = backend

    // ── Data (ADR-0009: fake server DB + the app's local replica) ──────────

    @Throws(CoreException::class, CancellationException::class)
    suspend fun resetData(config: DatasetConfig) = onDb {
        controls.reset(config)
        transfers.reset()
        cache.clear()
        try {
            ledgerSync.sync()
            fetchWallet()
        } catch (e: CoreException) {
            if (e.code !in STALEABLE) throw e // offline reset: replica stays empty
        }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getWallet(): Wallet = onDb {
        try {
            fetchWallet()
        } catch (e: CoreException) {
            val cached = if (e.code in STALEABLE) cache.getWallet() else null
            cached?.let { (wallet, cachedAt) -> wallet.copy(stale = StaleInfo(e.code, cachedAt)) } ?: throw e
        }
    }

    /** From the server into the replica, unless the replica was cleared meanwhile (logout). */
    private suspend fun fetchWallet(): Wallet {
        val generation = cache.generation
        return api.getWallet().also { if (cache.generation == generation) cache.upsertWallet(it, currentTimeMillis()) }
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

    /** BM-04 (CoreProbe, perf builds only): parse, validate, write to the replica; timed in parts. */
    internal suspend fun ingestTransactions(json: String): IngestResult = onDb {
        val parsed = timed { TransactionIngestor.parseAndValidate(json) }
        val mark = TimeSource.Monotonic.markNow()
        val inserted = cache.insertIfAbsentMany(parsed.valid)
        storageMs = mark.elapsedNow().inWholeNanoseconds / 1_000_000.0
        IngestResult(inserted, parsed.rejected, parsed.valid.size - inserted, parsed.errors)
    }

    // ── Auth & App Lock (F1, F2; ADR-0010) ────────────────────────────────

    /** FR-AUTH-03. */
    fun checkPin(pin: String): PinCheck = PinPolicy.check(pin)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun setPin(pin: String) = this.pin.setPin(pin)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun verifyPin(pin: String): UnlockResult = this.pin.verifyPin(pin)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getAuthState(): AuthState = pin.getAuthState()

    @Throws(CoreException::class, CancellationException::class)
    suspend fun resetAuth() = biometric.reset()

    /** NFR-SEC-05. The replica first: if the secrets then fail to go, none of the history is left. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun logout() {
        onDb {
            transfers.reset()
            cache.clear()
        }
        biometric.reset()
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getAutoLockTimeout(): Long = pin.getAutoLockTimeout()

    @Throws(CoreException::class, CancellationException::class)
    suspend fun setAutoLockTimeout(ms: Long) = pin.setAutoLockTimeout(ms)

    // ── Phone + OTP onboarding (FR-AUTH-01/02; ADR-0013) ───────────────────

    /** FR-AUTH-01: an Indonesian mobile number as typed (a leading 0 is allowed and dropped). */
    fun checkPhone(nationalNumber: String): PhoneCheck = PhonePolicy.check(nationalNumber)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun requestOtp(phone: String): OtpSendResult {
        if (!PhonePolicy.isValidE164(phone)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "not a valid +62 mobile number")
        return onDb { api.requestOtp(phone) }
    }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun verifyOtp(phone: String, code: String): OtpVerifyResult {
        if (!PhonePolicy.isValidE164(phone)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "not a valid +62 mobile number")
        if (!PhonePolicy.isOtpCode(code)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "the code has ${PhonePolicy.OTP_LENGTH} digits")
        val answer = onDb { api.verifyOtp(phone, code) }
        if (answer.result.outcome == OtpVerifyOutcome.VERIFIED && answer.sessionToken != null) {
            this.pin.rememberVerifiedPhone(phone, answer.sessionToken)
        }
        return answer.result
    }

    // ── Biometrics (FR-AUTH-04; ADR-0012) ──────────────────────────────────

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getBiometricStatus(): BiometricStatus = biometric.status()

    @Throws(CoreException::class, CancellationException::class)
    suspend fun enableBiometrics(pin: String, prompt: BiometricPromptText): BiometricEnableResult = biometric.enable(pin, prompt)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun disableBiometrics() = biometric.disable()

    @Throws(CoreException::class, CancellationException::class)
    suspend fun unlockWithBiometrics(prompt: BiometricPromptText): BiometricUnlockResult = biometric.unlock(prompt)

    // ── P2P transfer (F5, FR-TRF-01..11; ADR-0014) ─────────────────────────
    // On the database thread like everything that touches the replica; the waits (server,
    // biometric prompt, PIN hashing) suspend and don't hold it.

    @Throws(CoreException::class, CancellationException::class)
    suspend fun searchContacts(query: String): ContactSearchResult = onDb { transfers.searchContacts(query) }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun startTransfer(recipientId: String): TransferDraft = onDb { transfers.startTransfer(recipientId) }

    /** FR-TRF-02, synchronous: reads only the draft in memory. */
    @Throws(CoreException::class)
    fun checkTransferAmount(text: String): AmountCheck = transfers.checkTransferAmount(text)

    @Throws(CoreException::class, CancellationException::class)
    suspend fun reviewTransfer(amount: Money, note: String?): TransferReview = onDb { transfers.reviewTransfer(amount, note) }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun confirmTransfer(id: String, auth: TransferAuth?): TransferResult = onDb { transfers.confirmTransfer(id, auth) }

    @Throws(CoreException::class, CancellationException::class)
    suspend fun getTransferStatus(id: String): TransferResult = onDb { transfers.getTransferStatus(id) }

    /** Tests only: moves the fake server's frozen clock forward (held transfers settle by it). */
    internal fun advanceServerClock(ms: Long) = backend.advanceClock(ms)

    /** FR-TRF-10, developer menu. */
    @Throws(CoreException::class, CancellationException::class)
    suspend fun setDailyLimit(minor: Money) = onDb { controls.setDailyLimit(minor) }

    // ── Tiny synchronous calls (BM-06) ────────────────────────────────────

    fun formatMoney(minor: Long): String = MoneyFormatter.format(Money(minor))

    /** BM-06 batched (CoreProbe, perf builds only). */
    internal fun formatMoneyBatch(minors: LongArray): List<String> {
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

    // ── Internals ──────────────────────────────────────────────────────────

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
         * Builds a fully wired core on [drivers] (two databases, ADR-0009) and [secureStore]
         * (ADR-0010). Each call gets its own isolated Koin graph. The server is seeded with
         * [dataset] only if its database is empty. Native adapters pass the platform drivers and
         * store, and [DatasetConfig.LIVE].
         */
        fun create(
            drivers: DatabaseDrivers,
            secureStore: SecureStore,
            dataset: DatasetConfig = DatasetConfig.DEFAULT,
            biometricSigner: BiometricSigner = NoBiometricSigner,
        ): PocketlyCore = create(drivers, dataset, singleThread(), secureStore, biometricSigner = biometricSigner)

        internal fun create(
            drivers: DatabaseDrivers,
            dataset: DatasetConfig,
            db: CoroutineDispatcher,
            secureStore: SecureStore,
            crypto: PinCrypto = platformPinCrypto(),
            clock: () -> Long = ::currentTimeMillis,
            pinIterations: Int = PinPolicy.ITERATIONS,
            biometricSigner: BiometricSigner = NoBiometricSigner,
        ): PocketlyCore {
            // PBKDF2 blocks for hundreds of ms: off the database thread, which other calls share.
            val pin = { marker: InstallMarker -> PinAuthenticator(secureStore, crypto, marker, Dispatchers.Default, clock, pinIterations) }
            val biometric = { auth: PinAuthenticator -> BiometricAuthenticator(auth, biometricSigner, crypto, clock) }
            return koinApplication { modules(coreModule(drivers, dataset, db, pin, biometric, clock, crypto::randomBytes)) }.koin.get()
        }

        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        private fun singleThread(): CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)
    }
}

fun interface Cancellable {
    fun cancel()
}
