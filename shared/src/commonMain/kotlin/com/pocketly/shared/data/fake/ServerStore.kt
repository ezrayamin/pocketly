package com.pocketly.shared.data.fake

import app.cash.sqldelight.db.SqlDriver
import com.pocketly.shared.data.db.Rows.toDomain
import com.pocketly.shared.db.server.ServerDatabase
import com.pocketly.shared.domain.Transaction

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
        transactions.forEach(::insertRow)
        meta.forEach { (k, v) -> q.setMeta(k, v) }
    }

    fun insert(tx: Transaction) = insertRow(tx)

    fun get(id: String): Transaction? = q.getTransaction(id).executeAsOneOrNull()?.toDomain()

    fun changesSince(afterUpdatedAt: Long, afterId: String, limit: Long): List<Transaction> =
        q.changesSince(afterUpdatedAt, afterId, limit).executeAsList().map { it.toDomain() }

    fun balance(): Long = q.balance().executeAsOne()

    fun usedSince(from: Long): Long = q.usedSince(from).executeAsOne()

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
