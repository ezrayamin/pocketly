package com.pocketly.shared.security

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode

/**
 * The exact bytes the biometric key signs (ADR-0012, fixtures/biometric.json). Each kind starts
 * with its own versioned first line, so an unlock signature can never pass as a transfer
 * approval. Mirrors packages/core-js/src/security/biometricMessages.ts.
 */
object BiometricMessages {
    /** A challenge must be signed within this long, once. */
    const val CHALLENGE_TTL_MS = 60_000L
    const val NONCE_BYTES = 32

    fun unlock(nonceHex: String): String = "pocketly:unlock:v1\nnonce:$nonceHex"

    /** Slice 6 (FR-TRF-04) signs this. INVALID_ARGUMENT for values that can't be encoded unambiguously. */
    fun transfer(amount: Long, recipientId: String, idempotencyKey: String): String {
        if (amount <= 0) throw CoreException(ErrorCode.INVALID_ARGUMENT, "transfer amount must be a positive whole number of minor units")
        for ((name, value) in listOf("recipientId" to recipientId, "idempotencyKey" to idempotencyKey)) {
            if (value.isEmpty() || value.any { it == '\n' || it == '\r' }) {
                throw CoreException(ErrorCode.INVALID_ARGUMENT, "transfer $name must be non-empty and on one line")
            }
        }
        return "pocketly:transfer:v1\namount:$amount\nrecipient:$recipientId\nidempotencyKey:$idempotencyKey"
    }
}
