package com.pocketly.shared.sync

import com.pocketly.shared.data.CacheStore
import com.pocketly.shared.data.ContactSearch
import com.pocketly.shared.data.TopUpRequest
import com.pocketly.shared.data.TransferRequest
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.domain.AmountCheck
import com.pocketly.shared.domain.AmountLimits
import com.pocketly.shared.domain.AmountRejectReason
import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.ContactSearchResult
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.TopUpMethod
import com.pocketly.shared.domain.TopUpPolicy
import com.pocketly.shared.domain.TopUpReview
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import com.pocketly.shared.domain.TransferAuth
import com.pocketly.shared.domain.TransferAuthMethod
import com.pocketly.shared.domain.TransferAuthOutcome
import com.pocketly.shared.domain.TransferDraft
import com.pocketly.shared.domain.TransferEvent
import com.pocketly.shared.domain.TransferPolicy
import com.pocketly.shared.domain.TransferResult
import com.pocketly.shared.domain.TransferReview
import com.pocketly.shared.domain.TransferState
import com.pocketly.shared.domain.TransferStateMachine
import com.pocketly.shared.domain.UnlockOutcome
import com.pocketly.shared.domain.Wallet
import com.pocketly.shared.security.BiometricAuthenticator
import com.pocketly.shared.security.PinAuthenticator
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlin.concurrent.Volatile
import kotlin.coroutines.cancellation.CancellationException

/**
 * F5, the client side of a transfer (ADR-0014): draft → review (the key) → confirm (approval,
 * submission, 15 s) → SUCCESS / FAILED / PENDING → status check. F6's top-ups (ADR-0015) are
 * attempts too: review → confirm (no approval) → the same outcomes. Every state change goes
 * through the §3.2 state machine. Callers run it on the core's database thread, so its
 * bookkeeping is single-threaded. Mirrors packages/core-js/src/sync/transferFlow.ts.
 */
