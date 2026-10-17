package com.pocketly.shared.data

import app.cash.sqldelight.db.SqlDriver
import com.pocketly.shared.data.db.Rows.toDomain
import com.pocketly.shared.db.cache.CacheDatabase
import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet

/**
 * The app's local replica (pocketly-cache.db, FR-HIST-04, ADR-0009). Never written by the
 * fake backend. Mirrors packages/core-js/src/data/cacheStore.ts.
 */
internal class CacheStore(driver: SqlDriver) {
    private val db = CacheDatabase(driver)
    private val q = db.cacheQueries

    /**
     * Changes with every [clear]. Work that fetched from the server before a clear (logout,
     * NFR-SEC-05) compares it before writing, so it can't put the old data back.
     */
    var generation = 0
        private set

    fun clear() = db.transaction {
        generation++
        q.deleteAllTransactions()
        q.deleteWallet()
        q.deleteSyncMeta()
    }

    /** Server rows in; a placeholder whose server row has arrived goes (ADR-0014 §4). */
    fun upsertMany(transactions: List<Transaction>) = db.transaction {
        transactions.forEach { tx -> write(tx, ifAbsent = false) }
        q.dropSettledPlaceholders()
    }

    fun upsert(tx: Transaction) = upsertMany(listOf(tx))

    fun delete(id: String) {
        q.deleteTransaction(id)
    }

    /** The server's row for this key if the replica has it, else the app's placeholder. */
    fun getByIdempotencyKey(key: String): Transaction? = q.getByIdempotencyKey(key).executeAsOneOrNull()?.toDomain()

    /** FR-TRF-01: people this wallet sent to, most recent first. */
    fun recentRecipients(limit: Long): List<Contact> = q.recentRecipients(limit).executeAsList().map {
        Contact(it.counterparty_id!!, it.counterparty_name!!, it.counterparty_phone!!)
    }

    /**
     * Optimistic wallet update (product §6.1 step 8): what a transfer just did to the balance and
     * today's usage, until the next refresh brings the server's numbers. Keeps cachedAt.
     */
    fun adjustWallet(balanceDelta: Long, usedDelta: Long): Wallet? {
        val (cached, cachedAt) = getWallet() ?: return null
        val wallet = cached.copy(
            balance = Money(cached.balance.minor + balanceDelta),
            usedToday = Money(maxOf(0L, cached.usedToday.minor + usedDelta)),
        )
        upsertWallet(wallet, cachedAt)
        return wallet
    }

    /** BM-04 write step: inserts rows whose id isn't cached yet; returns how many were inserted. */
    fun insertIfAbsentMany(transactions: List<Transaction>): Int = db.transactionWithResult {
        transactions.sumOf { tx -> write(tx, ifAbsent = true).toInt() }
    }

    fun get(id: String): Transaction? = q.getTransaction(id).executeAsOneOrNull()?.toDomain()

    /** FR-HIST-01: newest first, cursor = (createdAt, id) of the last row; no offsets. */
    fun page(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage {
        val types = filterList(filter?.types?.map { it.name })
        val statuses = filterList(filter?.statuses?.map { it.name })
        val fetch = limit + 1L
        val rows = if (cursor == null) {
            q.pageFirst(types, statuses, fetch).executeAsList()
        } else {
            val m = CURSOR.find(cursor) ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Malformed cursor")
            val createdAt = m.groupValues[1].toLongOrNull()
                ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Malformed cursor")
            q.pageAfter(createdAt, m.groupValues[2], types, statuses, fetch).executeAsList()
        }
        val items = rows.take(limit).map { it.toDomain() }
        val next = if (rows.size > limit) items.last().let { "${it.createdAt}:${it.id}" } else null
        return TransactionPage(items, next)
    }

    /** BM-03 storage step: the whole replica, newest first. */
    fun all(): List<Transaction> = q.allTransactions().executeAsList().map { it.toDomain() }

    fun upsertWallet(wallet: Wallet, cachedAt: Long) {
        q.upsertWallet(wallet.id, wallet.balance.minor, wallet.dailyLimit.minor, wallet.usedToday.minor, wallet.updatedAt, cachedAt)
    }

    fun getWallet(): Pair<Wallet, Long>? = q.getWallet().executeAsOneOrNull()?.let {
        Wallet(it.id, Money(it.balance), Money(it.daily_limit), Money(it.used_today), it.updated_at) to it.cached_at
    }

    fun syncToken(): String? = q.getMeta(META_SYNC_TOKEN).executeAsOneOrNull()

    fun lastSyncedAt(): Long? = q.getMeta(META_LAST_SYNCED_AT).executeAsOneOrNull()?.toLong()

    fun markSynced(token: String?, at: Long) {
        if (token != null) q.setMeta(META_SYNC_TOKEN, token)
        q.setMeta(META_LAST_SYNCED_AT, at.toString())
    }

    /** ADR-0010: identifies this install. [clear] keeps it; only uninstalling the app removes it. */
    fun installId(): String? = q.getMeta(META_INSTALL_ID).executeAsOneOrNull()

    fun setInstallId(id: String) {
        q.setMeta(META_INSTALL_ID, id)
    }

    private fun write(tx: Transaction, ifAbsent: Boolean): Long {
        val cp = tx.counterparty
        return if (ifAbsent) {
            q.insertTransactionIfAbsent(
                tx.id, tx.idempotencyKey, tx.type.name, tx.category.name, tx.amount.minor,
                cp?.kind?.name, cp?.id, cp?.name, cp?.phone, tx.note,
                tx.status.name, tx.failureReason?.name, tx.createdAt, tx.updatedAt,
            ).value
        } else {
            q.upsertTransaction(
                tx.id, tx.idempotencyKey, tx.type.name, tx.category.name, tx.amount.minor,
                cp?.kind?.name, cp?.id, cp?.name, cp?.phone, tx.note,
                tx.status.name, tx.failureReason?.name, tx.createdAt, tx.updatedAt,
            ).value
        }
    }

    companion object {
        /** ADR-0014 §4: ids of the app's own pending rows, until the server's row replaces them. */
        const val PLACEHOLDER_PREFIX = "local-"

        private val CURSOR = Regex("""^(\d+):(.+)$""")
        private const val META_SYNC_TOKEN = "syncToken"
        private const val META_LAST_SYNCED_AT = "lastSyncedAt"
        private const val META_INSTALL_ID = "installId"

        /** ",A,B," for the shared SQL's instr() filter; "" = no filter. */
        private fun filterList(values: List<String>?) = if (values.isNullOrEmpty()) "" else values.joinToString(",", ",", ",")
    }
}
