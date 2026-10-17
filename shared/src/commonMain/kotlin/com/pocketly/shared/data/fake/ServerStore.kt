package com.pocketly.shared.data.fake

import app.cash.sqldelight.db.SqlDriver
import com.pocketly.shared.data.db.Rows.toDomain
import com.pocketly.shared.db.server.ServerDatabase
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus

/** server_transfer_key: the request a key was first used for (FR-FAKE-02/03). */
internal data class TransferKeyRow(val recipientId: String, val amount: Money, val note: String?, val transactionId: String)

internal data class Settlement(val transactionId: String, val resolveAt: Long, val fails: Boolean)

/**
 * The fake backend's database (pocketly-server.db, FR-FAKE-07). Only FakeWalletApi uses it.
 * Mirrors packages/core-js/src/data/fake/serverStore.ts.
 */
internal class ServerStore(driver: SqlDriver) {
    private val db = ServerDatabase(driver)
    private val q = db.serverQueries

    fun replaceAll(transactions: List<Transaction>, meta: Map<String, String>) = db.transaction {
        q.deleteAllTransactions()
        q.deleteAllMeta()
        q.deleteAllTransferKeys()
        q.deleteAllSettlements()
        transactions.forEach(::insertRow)
        meta.forEach { (k, v) -> q.setMeta(k, v) }
    }

    fun insert(tx: Transaction) = insertRow(tx)

    fun get(id: String): Transaction? = q.getTransaction(id).executeAsOneOrNull()?.toDomain()

    fun changesSince(afterUpdatedAt: Long, afterId: String, limit: Long): List<Transaction> =
        q.changesSince(afterUpdatedAt, afterId, limit).executeAsList().map { it.toDomain() }

    fun balance(): Long = q.balance().executeAsOne()

    fun usedSince(from: Long): Long = q.usedSince(from).executeAsOne()

    fun getTransferKey(key: String): TransferKeyRow? = q.getTransferKey(key).executeAsOneOrNull()?.let {
        TransferKeyRow(it.recipient_id, Money(it.amount), it.note, it.transaction_id)
    }

    /** A new transfer, its key, the meta that counts it, and its settlement: all or nothing. */
    fun recordTransfer(tx: Transaction, key: TransferKeyRow, meta: Map<String, String>, settlement: Settlement?) = db.transaction {
        insertRow(tx)
        q.insertTransferKey(tx.idempotencyKey, key.recipientId, key.amount.minor, key.note, key.transactionId)
        meta.forEach { (k, v) -> q.setMeta(k, v) }
        settlement?.let { q.insertSettlement(it.transactionId, it.resolveAt, if (it.fails) 1 else 0) }
    }

    fun dueSettlements(now: Long): List<Settlement> =
        q.dueSettlements(now).executeAsList().map { Settlement(it.transaction_id, it.resolve_at, it.fails != 0L) }

    /** Settles a held transfer: its new status, and the settlement row removed, together. */
    fun settle(id: String, status: TransactionStatus, failureReason: ErrorCode?, updatedAt: Long) = db.transaction {
        q.updateTransactionStatus(status.name, failureReason?.name, updatedAt, id)
        q.deleteSettlement(id)
    }

    fun getMeta(key: String): String? = q.getMeta(key).executeAsOneOrNull()

    fun setMeta(key: String, value: String) {
        q.setMeta(key, value)
    }

    private fun insertRow(tx: Transaction) {
        val cp = tx.counterparty
        q.insertTransaction(
            tx.id, tx.idempotencyKey, tx.type.name, tx.category.name, tx.amount.minor,
            cp?.kind?.name, cp?.id, cp?.name, cp?.phone, tx.note,
            tx.status.name, tx.failureReason?.name, tx.createdAt, tx.updatedAt,
        )
    }
}
