package com.pocketly.shared.data

import com.pocketly.shared.domain.Category
import com.pocketly.shared.domain.Counterparty
import com.pocketly.shared.domain.CounterpartyKind
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.IngestRejectReason
import com.pocketly.shared.domain.Money
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionStatus
import com.pocketly.shared.domain.TransactionType
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.floor

/**
 * Validates one untrusted JSON value (NFR-REL-02: never crash on malformed data).
 * Rules run in a fixed order and the first failure wins.
 * Mirrors packages/core-js/src/data/transactionDtoValidator.ts.
 */
internal object TransactionDtoValidator {
    const val MAX_ID_LENGTH = 64
    const val MAX_NOTE_LENGTH = 140

    sealed interface Result {
        data class Valid(val value: Transaction) : Result
        data class Invalid(val reason: IngestRejectReason) : Result
    }

    private fun JsonObject.absent(key: String): Boolean = this[key].let { it == null || it is JsonNull }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Same rule as JS `Number.isSafeInteger` on the parsed value: `1`, `1.0` and `1e3` all pass. */
    private fun JsonObject.safeInteger(key: String): Long? {
        val p = this[key] as? JsonPrimitive ?: return null
        if (p.isString || p is JsonNull) return null
        p.content.toLongOrNull()?.let { return it.takeIf { abs(it) <= Money.MAX_SAFE_INTEGER } }
        val d = p.content.toDoubleOrNull() ?: return null
        return if (d.isFinite() && d == floor(d) && abs(d) <= Money.MAX_SAFE_INTEGER) d.toLong() else null
    }

    private fun isId(v: String?) = v != null && v.isNotEmpty() && v.length <= MAX_ID_LENGTH

    private inline fun <reified E : Enum<E>> enumOrNull(v: String?): E? =
        if (v == null) null else enumValues<E>().firstOrNull { it.name == v }

    /** null = absent, Invalid = present but malformed. */
    private fun counterparty(obj: JsonObject): Any? {
        if (obj.absent("counterparty")) return null
        val c = obj["counterparty"] as? JsonObject ?: return INVALID
        val kind = enumOrNull<CounterpartyKind>(c.string("kind")) ?: return INVALID
        val id = c.string("id")?.takeIf { it.isNotEmpty() } ?: return INVALID
        val name = c.string("name")?.takeIf { it.isNotEmpty() } ?: return INVALID
        val phone = if (c.absent("phone")) null else c.string("phone") ?: return INVALID
        return Counterparty(kind, id, name, phone)
    }

    private val INVALID = Any()

    /** Same rules for an already-typed transaction (server seed rows: DatasetConfig.extraTransactions). */
    fun validate(tx: Transaction): IngestRejectReason? = when {
        !isId(tx.id) || !isId(tx.idempotencyKey) -> IngestRejectReason.INVALID_ID
        tx.amount.minor <= 0 || tx.amount.minor > Money.MAX_AMOUNT_MINOR -> IngestRejectReason.INVALID_AMOUNT
        (tx.status == TransactionStatus.FAILED) != (tx.failureReason != null) -> IngestRejectReason.INVALID_FAILURE_REASON
        tx.createdAt < 0 || tx.updatedAt < tx.createdAt -> IngestRejectReason.INVALID_TIMESTAMP
        tx.counterparty != null && (tx.counterparty.id.isEmpty() || tx.counterparty.name.isEmpty()) ->
            IngestRejectReason.INVALID_COUNTERPARTY
        tx.note != null && tx.note.length > MAX_NOTE_LENGTH -> IngestRejectReason.INVALID_NOTE
        else -> null
    }

    fun validate(raw: JsonElement?): Result {
        val obj = raw as? JsonObject ?: return Result.Invalid(IngestRejectReason.INVALID_SHAPE)

        val id = obj.string("id")
        val idempotencyKey = obj.string("idempotencyKey")
        if (!isId(id) || !isId(idempotencyKey)) return Result.Invalid(IngestRejectReason.INVALID_ID)

        val type = enumOrNull<TransactionType>(obj.string("type"))
            ?: return Result.Invalid(IngestRejectReason.INVALID_TYPE)
        val category = enumOrNull<Category>(obj.string("category"))
            ?: return Result.Invalid(IngestRejectReason.INVALID_CATEGORY)

        val amount = obj.safeInteger("amount")
        if (amount == null || amount <= 0 || amount > Money.MAX_AMOUNT_MINOR) {
            return Result.Invalid(IngestRejectReason.INVALID_AMOUNT)
        }

        val status = enumOrNull<TransactionStatus>(obj.string("status"))
            ?: return Result.Invalid(IngestRejectReason.INVALID_STATUS)

        val failed = status == TransactionStatus.FAILED
        val failureReason = enumOrNull<ErrorCode>(obj.string("failureReason"))
        if (if (failed) failureReason == null else !obj.absent("failureReason")) {
            return Result.Invalid(IngestRejectReason.INVALID_FAILURE_REASON)
        }

        val createdAt = obj.safeInteger("createdAt")
        val updatedAt = obj.safeInteger("updatedAt")
        if (createdAt == null || updatedAt == null || createdAt < 0 || updatedAt < 0 || updatedAt < createdAt) {
            return Result.Invalid(IngestRejectReason.INVALID_TIMESTAMP)
        }

        val counterparty = counterparty(obj)
        if (counterparty === INVALID) return Result.Invalid(IngestRejectReason.INVALID_COUNTERPARTY)

        val note = if (obj.absent("note")) null else obj.string("note")
        if (!obj.absent("note") && (note == null || note.length > MAX_NOTE_LENGTH)) {
            return Result.Invalid(IngestRejectReason.INVALID_NOTE)
        }

        return Result.Valid(
            Transaction(
                id = id!!,
                idempotencyKey = idempotencyKey!!,
                type = type,
                category = category,
                amount = Money(amount),
                counterparty = counterparty as Counterparty?,
                note = note,
                status = status,
                failureReason = if (failed) failureReason else null,
                createdAt = createdAt,
                updatedAt = updatedAt,
            ),
        )
    }
}
