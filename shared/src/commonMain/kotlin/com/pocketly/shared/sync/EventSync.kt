package com.pocketly.shared.sync

import com.pocketly.shared.data.CacheStore
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.WalletEvent
import com.pocketly.shared.domain.AppNotification
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.NotificationKind
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * ADR-0017 §2: reads the server's event log after the last event applied, page by page, and applies
 * each event once: the transaction into the replica, a notification if it notifies, the cursor, in one
 * cache transaction. Catch-ups run one at a time; asking while one runs gets one more pass after it
 * (the signal may be for an event that pass already missed). A clear() meanwhile (logout) stops it
 * without writing. Callers run it on the core's database thread.
 * Mirrors packages/core-js/src/sync/eventSync.ts.
 */
internal class EventSync(
    private val api: WalletApi,
    private val cache: CacheStore,
    /** A settled payment this install saw PENDING: its attempt moves (PaymentFlow.applySettled). */
    private val onSettled: (Transaction) -> Unit,
) {
    private val delivered = MutableSharedFlow<List<AppNotification>>(extraBufferCapacity = 64)

    /** What each catch-up added, newest first. Delivery only: catching up goes on with no one collecting. */
    val added: SharedFlow<List<AppNotification>> = delivered.asSharedFlow()

    private val mutex = Mutex()
    private var requested = 0L
    private var covered = 0L

    suspend fun catchUp() {
        val ticket = ++requested
        mutex.withLock {
            if (covered >= ticket) return // a pass that began after this call asked has run
            val upTo = requested
            pass()
            covered = upTo
        }
    }

    private suspend fun pass() {
        val generation = cache.generation
        val added = mutableListOf<AppNotification>()
        val failure = try {
            readLog(generation, added)
            null
        } catch (e: CoreException) {
            e
        }
        // What was applied is delivered, even when a later page failed.
        if (added.isNotEmpty() && cache.generation == generation) delivered.emit(added.toList())
        failure?.let { throw it }
    }

    private suspend fun readLog(generation: Int, added: MutableList<AppNotification>) {
        var cursor = cache.eventCursor()
        while (true) {
            val page = api.getEvents(cursor, PAGE_SIZE)
            // The writes below don't suspend, so a clear can only have happened during the call.
            if (cache.generation != generation) return
            for (event in page.items) {
                if (event.seq <= cursor) continue // delivered twice: applied once
                apply(event)?.let { added.add(0, it) }
                cursor = event.seq
            }
            if (!page.hasMore) return
        }
    }

    /** The notification it made, or null for none. */
    private fun apply(event: WalletEvent): AppNotification? {
        val tx = event.transaction
        // The server's row, or the app's own pending one for the same key (ADR-0014 §4).
        val before = cache.get(tx.id) ?: cache.getByIdempotencyKey(tx.idempotencyKey)
        val wasPending = before?.status == TransactionStatus.PENDING
        val notifies = event.kind == NotificationKind.MONEY_RECEIVED || wasPending
        if (event.kind == NotificationKind.TRANSACTION_SETTLED && wasPending) onSettled(tx)
        val notification = if (notifies) CacheStore.NewNotification("evt-${event.seq}", event.kind, event.createdAt) else null
        cache.applyEvent(event.seq, tx, notification, AppNotification.KEPT)
        // Money in that the replica didn't have: the balance moves with the history (NFR-MONEY-03).
        if (event.kind == NotificationKind.MONEY_RECEIVED && before == null) cache.adjustWallet(tx.amount.minor, 0)
        return notification?.let { AppNotification(it.id, it.kind, tx, it.createdAt, read = false) }
    }

    companion object {
        /** Events per request. The server caps at 500. */
        const val PAGE_SIZE = 100
    }
}
