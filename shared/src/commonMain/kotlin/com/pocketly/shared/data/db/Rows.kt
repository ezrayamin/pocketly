package com.pocketly.shared.data.db

import com.pocketly.shared.db.cache.Cache_transaction
import com.pocketly.shared.db.server.Server_transaction
import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType

/** Row ⇄ domain mapping for the shared transaction columns. Mirrors core-js/src/data/db/rows.ts. */
internal object Rows {
    @Suppress("LongParameterList")
    fun transaction(
        id: String, idempotencyKey: String, type: String, category: String, amount: Long,
        cpKind: String?, cpId: String?, cpName: String?, cpPhone: String?, note: String?,
        status: String, failureReason: String?, createdAt: Long, updatedAt: Long,
    ) = Transaction(
        id = id,
        idempotencyKey = idempotencyKey,
        type = TransactionType.valueOf(type),
        category = Category.valueOf(category),
        amount = Money(amount),
        counterparty = cpKind?.let { Counterparty(CounterpartyKind.valueOf(it), cpId!!, cpName!!, cpPhone) },
        note = note,
        status = TransactionStatus.valueOf(status),
        failureReason = failureReason?.let { ErrorCode.valueOf(it) },
        createdAt = createdAt,
        updatedAt = updatedAt,
    )

    fun Server_transaction.toDomain() = transaction(
        id, idempotency_key, type, category, amount, counterparty_kind, counterparty_id, counterparty_name,
        counterparty_phone, note, status, failure_reason, created_at, updated_at,
    )

    fun Cache_transaction.toDomain() = transaction(
        id, idempotency_key, type, category, amount, counterparty_kind, counterparty_id, counterparty_name,
        counterparty_phone, note, status, failure_reason, created_at, updated_at,
    )
}
