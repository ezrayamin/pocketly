package com.pocketly.shared.data.fake

import app.cash.sqldelight.db.SqlDriver
import com.pocketly.shared.data.db.Rows.toDomain
import com.pocketly.shared.db.server.ServerDatabase
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.NotificationKind
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus

/**
 * server_transfer_key: the request a key was first used for (FR-FAKE-02/03). [recipientId]: a
 * transfer's recipient, a top-up's payment method, a QR payment's merchant (with its [requestId]).
 */
internal data class TransferKeyRow(
    val recipientId: String,
    val amount: Money,
    val note: String?,
    val transactionId: String,
    val requestId: String? = null,
)

/** server_payment_request: a dynamic QR code's request (ADR-0016 §4). [paidBy] null while open. */
internal data class PaymentRequestRow(
    val id: String,
    val merchantId: String,
    val amount: Long,
    val expiresAt: Long,
    val paidBy: String? = null,
)

/** server_event: one entry of the event log the client catches up from (ADR-0017 §1). */
internal data class EventRow(val seq: Long, val kind: NotificationKind, val transactionId: String, val createdAt: Long)

/** server_pending_settlement: a held transfer or a top-up being processed, and how it ends. */
internal data class Settlement(
    val transactionId: String,
    val resolveAt: Long,
    val fails: Boolean,
    /** The code a failing row settles with; null means SERVER_ERROR (rows from schema 2). */
    val failureReason: ErrorCode? = null,
)

/**
 * The fake backend's database (pocketly-server.db, FR-FAKE-07). Only FakeWalletApi uses it.
 * Mirrors packages/core-js/src/data/fake/serverStore.ts.
 */
internal class ServerStore(driver: SqlDriver) {
    private val db = ServerDatabase(driver)
    private val q = db.serverQueries

    fun replaceAll(transactions: List<Transaction>, paymentRequests: List<PaymentRequestRow>, meta: Map<String, String>) = db.transaction {
        q.deleteAllTransactions()
        q.deleteAllMeta()
        q.deleteAllTransferKeys()
        q.deleteAllSettlements()
        q.deleteAllPaymentRequests()
        q.deleteAllEvents()
        transactions.forEach(::insertRow)
        paymentRequests.forEach { q.insertPaymentRequest(it.id, it.merchantId, it.amount, it.expiresAt, it.paidBy) }
        meta.forEach { (k, v) -> q.setMeta(k, v) }
    }

    /** An incoming transfer, the meta that counts it, and its MONEY_RECEIVED event: all or nothing (ADR-0017 §1). */
    fun insertIncoming(tx: Transaction, meta: Map<String, String>) = db.transaction {
        insertRow(tx)
        meta.forEach { (k, v) -> q.setMeta(k, v) }
        q.insertEvent(NotificationKind.MONEY_RECEIVED.name, tx.id, tx.createdAt)
    }

    /** The log after [seq], oldest first. */
    fun eventsAfter(seq: Long, limit: Long): List<EventRow> = q.eventsAfter(seq, limit).executeAsList().map {
        EventRow(it.seq, NotificationKind.valueOf(it.kind), it.transaction_id, it.created_at)
    }

    fun get(id: String): Transaction? = q.getTransaction(id).executeAsOneOrNull()?.toDomain()

    fun changesSince(afterUpdatedAt: Long, afterId: String, limit: Long): List<Transaction> =
        q.changesSince(afterUpdatedAt, afterId, limit).executeAsList().map { it.toDomain() }

    fun balance(): Long = q.balance().executeAsOne()

    fun usedSince(from: Long): Long = q.usedSince(from).executeAsOne()

    fun getTransferKey(key: String): TransferKeyRow? = q.getTransferKey(key).executeAsOneOrNull()?.let {
        TransferKeyRow(it.recipient_id, Money(it.amount), it.note, it.transaction_id, it.request_id)
    }

    /**
     * A new transfer, top-up or QR payment, its key, the meta that counts it, its settlement, and the
     * payment request it pays: all or nothing.
     */
    fun recordTransfer(
        tx: Transaction,
        key: TransferKeyRow,
        meta: Map<String, String>,
        settlement: Settlement?,
        paysRequest: String? = null,
    ) = db.transaction {
        insertRow(tx)
        q.insertTransferKey(tx.idempotencyKey, key.recipientId, key.amount.minor, key.note, key.transactionId, key.requestId)
        meta.forEach { (k, v) -> q.setMeta(k, v) }
        paysRequest?.let { q.markPaymentRequestPaid(tx.id, it) }
        settlement?.let { q.insertSettlement(it.transactionId, it.resolveAt, if (it.fails) 1 else 0, it.failureReason?.name) }
    }

    fun dueSettlements(now: Long): List<Settlement> = q.dueSettlements(now).executeAsList().map {
        settlement(it.transaction_id, it.resolve_at, it.fails, it.failure_reason)
    }

    fun getSettlement(transactionId: String): Settlement? = q.getSettlement(transactionId).executeAsOneOrNull()?.let {
        settlement(it.transaction_id, it.resolve_at, it.fails, it.failure_reason)
    }

    /**
     * Settles a held transaction: its new status, the settlement row removed, and the
     * TRANSACTION_SETTLED event (ADR-0017 §1), together. A failed QR payment gives its payment request
     * back (ADR-0016 §4).
     */
    fun settle(id: String, status: TransactionStatus, failureReason: ErrorCode?, updatedAt: Long) = db.transaction {
        q.updateTransactionStatus(status.name, failureReason?.name, updatedAt, id)
        q.deleteSettlement(id)
        q.insertEvent(NotificationKind.TRANSACTION_SETTLED.name, id, updatedAt)
        if (status == TransactionStatus.FAILED) q.reopenPaymentRequest(id)
    }

    fun getPaymentRequest(id: String): PaymentRequestRow? = q.getPaymentRequest(id).executeAsOneOrNull()?.let {
        PaymentRequestRow(it.id, it.merchant_id, it.amount, it.expires_at, it.paid_by)
    }

    fun getMeta(key: String): String? = q.getMeta(key).executeAsOneOrNull()

    fun setMeta(key: String, value: String) {
        q.setMeta(key, value)
    }

    private fun settlement(id: String, resolveAt: Long, fails: Long, failureReason: String?) =
        Settlement(id, resolveAt, fails != 0L, failureReason?.let { ErrorCode.valueOf(it) })

    private fun insertRow(tx: Transaction) {
        val cp = tx.counterparty
        q.insertTransaction(
            tx.id, tx.idempotencyKey, tx.type.name, tx.category.name, tx.amount.minor,
            cp?.kind?.name, cp?.id, cp?.name, cp?.phone, tx.note,
            tx.status.name, tx.failureReason?.name, tx.createdAt, tx.updatedAt,
        )
    }
}
