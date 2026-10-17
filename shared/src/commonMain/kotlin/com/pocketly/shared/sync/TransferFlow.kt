package com.pocketly.shared.sync

import com.pocketly.shared.data.CacheStore
import com.pocketly.shared.data.ContactSearch
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
import kotlin.concurrent.Volatile
import kotlin.coroutines.cancellation.CancellationException

/**
 * F5, the client side of a transfer (ADR-0014): draft → review (the key) → confirm (approval,
 * submission, 15 s) → SUCCESS / FAILED / PENDING → status check. Every state change goes
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
    /** One transfer attempt (FR-TRF-05): one key, one approval. Its id is its idempotency key. */
    private class Attempt(val key: String, val recipient: Contact, val amount: Money, val note: String?, var state: TransferState) {
        var failureReason: ErrorCode? = null
        var retryable: Boolean? = null
        var transaction: Transaction? = null

        /** The confirm or status check running now: a second call joins it (double tap). */
        var running: CompletableDeferred<TransferResult>? = null
    }

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

    suspend fun searchContacts(query: String): ContactSearchResult {
        val self = pin.getAuthState().phone
        val directory = api.searchContacts(query)
        val match = ContactSearch.search(query, directory, self)
        val recent = if (query.trim().isEmpty()) {
            cache.recentRecipients(TransferPolicy.RECENT_CONTACTS_LIMIT + 1L).filter { it.phone != self }.take(TransferPolicy.RECENT_CONTACTS_LIMIT)
        } else {
            emptyList()
        }
        return ContactSearchResult(recent, match.contacts, match.phoneLookup)
    }

    suspend fun startTransfer(recipientId: String): TransferDraft {
        val self = pin.getAuthState().phone
        val recipient = try {
            api.getContact(recipientId)
        } catch (e: CoreException) {
            throw if (e.code == ErrorCode.NOT_FOUND) CoreException(ErrorCode.RECIPIENT_NOT_FOUND, "No user $recipientId") else e
        }
        if (recipient.phone == self) throw CoreException(ErrorCode.INVALID_ARGUMENT, "You can't send money to yourself")
        val wallet = fetchWallet() // FR-TRF-11: fresh, or no transfer
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
        // Attempts never sent go: a new review is a new attempt (ADR-0014 §2).
        attempts.entries.removeAll { it.value.state == TransferState.DRAFT && it.value.running == null }
        val key = uuidV4(randomBytes(16))
        attempts[key] = Attempt(key, d.recipient, amount, normalized, TransferState.DRAFT)
        return TransferReview(key, key, d.recipient, amount, Money(TransferPolicy.FEE), normalized, Money(d.limits.balance.minor - amount.minor))
    }

    suspend fun confirmTransfer(id: String, auth: TransferAuth?): TransferResult {
        val attempt = attempt(id)
        attempt.running?.let { return it.await() }
        if (attempt.state == TransferState.DRAFT && auth == null) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "A new transfer needs biometrics or the PIN")
        }
        if (attempt.state != TransferState.DRAFT && !(attempt.state == TransferState.FAILED && attempt.retryable == true)) {
            return result(attempt, TransferAuthOutcome.NOT_REQUIRED)
        }
        return run(attempt) { if (attempt.state == TransferState.DRAFT) authorizeAndSend(attempt, auth!!) else retry(attempt) }
    }

    suspend fun getTransferStatus(id: String): TransferResult {
        val attempt = attempt(id)
        attempt.running?.let { return it.await() }
        if (attempt.state != TransferState.PENDING) return result(attempt, TransferAuthOutcome.NOT_REQUIRED)
        return run(attempt) { checkStatus(attempt) }
    }

    // ── steps ────────────────────────────────────────────────────────────

    private suspend fun authorizeAndSend(attempt: Attempt, auth: TransferAuth): TransferResult {
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

    /** The outcome, and for a refused PIN the result carrying its attempts / lockout. */
    private suspend fun authorize(attempt: Attempt, auth: TransferAuth): Pair<TransferAuthOutcome, TransferResult?> {
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
            api.transfer(TransferRequest(attempt.recipient.userId, attempt.amount, attempt.note), attempt.key)
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
        val now = clock()
        val placeholder = Transaction(
            id = CacheStore.PLACEHOLDER_PREFIX + attempt.key,
            idempotencyKey = attempt.key,
            type = TransactionType.TRANSFER_OUT,
            category = Category.TRANSFER,
            amount = attempt.amount,
            counterparty = Counterparty(CounterpartyKind.USER, attempt.recipient.userId, attempt.recipient.name, attempt.recipient.phone),
            note = attempt.note,
            status = TransactionStatus.PENDING,
            failureReason = null,
            createdAt = now,
            updatedAt = now,
        )
        if (cache.getByIdempotencyKey(attempt.key) == null) {
            cache.upsert(placeholder)
            cache.adjustWallet(-attempt.amount.minor, attempt.amount.minor) // the server holds it too
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
        if (tx.status == TransactionStatus.SUCCESS) {
            move(attempt, ok)
            if (!wasHeld) cache.adjustWallet(-attempt.amount.minor, attempt.amount.minor)
        } else {
            move(attempt, failed)
            attempt.failureReason = tx.failureReason ?: ErrorCode.SERVER_ERROR
            attempt.retryable = false // the server recorded it: the same key returns this again
            if (wasHeld) cache.adjustWallet(attempt.amount.minor, -attempt.amount.minor) // released
        }
        return result(attempt, auth).copy(balance = cachedBalance())
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private fun currentDraft(): Draft = draft ?: throw CoreException(ErrorCode.NOT_FOUND, "No transfer started")

    /** In memory, or a pending one rebuilt from the replica after a restart (NFR-REL-03). */
    private fun attempt(id: String): Attempt {
        attempts[id]?.let { return it }
        val row = cache.getByIdempotencyKey(id)
        val cp = row?.counterparty
        if (row == null || row.type != TransactionType.TRANSFER_OUT || cp == null) throw CoreException(ErrorCode.NOT_FOUND, "No transfer $id")
        val state = when (row.status) {
            TransactionStatus.PENDING -> TransferState.PENDING
            TransactionStatus.SUCCESS -> TransferState.SUCCESS
            else -> TransferState.FAILED
        }
        val restored = Attempt(id, Contact(cp.id, cp.name, cp.phone ?: ""), row.amount, row.note, state).apply {
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
            cache.adjustWallet(attempt.amount.minor, -attempt.amount.minor)
        }
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
