package com.pocketly.shared.domain

/** requirements §4.3, plus NOT_FOUND / INVALID_ARGUMENT. Mirrors `ErrorCode` in core-contract. */
enum class ErrorCode(val retryable: Boolean) {
    INSUFFICIENT_FUNDS(false),
    DAILY_LIMIT_EXCEEDED(false),
    RECIPIENT_NOT_FOUND(false),
    INVALID_QR(false),
    NETWORK_TIMEOUT(false),
    NETWORK_UNAVAILABLE(true),
    SERVER_ERROR(true),
    IDEMPOTENCY_CONFLICT(false),
    NOT_FOUND(false),
    INVALID_ARGUMENT(false),
}

/**
 * The only exception the core throws on purpose (NFR-REL-02). The `[CODE]` message
 * prefix is how the code survives the JS bridge: core-contract's `toCoreError()` parses it.
 */
class CoreException(val code: ErrorCode, detail: String) : Exception("[${code.name}] $detail")
