package com.pocketly.shared.data.fake

import com.pocketly.shared.data.ChangesPage
import com.pocketly.shared.data.ContactSearch
import com.pocketly.shared.data.EventsPage
import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.OpenPaymentRequest
import com.pocketly.shared.data.PaymentTarget
import com.pocketly.shared.data.QrPaymentRequest
import com.pocketly.shared.data.ServerOtpVerify
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.data.TopUpRequest
import com.pocketly.shared.data.TransactionDtoValidator
import com.pocketly.shared.data.TransferRequest
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.WalletEvent
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
import com.pocketly.shared.domain.OtpVerifyOutcome
import com.pocketly.shared.domain.TopUpPolicy
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferPolicy
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.domain.ZonedCalendar
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
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
    /** For the account's user id (ADR-0016 §6). The app passes its secure generator. */
    private val randomBytes: (Int) -> ByteArray = { kotlin.random.Random.nextBytes(it) },
) : WalletApi, FakeBackendControls {
    private val network = NetworkSimulator()
    private val otp = OtpServer(otpClock)

    override suspend fun requestOtp(phone: String): OtpSendResult {
        network.beforeCall()
        return otp.send(phone)
    }

    override suspend fun verifyOtp(phone: String, code: String): ServerOtpVerify {
        network.beforeCall()
        val verified = otp.verify(phone, code)
        if (verified.result.outcome != OtpVerifyOutcome.VERIFIED) return verified
        return serial.withLock {
            // The same phone keeps its id; another phone is another account.
            val userId = accountUserId?.takeIf { phone == accountPhone } ?: newUserId()
            store.setMeta(META_ACCOUNT_PHONE, phone)
            store.setMeta(META_ACCOUNT_USER_ID, userId)
            accountPhone = phone
            accountUserId = userId
            verified.copy(userId = userId)
        }
    }

    override suspend fun getAccountUserId(phone: String): String {
        network.beforeCall()
        return serial.withLock {
            if (accountPhone == null) {
                // Verified before this server recorded the account (slice 5): the session's phone is it.
                store.setMeta(META_ACCOUNT_PHONE, phone)
                accountPhone = phone
            }
            if (phone != accountPhone) throw CoreException(ErrorCode.NOT_FOUND, "Not this account")
            accountUserId ?: newUserId().also {
                // Verified before user ids existed: the account gets one now.
                store.setMeta(META_ACCOUNT_USER_ID, it)
                accountUserId = it
            }
        }
    }

    /** `u-` + 12 random hex digits: says nothing about the phone (ADR-0016 §6). */
    private fun newUserId(): String = "u-" + randomBytes(6).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    @Volatile
    private var frozenNow: Long? = null
    private var simulatedIncoming = 0
    @Volatile
    private var dailyLimit = SeedData.DAILY_LIMIT
    private var transfers = 0
    private var topUps = 0
    private var qrPayments = 0
    @Volatile
    private var accountUserId: String? = null
    @Volatile
    private var accountPhone: String? = null

    /** Anything that reads and then writes server state runs one at a time (calls arrive in parallel). */
    private val serial = Mutex()

    /** ADR-0007 §2: the server's own work, which a client giving up doesn't cancel. */
    private val serverScope = CoroutineScope(SupervisorJob() + serverDispatcher)

    /** "The log grew" (ADR-0017 §1). Conflated: one pending signal says it all. */
    private val signals = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** App mode only: the parent of one timer per held or processing transaction (ADR-0017 §1). */
    private val timers = SupervisorJob(serverScope.coroutineContext[Job])

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
        topUps = store.getMeta(META_TOP_UPS)?.toInt() ?: 0
        qrPayments = store.getMeta(META_QR_PAYMENTS)?.toInt() ?: 0
        accountUserId = store.getMeta(META_ACCOUNT_USER_ID)
        accountPhone = store.getMeta(META_ACCOUNT_PHONE)
        // What was held when the process died settles now if it's due, else on time (ADR-0017 §1).
        store.dueSettlements(Long.MAX_VALUE).forEach { scheduleSettlement(it.transactionId, it.resolveAt) }
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
        timers.cancelChildren()
        frozenNow = config.nowMillis
        simulatedIncoming = 0
        dailyLimit = SeedData.DAILY_LIMIT
        transfers = 0
        topUps = 0
        qrPayments = 0
        val now = now()
        store.replaceAll(
            SeedData.generate(config, now) + config.extraTransactions,
            SeedData.seedPaymentRequests(now),
            mapOf(
                META_SEEDED to "1",
                META_FROZEN_NOW to (config.nowMillis?.toString() ?: ""),
                META_SIMULATED_INCOMING to "0",
                META_DAILY_LIMIT to SeedData.DAILY_LIMIT.minor.toString(),
                META_TRANSFERS to "0",
                META_TOP_UPS to "0",
                META_QR_PAYMENTS to "0",
            ) + listOfNotNull( // the account outlives a dataset reset
                accountPhone?.let { META_ACCOUNT_PHONE to it },
                accountUserId?.let { META_ACCOUNT_USER_ID to it },
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

    /**
     * Tests only: moves a frozen clock forward, and settles what that makes due, as the app's timers
     * would (ADR-0017 §1). The settling runs in the background: the next server call waits for it.
     */
    fun advanceClock(ms: Long) {
        val frozen = frozenNow ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "the clock is not frozen")
        frozenNow = frozen + ms
        serverScope.launch { serial.withLock { settleDue() } }
    }

    override fun incomingEvents(): Flow<Unit> = signals.asSharedFlow()

    override suspend fun getEvents(afterSeq: Long, limit: Int): EventsPage {
        network.beforeEventRead()
        if (afterSeq < 0) throw CoreException(ErrorCode.INVALID_ARGUMENT, "afterSeq must be >= 0")
        if (limit !in 1..MAX_EVENTS_PAGE) throw CoreException(ErrorCode.INVALID_ARGUMENT, "limit must be 1..$MAX_EVENTS_PAGE")
        return serial.withLock {
            settleDue()
            val rows = store.eventsAfter(afterSeq, limit + 1L)
            val items = rows.take(limit).map { row ->
                val tx = store.get(row.transactionId)
                    ?: throw CoreException(ErrorCode.SERVER_ERROR, "Logged transaction ${row.transactionId} is missing")
                WalletEvent(row.seq, row.kind, tx, row.createdAt)
            }
            EventsPage(items, hasMore = rows.size > limit)
        }
    }

    /** "The log grew", after the write that grew it. */
    private fun signal() {
        signals.tryEmit(Unit)
    }

    /**
     * App mode: settles this transaction when its time comes (FR-FAKE-05), so its event appears while the
     * app runs. A frozen clock (tests) has no timers: [advanceClock] settles instead.
     */
    private fun scheduleSettlement(transactionId: String, resolveAt: Long) {
        if (frozenNow != null) return
        serverScope.launch(timers) {
            delay(maxOf(0L, resolveAt - currentTimeMillis()))
            serial.withLock {
                settleDue()
                store.getSettlement(transactionId)?.let { scheduleSettlement(transactionId, it.resolveAt) } // woke a little early
            }
        }
    }

    override suspend fun searchContacts(query: String): List<Contact> {
        network.beforeCall()
        return ContactSearch.match(query, DIRECTORY)
    }

    override suspend fun getContact(userId: String): Contact {
        network.beforeCall()
        // This account, from a scanned My QR (ADR-0016 §6): the client refuses it by its phone.
        val self = accountPhone
        if (userId == accountUserId && self != null) return Contact(userId, "You", self)
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

    override suspend fun topUp(request: TopUpRequest, idempotencyKey: String): Transaction {
        // As transfer: the server's work runs in serverScope, which the client's timeout doesn't stop.
        val work = serverScope.async {
            val handling = network.beforeTopUp()
            val (tx, recorded) = serial.withLock { applyTopUp(request, idempotencyKey, handling) }
            if (handling !is NetworkSimulator.TopUpHandling.Processed || !recorded) return@async handling to tx
            // Processing runs outside the lock: a retry or status check meanwhile finds it PENDING.
            if (handling.processingMs > 0) delay(handling.processingMs)
            handling to serial.withLock { settleProcessed(tx) }
        }
        val (handling, tx) = work.await()
        if (handling is NetworkSimulator.TopUpHandling.Held) awaitCancellation() // TIMEOUT: the answer never comes
        return tx
    }

    override suspend fun getPaymentTarget(merchantId: String, requestId: String?): PaymentTarget {
        network.beforeCall()
        return serial.withLock {
            settleDue()
            paymentTarget(merchantId, requestId)
        }
    }

    override suspend fun payMerchant(request: QrPaymentRequest, idempotencyKey: String): Transaction {
        // As transfer: the server's work runs in serverScope, which the client's timeout doesn't stop.
        val work = serverScope.async {
            val hold = network.beforeTransfer()
            hold to serial.withLock { applyQrPayment(request, idempotencyKey, hold) }
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
            val same = known.recipientId == request.recipientId && known.amount == request.amount && known.note == request.note &&
                known.requestId == null
            if (!same) throw CoreException(ErrorCode.IDEMPOTENCY_CONFLICT, "This key was used for a different transfer")
            return store.get(known.transactionId) ?: throw CoreException(ErrorCode.SERVER_ERROR, "Recorded transfer is missing")
        }
        if (idempotencyKey.isEmpty()) throw CoreException(ErrorCode.INVALID_ARGUMENT, "idempotencyKey is required")
        if (!TransferPolicy.isValidAmount(request.amount.minor)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid transfer amount")
        if (TransferPolicy.normalizeNote(request.note) != request.note) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid note")
        val recipient = DIRECTORY.firstOrNull { it.userId == request.recipientId }
            ?: throw CoreException(ErrorCode.RECIPIENT_NOT_FOUND, "No user ${request.recipientId}")
        if (recipient.phone == accountPhone) throw CoreException(ErrorCode.INVALID_ARGUMENT, "You can't send money to yourself")

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
        if (tx.status == TransactionStatus.PENDING && hold != null) scheduleSettlement(tx.id, now + hold.holdMs)
        return tx
    }

    /** ADR-0016 §4: the merchant, and its request if any. Runs under [serial]. */
    private fun paymentTarget(merchantId: String, requestId: String?): PaymentTarget {
        val merchant = SeedData.MERCHANTS.firstOrNull { it.counterparty.id == merchantId }
            ?: throw CoreException(ErrorCode.INVALID_QR, "No merchant $merchantId")
        if (requestId == null) return PaymentTarget(merchant.counterparty, merchant.category, null)
        val request = store.getPaymentRequest(requestId)?.takeIf { it.merchantId == merchantId }
            ?: throw CoreException(ErrorCode.INVALID_QR, "No request $requestId")
        if (request.paidBy != null) throw CoreException(ErrorCode.QR_ALREADY_PAID, "This code was paid already")
        if (request.expiresAt <= now()) throw CoreException(ErrorCode.QR_EXPIRED, "This code has expired")
        return PaymentTarget(merchant.counterparty, merchant.category, OpenPaymentRequest(request.id, Money(request.amount), request.expiresAt))
    }

    /** FR-QR-04, ADR-0016 §4: as [applyTransfer], for a merchant. Runs under [serial]. */
    private fun applyQrPayment(request: QrPaymentRequest, idempotencyKey: String, hold: NetworkSimulator.Hold?): Transaction {
        settleDue()
        store.getTransferKey(idempotencyKey)?.let { known ->
            val same = known.recipientId == request.merchantId && known.amount == request.amount && known.note == null &&
                known.requestId == request.requestId
            if (!same) throw CoreException(ErrorCode.IDEMPOTENCY_CONFLICT, "This key was used for a different request")
            return store.get(known.transactionId) ?: throw CoreException(ErrorCode.SERVER_ERROR, "Recorded QR payment is missing")
        }
        if (idempotencyKey.isEmpty()) throw CoreException(ErrorCode.INVALID_ARGUMENT, "idempotencyKey is required")
        val target = paymentTarget(request.merchantId, request.requestId)
        if (!TransferPolicy.isValidAmount(request.amount.minor)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid payment amount")
        if (target.request != null && target.request.amount != request.amount) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "The amount isn't the code's")
        }

        val now = now()
        val remaining = maxOf(0L, dailyLimit.minor - usedToday(now))
        val refused = TransferPolicy.exceededLimit(request.amount.minor, AmountLimits(Money(store.balance()), Money(remaining)))
        val n = qrPayments + 1
        val tx = Transaction(
            id = "qrp-$n",
            idempotencyKey = idempotencyKey,
            type = TransactionType.QR_PAYMENT,
            category = target.category,
            amount = request.amount,
            counterparty = target.merchant,
            note = null,
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
            TransferKeyRow(request.merchantId, request.amount, null, tx.id, request.requestId),
            mapOf(META_QR_PAYMENTS to n.toString()),
            if (tx.status == TransactionStatus.PENDING && hold != null) Settlement(tx.id, now + hold.holdMs, hold.fails) else null,
            paysRequest = request.requestId.takeIf { refused == null }, // paid (or held): nobody pays it again
        )
        qrPayments = n
        if (tx.status == TransactionStatus.PENDING && hold != null) scheduleSettlement(tx.id, now + hold.holdMs)
        return tx
    }

    /**
     * ADR-0015 §4. Runs under [serial]. A new top-up is recorded PENDING with a settlement row
     * saying how it ends, so one still processing when the app dies settles on the next start.
     * Returns the transaction and whether this call recorded it (false: a replay).
     */
    private fun applyTopUp(
        request: TopUpRequest,
        idempotencyKey: String,
        handling: NetworkSimulator.TopUpHandling,
    ): Pair<Transaction, Boolean> {
        settleDue()
        val counterparty = TopUpPolicy.counterparty(request.method)
        store.getTransferKey(idempotencyKey)?.let { known ->
            val same = known.recipientId == counterparty.id && known.amount == request.amount && known.note == null &&
                known.requestId == null
            if (!same) throw CoreException(ErrorCode.IDEMPOTENCY_CONFLICT, "This key was used for a different request")
            val original = store.get(known.transactionId)
                ?: throw CoreException(ErrorCode.SERVER_ERROR, "Recorded top-up is missing")
            return original to false
        }
        if (idempotencyKey.isEmpty()) throw CoreException(ErrorCode.INVALID_ARGUMENT, "idempotencyKey is required")
        if (!TopUpPolicy.isValidAmount(request.amount.minor)) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid top-up amount")
        }

        val now = now()
        val n = topUps + 1
        val tx = Transaction(
            id = "tup-$n",
            idempotencyKey = idempotencyKey,
            type = TransactionType.TOP_UP,
            category = Category.TOP_UP,
            amount = request.amount,
            counterparty = counterparty,
            note = null,
            status = TransactionStatus.PENDING,
            failureReason = null,
            createdAt = now,
            updatedAt = now,
        )
        val (waitMs, fails) = when (handling) {
            is NetworkSimulator.TopUpHandling.Held -> handling.hold.holdMs to (handling.declined || handling.hold.fails)
            is NetworkSimulator.TopUpHandling.Processed -> handling.processingMs to handling.declined
        }
        val reason = if (handling.declined) ErrorCode.PAYMENT_DECLINED else null
        store.recordTransfer(
            tx,
            TransferKeyRow(counterparty.id, request.amount, null, tx.id),
            mapOf(META_TOP_UPS to n.toString()),
            Settlement(tx.id, now + waitMs, fails, reason),
        )
        topUps = n
        // A processing one settles when its answer goes out; the timer is for a process that died meanwhile.
        scheduleSettlement(tx.id, now + waitMs)
        return tx to true
    }

    /** After processing: settles this top-up by its row, unless something settled it already. Under [serial]. */
    private fun settleProcessed(tx: Transaction): Transaction {
        val current = store.get(tx.id)
        if (current == null || current.idempotencyKey != tx.idempotencyKey) return tx // reset meanwhile
        val due = store.getSettlement(tx.id) ?: return current
        return settleRow(due, current, now())
    }

    /**
     * FR-FAKE-05: settles held transfers and top-ups whose time has come, lazily, at the start of
     * each call that reads server state.
     */
    private fun settleDue() {
        val now = now()
        for (due in store.dueSettlements(now)) {
            val tx = store.get(due.transactionId) ?: continue
            settleRow(due, tx, now)
        }
    }

    /** updatedAt moves forward so the replica's delta sync sees the change even with a frozen clock. */
    private fun settleRow(due: Settlement, tx: Transaction, now: Long): Transaction {
        val status = if (due.fails) TransactionStatus.FAILED else TransactionStatus.SUCCESS
        val failureReason = if (due.fails) due.failureReason ?: ErrorCode.SERVER_ERROR else null
        val updatedAt = maxOf(now, tx.updatedAt + 1)
        store.settle(tx.id, status, failureReason, updatedAt)
        signal()
        return tx.copy(status = status, failureReason = failureReason, updatedAt = updatedAt)
    }

    private fun usedToday(now: Long): Long {
        val zone = timeZone.current.offsetAt
        // FR-TRF-10: the daily limit resets at local midnight in the user's zone (ADR-0006).
        return store.usedSince(ZonedCalendar.localMidnight(ZonedCalendar.localEpochDay(now, zone), zone))
    }

    /** FR-DEV-04: the transfer and its MONEY_RECEIVED event, in one write (ADR-0017 §1). */
    override fun simulateIncomingTransfer(): Transaction {
        val n = simulatedIncoming + 1
        val tx = SeedData.simulatedIncomingTransfer(n, now())
        store.insertIncoming(tx, mapOf(META_SIMULATED_INCOMING to n.toString()))
        simulatedIncoming = n
        signal()
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

        /** Server-side page size cap for getEvents. Same as core-js. */
        const val MAX_EVENTS_PAGE = 500
        private const val META_SEEDED = "seeded"
        private const val META_FROZEN_NOW = "frozenNowMillis"
        private const val META_SIMULATED_INCOMING = "simulatedIncoming"
        private const val META_DAILY_LIMIT = "dailyLimit"
        private const val META_TRANSFERS = "transfers"
        private const val META_TOP_UPS = "topUps"
        private const val META_QR_PAYMENTS = "qrPayments"

        /** ADR-0016 §6: the verified account's user id, random, kept with its phone across resets. */
        private const val META_ACCOUNT_USER_ID = "accountUserId"

        /** The phone this account verified by OTP (ADR-0013): no transfers to it. Kept by reset. */
        private const val META_ACCOUNT_PHONE = "accountPhone"

        /** FR-FAKE-01: the server's users, as contacts. */
        private val DIRECTORY: List<Contact> = SeedData.CONTACTS.map { Contact(it.id, it.name, it.phone!!) }
        private val TOKEN = Regex("""^(-?\d+):(.*)$""")
    }
}
