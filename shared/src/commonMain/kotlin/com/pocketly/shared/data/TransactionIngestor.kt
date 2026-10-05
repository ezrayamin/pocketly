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

/** BM-04 compute step output. Valid entries in input order (duplicates included). */
internal class ParsedIngest(val valid: List<Transaction>, val rejected: Int, val errors: List<IngestError>)

/**
 * BM-04 compute step: JSON → generic tree → field-by-field validation. The write step is
 * CacheStore.insertIfAbsentMany (storage, timed separately: ADR-0009).
 * Mirrors packages/core-js/src/data/transactionIngestor.ts.
 */
internal object TransactionIngestor {
    fun parseAndValidate(json: String): ParsedIngest {
        val parsed: JsonElement = try {
            Json.parseToJsonElement(json)
        } catch (e: SerializationException) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "Payload is not valid JSON")
        }
        val entries = parsed as? JsonArray
            ?: throw CoreException(ErrorCode.INVALID_ARGUMENT, "Payload must be a JSON array")

        val valid = ArrayList<Transaction>(entries.size)
        val errors = ArrayList<IngestError>()
        var rejected = 0
        entries.forEachIndexed { index, element ->
            when (val result = TransactionDtoValidator.validate(element)) {
                is TransactionDtoValidator.Result.Valid -> valid += result.value
                is TransactionDtoValidator.Result.Invalid -> {
                    rejected++
                    if (errors.size < IngestResult.MAX_ERRORS) errors += IngestError(index, result.reason)
                }
            }
        }
        return ParsedIngest(valid, rejected, errors)
    }
}