internal class TransferFlow(
    /** Behind the timeout (NFR-REL-01): reads after readTimeoutMs, the submission after writeTimeoutMs. */
    private val api: WalletApi,
    private val cache: CacheStore,
    private val pin: PinAuthenticator,
    private val biometric: BiometricAuthenticator,
    /** From the server, into the replica. */
    private val fetchWallet: suspend () -> Wallet,
    private val randomBytes: (Int) -> ByteArray,
    /** Device clock, for the app's own pending rows. */
    private val clock: () -> Long,
) {
    /** One attempt (FR-TRF-05): one key, one approval. Its id is its idempotency key. */
    private sealed class Attempt(val key: String, val amount: Money, var state: TransferState) {
        var failureReason: ErrorCode? = null
        var retryable: Boolean? = null
        var transaction: Transaction? = null

        /** The confirm or status check running now: a second call joins it (double tap). */
        var running: CompletableDeferred<TransferResult>? = null
    }

    private class TransferAttempt(key: String, val recipient: Contact, amount: Money, val note: String?, state: TransferState) :
        Attempt(key, amount, state)

    /** ADR-0015: money in from a payment method; no approval in Pocketly (§2). */
    private class TopUpAttempt(key: String, val method: TopUpMethod, amount: Money, state: TransferState) :
        Attempt(key, amount, state)

    private class Draft(val recipient: Contact, val limits: AmountLimits)

    /** Written on the database thread, read by checkTransferAmount on the caller's (JS) thread. */
    @Volatile
    private var draft: Draft? = null
    private val attempts = LinkedHashMap<String, Attempt>()

    /** Logout / resetData: forget the draft and every attempt (the replica is cleared too). */
    fun reset() {
        draft = null
        attempts.clear()
    }

    suspend fun searchContacts(query: String): ContactSearchResult = coroutineScope {
        val selfPhone = async { pin.verifiedPhone() }
        val directory = api.searchContacts(query)
        val self = selfPhone.await()
        val match = ContactSearch.search(query, directory, self)
        val recent = if (query.trim().isEmpty()) {
            cache.recentRecipients(TransferPolicy.RECENT_CONTACTS_LIMIT + 1L).filter { it.phone != self }.take(TransferPolicy.RECENT_CONTACTS_LIMIT)
        } else {
            emptyList()
        }
        ContactSearchResult(recent, match.contacts, match.phoneLookup)
    }

    /**
     * The recipient, this install's phone and a fresh wallet, fetched in parallel (none needs
     * another; BM-07 first measured them one after the other). Failures are reported in a fixed
     * order (recipient, phone, wallet), so both cores fail the same way whichever call ends first.
     */
    suspend fun startTransfer(recipientId: String): TransferDraft {
        val (contact, self, fresh) = coroutineScope {
            val contact = async { attempt { api.getContact(recipientId) } }
            val self = async { attempt { pin.verifiedPhone() } }
            val wallet = async { attempt { fetchWallet() } } // FR-TRF-11: fresh, or no transfer
            Triple(contact.await(), self.await(), wallet.await())
        }
        val recipient = contact.getOrElse { e ->
            throw if (e is CoreException && e.code == ErrorCode.NOT_FOUND) CoreException(ErrorCode.RECIPIENT_NOT_FOUND, "No user $recipientId") else e
        }
        if (recipient.phone == self.getOrThrow()) throw CoreException(ErrorCode.INVALID_ARGUMENT, "You can't send money to yourself")
        val wallet = fresh.getOrThrow()
        val limits = AmountLimits(wallet.balance, Money(maxOf(0L, wallet.dailyLimit.minor - wallet.usedToday.minor)))
        draft = Draft(recipient, limits)
        return TransferDraft(recipient, limits.balance, limits.dailyRemaining, Money(TransferPolicy.MIN_AMOUNT), TransferPolicy.maxAmount(limits))
    }

    fun checkTransferAmount(text: String): AmountCheck = TransferPolicy.checkAmount(text, currentDraft().limits)

    fun reviewTransfer(amount: Money, note: String?): TransferReview {
        val d = currentDraft()
        if (!TransferPolicy.isValidAmount(amount.minor)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid transfer amount")
        TransferPolicy.exceededLimit(amount.minor, d.limits)?.let {
            throw CoreException(if (it == AmountRejectReason.INSUFFICIENT_FUNDS) ErrorCode.INSUFFICIENT_FUNDS else ErrorCode.DAILY_LIMIT_EXCEEDED, "Amount is over the limit")
        }
        val normalized = TransferPolicy.normalizeNote(note)
        val key = newAttemptKey()
        attempts[key] = TransferAttempt(key, d.recipient, amount, normalized, TransferState.DRAFT)
        return TransferReview(key, key, d.recipient, amount, Money(TransferPolicy.FEE), normalized, Money(d.limits.balance.minor - amount.minor))
    }

    /** FR-TOP-01/02: a fresh wallet (FR-TRF-11: no top-up from cached data), then the attempt and its key. */
    suspend fun reviewTopUp(amount: Money, method: TopUpMethod): TopUpReview {
        if (!TopUpPolicy.isValidAmount(amount.minor)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "Invalid top-up amount")
        val wallet = fetchWallet()
        val key = newAttemptKey()
        attempts[key] = TopUpAttempt(key, method, amount, TransferState.DRAFT)
        return TopUpReview(key, key, method, amount, Money(TopUpPolicy.FEE), Money(wallet.balance.minor + amount.minor))
    }

    suspend fun confirmTransfer(id: String, auth: TransferAuth?): TransferResult {
        val attempt = attempt(id)
        attempt.running?.let { return it.await() }
        if (attempt.state == TransferState.DRAFT && attempt is TransferAttempt && auth == null) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "A new transfer needs biometrics or the PIN")
        }
        if (attempt.state == TransferState.DRAFT && attempt is TopUpAttempt && auth != null) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "A top-up takes no authorization")
        }
        if (attempt.state != TransferState.DRAFT && !(attempt.state == TransferState.FAILED && attempt.retryable == true)) {
            return result(attempt, TransferAuthOutcome.NOT_REQUIRED)
        }
        return run(attempt) {
            when {
                attempt.state != TransferState.DRAFT -> retry(attempt)
                attempt is TransferAttempt -> authorizeAndSend(attempt, auth!!)
                else -> sendTopUp(attempt as TopUpAttempt)
            }
        }
    }

    suspend fun getTransferStatus(id: String): TransferResult {
        val attempt = attempt(id)
        attempt.running?.let { return it.await() }
        if (attempt.state != TransferState.PENDING) return result(attempt, TransferAuthOutcome.NOT_REQUIRED)
        return run(attempt) { checkStatus(attempt) }
    }

    // ── steps ────────────────────────────────────────────────────────────

    private suspend fun authorizeAndSend(attempt: TransferAttempt, auth: TransferAuth): TransferResult {
        move(attempt, TransferEvent.CONFIRM)
        val (outcome, refused) = try {
            authorize(attempt, auth)
        } catch (e: Throwable) {
            move(attempt, TransferEvent.CANCEL)
            throw e
        }
        if (outcome != TransferAuthOutcome.OK) {
            move(attempt, TransferEvent.CANCEL) // FR-TRF-04: back to review, nothing sent
            return refused ?: result(attempt, outcome)
        }
        move(attempt, TransferEvent.AUTH_OK)
        return submit(attempt, TransferAuthOutcome.OK)
    }

    /** ADR-0015 §2: AUTHORIZING passes at once; the payment method authorizes the charge itself. */
    private suspend fun sendTopUp(attempt: TopUpAttempt): TransferResult {
        move(attempt, TransferEvent.CONFIRM)
        move(attempt, TransferEvent.AUTH_OK)
        return submit(attempt, TransferAuthOutcome.NOT_REQUIRED)
    }

    /** The outcome, and for a refused PIN the result carrying its attempts / lockout. */
    private suspend fun authorize(attempt: TransferAttempt, auth: TransferAuth): Pair<TransferAuthOutcome, TransferResult?> {
        if (auth.method == TransferAuthMethod.BIOMETRIC) {
            val prompt = auth.prompt ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "BIOMETRIC needs a prompt")
            return biometric.approveTransfer(attempt.amount.minor, attempt.recipient.userId, attempt.key, prompt) to null
        }
        val code = auth.pin ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "PIN needs a pin")
        val check = pin.verifyPin(code)
        return when (check.outcome) {
            UnlockOutcome.UNLOCKED -> TransferAuthOutcome.OK to null
            UnlockOutcome.WRONG_PIN -> TransferAuthOutcome.WRONG_PIN to
                result(attempt, TransferAuthOutcome.WRONG_PIN).copy(state = TransferState.DRAFT, attemptsLeft = check.attemptsLeft)
            UnlockOutcome.LOCKED_OUT -> TransferAuthOutcome.PIN_LOCKED_OUT to
                result(attempt, TransferAuthOutcome.PIN_LOCKED_OUT).copy(state = TransferState.DRAFT, lockedUntil = check.lockedUntil)
        }
    }

    private suspend fun retry(attempt: Attempt): TransferResult {
        move(attempt, TransferEvent.RETRY)
        attempt.failureReason = null
        attempt.retryable = null
        return submit(attempt, TransferAuthOutcome.NOT_REQUIRED)
    }

    /** SUBMITTING → SUCCESS / FAILED / PENDING (ADR-0014 §2, §4). */
    private suspend fun submit(attempt: Attempt, auth: TransferAuthOutcome): TransferResult {
        val tx = try {
            send(attempt)
        } catch (e: CoreException) {
            if (e.code == ErrorCode.NETWORK_TIMEOUT) return timedOut(attempt, auth)
            move(attempt, TransferEvent.SUBMIT_ERROR)
            attempt.failureReason = e.code
            // Thrown before the server recorded anything: safe to send again only for these codes.
            attempt.retryable = TransferPolicy.isRetryable(e.code)
            return result(attempt, auth).copy(balance = cachedBalance())
        }
        return applyServerAnswer(attempt, tx, auth, TransferEvent.SUBMIT_OK, TransferEvent.SUBMIT_ERROR)
    }

    /** FR-TRF-09: no answer in time. The app shows its own pending row until the server's arrives. */
    private fun timedOut(attempt: Attempt, auth: TransferAuthOutcome): TransferResult {
        move(attempt, TransferEvent.TIMEOUT)
        val placeholder = placeholder(attempt)
        if (cache.getByIdempotencyKey(attempt.key) == null) {
            cache.upsert(placeholder)
            adjustWallet(heldDelta(attempt)) // as the server counts it while pending
        }
        attempt.transaction = cache.getByIdempotencyKey(attempt.key) ?: placeholder
        return result(attempt, auth).copy(balance = cachedBalance())
    }

    private suspend fun checkStatus(attempt: Attempt): TransferResult {
        val tx = try {
            api.getTransferByKey(attempt.key)
        } catch (e: CoreException) {
            if (e.code != ErrorCode.NOT_FOUND) throw e // can't tell yet: stays PENDING
            // The request never reached the server: nothing was applied, so sending it again is safe.
            move(attempt, TransferEvent.STATUS_FAILED)
            attempt.failureReason = ErrorCode.NETWORK_TIMEOUT
            attempt.retryable = true
            attempt.transaction = null
            dropPlaceholder(attempt)
            return result(attempt, TransferAuthOutcome.NOT_REQUIRED).copy(balance = cachedBalance())
        }
        if (tx.status == TransactionStatus.PENDING) {
            cache.upsert(tx)
            attempt.transaction = tx
            return result(attempt, TransferAuthOutcome.NOT_REQUIRED).copy(balance = cachedBalance())
        }
        return applyServerAnswer(attempt, tx, TransferAuthOutcome.NOT_REQUIRED, TransferEvent.STATUS_SUCCESS, TransferEvent.STATUS_FAILED)
    }

    /** The server's transaction for this key: SUCCESS, FAILED (recorded: never retryable) or PENDING. */
    private fun applyServerAnswer(attempt: Attempt, tx: Transaction, auth: TransferAuthOutcome, ok: TransferEvent, failed: TransferEvent): TransferResult {
        val wasHeld = attempt.state == TransferState.PENDING
        if (tx.status == TransactionStatus.PENDING) return timedOut(attempt, auth) // a replay of a held transfer
        cache.upsert(tx) // history row (and the placeholder goes)
        attempt.transaction = tx
        // ADR-0014 §5, ADR-0015 §3: the replica moves at once, by what this answer adds to what's held.
        val held = if (wasHeld) heldDelta(attempt) else NO_CHANGE
        if (tx.status == TransactionStatus.SUCCESS) {
            move(attempt, ok)
            val settled = settledDelta(attempt)
            adjustWallet(settled.first - held.first to settled.second - held.second)
        } else {
            move(attempt, failed)
            attempt.failureReason = tx.failureReason ?: ErrorCode.SERVER_ERROR
            attempt.retryable = false // the server recorded it: the same key returns this again
            adjustWallet(-held.first to -held.second) // released
        }
        return result(attempt, auth).copy(balance = cachedBalance())
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** A core failure as a value, so parallel calls can be reported in a fixed order. */
    private suspend fun <T> attempt(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (e: CoreException) {
        Result.failure(e)
    }

    private fun currentDraft(): Draft = draft ?: throw CoreException(ErrorCode.NOT_FOUND, "No transfer started")

    /** Attempts never sent go: a new review is a new attempt (ADR-0014 §2). */
    private fun newAttemptKey(): String {
        attempts.entries.removeAll { it.value.state == TransferState.DRAFT && it.value.running == null }
        return uuidV4(randomBytes(16))
    }

    private suspend fun send(attempt: Attempt): Transaction = when (attempt) {
        is TopUpAttempt -> api.topUp(TopUpRequest(attempt.method, attempt.amount), attempt.key)
        is TransferAttempt -> api.transfer(TransferRequest(attempt.recipient.userId, attempt.amount, attempt.note), attempt.key)
    }

    /** FR-TRF-09: the app's own pending row, until the server's arrives. */
    private fun placeholder(attempt: Attempt): Transaction {
        val now = clock()
        val (type, category, counterparty, note) = when (attempt) {
            is TopUpAttempt ->
                PlaceholderKind(TransactionType.TOP_UP, Category.TOP_UP, TopUpPolicy.counterparty(attempt.method), null)
            is TransferAttempt -> PlaceholderKind(
                TransactionType.TRANSFER_OUT,
                Category.TRANSFER,
                Counterparty(CounterpartyKind.USER, attempt.recipient.userId, attempt.recipient.name, attempt.recipient.phone),
                attempt.note,
            )
        }
        return Transaction(
            id = CacheStore.PLACEHOLDER_PREFIX + attempt.key,
            idempotencyKey = attempt.key,
            type = type,
            category = category,
            amount = attempt.amount,
            counterparty = counterparty,
            note = note,
            status = TransactionStatus.PENDING,
            failureReason = null,
            createdAt = now,
            updatedAt = now,
        )
    }

    private data class PlaceholderKind(
        val type: TransactionType,
        val category: Category,
        val counterparty: Counterparty,
        val note: String?,
    )

    /** In memory, or a pending one rebuilt from the replica after a restart (NFR-REL-03). */
    private fun attempt(id: String): Attempt {
        attempts[id]?.let { return it }
        val row = cache.getByIdempotencyKey(id)
        val cp = row?.counterparty
        val method = if (row?.type == TransactionType.TOP_UP) TopUpPolicy.methodOf(cp) else null
        if (row == null || cp == null || (row.type != TransactionType.TRANSFER_OUT && method == null)) {
            throw CoreException(ErrorCode.NOT_FOUND, "No transfer $id")
        }
        val state = when (row.status) {
            TransactionStatus.PENDING -> TransferState.PENDING
            TransactionStatus.SUCCESS -> TransferState.SUCCESS
            else -> TransferState.FAILED
        }
        val restored = when (method) {
            null -> TransferAttempt(id, Contact(cp.id, cp.name, cp.phone ?: ""), row.amount, row.note, state)
            else -> TopUpAttempt(id, method, row.amount, state)
        }.apply {
            transaction = row
            if (row.status == TransactionStatus.FAILED) {
                failureReason = row.failureReason ?: ErrorCode.SERVER_ERROR
                retryable = false
            }
        }
        attempts[id] = restored
        return restored
    }

    private suspend fun run(attempt: Attempt, work: suspend () -> TransferResult): TransferResult {
        val running = CompletableDeferred<TransferResult>()
        attempt.running = running
        try {
            return work().also { running.complete(it) }
        } catch (e: Throwable) {
            running.completeExceptionally(if (e is CancellationException) CoreException(ErrorCode.SERVER_ERROR, "cancelled") else e)
            throw e
        } finally {
            attempt.running = null
        }
    }

    private fun move(attempt: Attempt, event: TransferEvent) {
        attempt.state = TransferStateMachine.transition(attempt.state, event) // NFR-MONEY-04: only §3.2's transitions
    }

    private fun dropPlaceholder(attempt: Attempt) {
        val row = cache.getByIdempotencyKey(attempt.key) ?: return
        if (row.id.startsWith(CacheStore.PLACEHOLDER_PREFIX)) {
            cache.delete(row.id)
            val held = heldDelta(attempt)
            adjustWallet(-held.first to -held.second)
        }
    }

    /** A change to the replica's wallet: balance, and today's outgoing total. */
    private fun adjustWallet(delta: Pair<Long, Long>) {
        if (delta.first != 0L || delta.second != 0L) cache.adjustWallet(delta.first, delta.second)
    }

    /**
     * What the server counts while the attempt is PENDING: a held transfer is already out of the
     * balance and in today's total; a pending top-up isn't in the balance yet (ADR-0015 §3).
     */
    private fun heldDelta(attempt: Attempt): Pair<Long, Long> = when (attempt) {
        is TransferAttempt -> -attempt.amount.minor to attempt.amount.minor
        is TopUpAttempt -> NO_CHANGE
    }

    /** What a SUCCESS changes in all. A top-up never counts toward the daily limit. */
    private fun settledDelta(attempt: Attempt): Pair<Long, Long> = when (attempt) {
        is TransferAttempt -> -attempt.amount.minor to attempt.amount.minor
        is TopUpAttempt -> attempt.amount.minor to 0L
    }

    private fun cachedBalance(): Money? = cache.getWallet()?.first?.balance

    private fun result(attempt: Attempt, auth: TransferAuthOutcome): TransferResult {
        val failed = attempt.state == TransferState.FAILED
        return TransferResult(
            id = attempt.key,
            state = attempt.state,
            auth = auth,
            transaction = attempt.transaction.takeIf { attempt.state != TransferState.DRAFT },
            failureReason = attempt.failureReason.takeIf { failed },
            retryable = if (failed) attempt.retryable ?: false else null,
        )
    }

    companion object {
        private val NO_CHANGE = 0L to 0L

        /** RFC 4122 version 4 from 16 random bytes, lowercase. */
        fun uuidV4(bytes: ByteArray): String {
            if (bytes.size != 16) throw CoreException(ErrorCode.INVALID_ARGUMENT, "uuidV4 needs 16 bytes")
            val b = bytes.copyOf()
            b[6] = ((b[6].toInt() and 0x0f) or 0x40).toByte()
            b[8] = ((b[8].toInt() and 0x3f) or 0x80).toByte()
            val hex = b.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
            return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
        }
    }
}
