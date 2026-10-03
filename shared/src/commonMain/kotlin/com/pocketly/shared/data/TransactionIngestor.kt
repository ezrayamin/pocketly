package com.pocketly.shared.data

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.IngestError
import com.pocketly.shared.domain.IngestResult
import com.pocketly.shared.domain.Transaction
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * BM-04: JSON → validate → write. Mirrors packages/core-js/src/data/transactionIngestor.ts.
 * Both sides parse into a generic tree first, then validate field by field.
 */
internal class TransactionIngestor(private val store: TransactionStore) {

    fun ingest(json: String): IngestResult {
        val parsed: JsonElement = try {
            Json.parseToJsonElement(json)
        } catch (e: SerializationException) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "Payload is not valid JSON")
        }
        val entries = parsed as? JsonArray
            ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Payload must be a JSON array")

        val accepted = ArrayList<Transaction>(entries.size)
        val seen = HashSet<String>()
        val errors = ArrayList<IngestError>()
        var rejected = 0
        var duplicates = 0

        entries.forEachIndexed { index, element ->
            when (val result = TransactionDtoValidator.validate(element)) {
                is TransactionDtoValidator.Result.Invalid -> {
                    rejected++
                    if (errors.size < IngestResult.MAX_ERRORS) errors += IngestError(index, result.reason)
                }
                is TransactionDtoValidator.Result.Valid -> {
                    val id = result.value.id
                    if (id in seen || store.has(id)) {
                        duplicates++
                    } else {
                        seen += id
                        accepted += result.value
                    }
                }
            }
        }

        store.insertAll(accepted)
        return IngestResult(accepted.size, rejected, duplicates, errors)
    }
}
