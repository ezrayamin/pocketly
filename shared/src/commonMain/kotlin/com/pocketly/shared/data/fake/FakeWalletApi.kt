package com.pocketly.shared.data.fake

import com.pocketly.shared.data.ChangesPage
import com.pocketly.shared.data.ContactSearch
import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.ServerOtpVerify
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.data.TransactionDtoValidator
import com.pocketly.shared.data.TransferRequest
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.currentTimeMillis
import com.pocketly.shared.domain.AmountLimits
import com.pocketly.shared.domain.AmountRejectReason
import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferPolicy
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.domain.ZonedCalendar
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    /** Where the server's own work runs (the core's database thread in the app). */
    serverDispatcher: CoroutineDispatcher = Dispatchers.Default,
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
    @Volatile
    private var dailyLimit = SeedData.DAILY_LIMIT
    private var transfers = 0

    /** Anything that reads and then writes server state runs one at a time (calls arrive in parallel). */
    private val serial = Mutex()

    /** ADR-0007 §2: the server's own work, which a client giving up doesn't cancel. */
    private val serverScope = CoroutineScope(SupervisorJob() + serverDispatcher)

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
        dailyLimit = store.getMeta(META_DAILY_LIMIT)?.toLong()?.let(::Money) ?: SeedData.DAILY_LIMIT
        transfers = store.getMeta(META_TRANSFERS)?.toInt() ?: 0
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
        dailyLimit = SeedData.DAILY_LIMIT
        transfers = 0
        store.replaceAll(
            SeedData.generate(config, now()) + config.extraTransactions,
            mapOf(
                META_SEEDED to "1",
                META_FROZEN_NOW to (config.nowMillis?.toString() ?: ""),
                META_SIMULATED_INCOMING to "0",
                META_DAILY_LIMIT to SeedData.DAILY_LIMIT.minor.toString(),
                META_TRANSFERS to "0",
            ),
        )
    }

    override fun setDailyLimit(minor: Money) {
        if (minor.minor !in 0..Money.MAX_AMOUNT_MINOR) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "dailyLimit must be a whole number 0..MAX_AMOUNT_MINOR")
        }
        store.setMeta(META_DAILY_LIMIT, minor.minor.toString())
        dailyLimit = minor
    }

    /** Tests only: the simulator, to skip seeded draws. */
    internal fun simulatorForTests(): NetworkSimulator = network

    /** Tests only: moves a frozen clock forward (pending transfers settle by it). */
    fun advanceClock(ms: Long) {
        val frozen = frozenNow ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "the clock is not frozen")
        frozenNow = frozen + ms
    }

    override suspend fun searchContacts(query: String): List<Contact> {
        network.beforeCall()
        return ContactSearch.match(query, DIRECTORY)
    }

    override suspend fun getContact(userId: String): Contact {
        network.beforeCall()
        return DIRECTORY.firstOrNull { it.userId == userId } ?: throw CoreException(ErrorCode.NOT_FOUND, "No user $userId")
    }

    override suspend fun transfer(request: TransferRequest, idempotencyKey: String): Transaction {
        // The request travels and the server works in serverScope: the client's timeout stops
        // its wait (TimeoutWalletApi), not the server (ADR-0007 §2).
        val work = serverScope.async {
            val hold = network.beforeTransfer()
            hold to serial.withLock { applyTransfer(request, idempotencyKey, hold) }
        }
        val (hold, tx) = work.await()
        if (hold != null) awaitCancellation() // TIMEOUT: the answer never comes
        return tx
    }

    override suspend fun getTransferByKey(idempotencyKey: String): Transaction {
        network.beforeCall()
        return serial.withLock {
            settleDue()
            store.getTransferKey(idempotencyKey)?.let { store.get(it.transactionId) }
                ?: throw CoreException(ErrorCode.NOT_FOUND, "No transfer with this key")
        }
    }

    /** FR-FAKE-02/03, ADR-0014 §2. Runs under [serial]. */
    private fun applyTransfer(request: TransferRequest, idempotencyKey: String, hold: NetworkSimulator.Hold?): Transaction {
        settleDue()
        store.getTransferKey(idempotencyKey)?.let { known ->
            val same = known.recipientId == request.recipientId && known.amount == request.amount && known.note == request.note
            if (!same) throw CoreException(ErrorCode.IDEMPOTENCY_CONFLICT, "This key was used for a different transfer")
            return store.get(known.transactionId) ?: throw CoreException(ErrorCode.SERVER_ERROR, "Recorded transfer is missing")
        }
        if (idempotencyKey.isEmpty()) throw CoreException(ErrorCode.INVALID_ARGUMENT, "idempotencyKey is required")
        if (!TransferPolicy.isValidAmount(request.amount.minor)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid transfer amount")
        if (TransferPolicy.normalizeNote(request.note) != request.note) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid note")
        val recipient = DIRECTORY.firstOrNull { it.userId == request.recipientId }
            ?: throw CoreException(ErrorCode.RECIPIENT_NOT_FOUND, "No user ${request.recipientId}")

        val now = now()
        val remaining = maxOf(0L, dailyLimit.minor - usedToday(now))
        val refused = TransferPolicy.exceededLimit(request.amount.minor, AmountLimits(Money(store.balance()), Money(remaining)))
        val n = transfers + 1
        val tx = Transaction(
            id = "trf-$n",
            idempotencyKey = idempotencyKey,
            type = TransactionType.TRANSFER_OUT,
            category = Category.TRANSFER,
            amount = request.amount,
            counterparty = Counterparty(CounterpartyKind.USER, recipient.userId, recipient.name, recipient.phone),
            note = request.note,
            status = when {
                refused != null -> TransactionStatus.FAILED
                hold != null -> TransactionStatus.PENDING
                else -> TransactionStatus.SUCCESS
            },
            failureReason = refused?.let { if (it == AmountRejectReason.INSUFFICIENT_FUNDS) ErrorCode.INSUFFICIENT_FUNDS else ErrorCode.DAILY_LIMIT_EXCEEDED },
            createdAt = now,
            updatedAt = now,
        )
        store.recordTransfer(
            tx,
            TransferKeyRow(request.recipientId, request.amount, request.note, tx.id),
            mapOf(META_TRANSFERS to n.toString()),
            if (tx.status == TransactionStatus.PENDING && hold != null) Settlement(tx.id, now + hold.holdMs, hold.fails) else null,
        )
        transfers = n
        return tx
    }

    /**
     * FR-FAKE-05: settles held transfers whose time has come, lazily, at the start of each call
     * that reads server state. updatedAt moves forward so the replica's delta sync sees the change
     * even with a frozen clock.
     */
    private fun settleDue() {
        val now = now()
        for (due in store.dueSettlements(now)) {
            val tx = store.get(due.transactionId) ?: continue
            store.settle(
                tx.id,
                if (due.fails) TransactionStatus.FAILED else TransactionStatus.SUCCESS,
                if (due.fails) ErrorCode.SERVER_ERROR else null,
                maxOf(now, tx.updatedAt + 1),
            )
        }
    }

    private fun usedToday(now: Long): Long {
        val zone = timeZone.current.offsetAt
        // FR-TRF-10: the daily limit resets at local midnight in the user's zone (ADR-0006).
        return store.usedSince(ZonedCalendar.localMidnight(ZonedCalendar.localEpochDay(now, zone), zone))
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
        return serial.withLock {
            settleDue()
            val now = now()
            Wallet(
                id = SeedData.WALLET_ID,
                balance = Money(store.balance()),
                dailyLimit = dailyLimit,
                usedToday = Money(usedToday(now)),
                updatedAt = now,
            )
        }
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
        serial.withLock { settleDue() }
        val rows = store.changesSince(afterUpdatedAt, afterId, limit + 1L)
        val items = rows.take(limit)
        val next = items.lastOrNull()?.let { "${it.updatedAt}:${it.id}" } ?: afterToken
        return ChangesPage(items, next, hasMore = rows.size > limit)
    }

    override suspend fun getTransaction(id: String): Transaction {
        network.beforeCall()
        serial.withLock { settleDue() }
        return store.get(id) ?: throw CoreException(ErrorCode.NOT_FOUND, "No transaction $id")
    }

    companion object {
        /** Server-side page size cap for getChanges (sync). Same as core-js. */
        const val MAX_CHANGES_PAGE = 500
        private const val META_SEEDED = "seeded"
        private const val META_FROZEN_NOW = "frozenNowMillis"
        private const val META_SIMULATED_INCOMING = "simulatedIncoming"
        private const val META_DAILY_LIMIT = "dailyLimit"
        private const val META_TRANSFERS = "transfers"

        /** FR-FAKE-01: the server's users, as contacts. */
        private val DIRECTORY: List<Contact> = SeedData.CONTACTS.map { Contact(it.id, it.name, it.phone!!) }
        private val TOKEN = Regex("""^(-?\d+):(.*)$""")
    }
}
