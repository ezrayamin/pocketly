package com.pocketly.shared.data

import com.pocketly.shared.domain.Contact
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.Transaction
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * NFR-REL-01: every backend call has a timeout. Wraps any WalletApi (fake or real).
 *
 * ADR-0007: after the timeout the caller gets NETWORK_TIMEOUT and any later response is
 * discarded. `withTimeout` cancels the *client's wait*; server-side work that must finish
 * regardless (M3 transfers) runs in the backend's own scope, not inside this call.
 * Retries with backoff come with the real backend. Mirrors packages/core-js/src/data/timeoutWalletApi.ts.
 */
/** Reads give up after readTimeoutMs; a transfer submission after writeTimeoutMs (FR-TRF-09). */
internal enum class CallKind { READ, WRITE }

internal class TimeoutWalletApi(
    private val inner: WalletApi,
    private val timeoutMs: (CallKind) -> Long,
) : WalletApi {
    override suspend fun getWallet() = withTimeoutOf { inner.getWallet() }

    override suspend fun getChanges(afterToken: String?, limit: Int): ChangesPage =
        withTimeoutOf { inner.getChanges(afterToken, limit) }

    override suspend fun getTransaction(id: String): Transaction = withTimeoutOf { inner.getTransaction(id) }

    override suspend fun requestOtp(phone: String): OtpSendResult = withTimeoutOf { inner.requestOtp(phone) }

    override suspend fun verifyOtp(phone: String, code: String): ServerOtpVerify = withTimeoutOf { inner.verifyOtp(phone, code) }

    override suspend fun searchContacts(query: String): List<Contact> = withTimeoutOf { inner.searchContacts(query) }

    override suspend fun getContact(userId: String): Contact = withTimeoutOf { inner.getContact(userId) }

    /** A timeout here doesn't mean "not applied": the caller treats it as PENDING (ADR-0014 §4). */
    override suspend fun transfer(request: TransferRequest, idempotencyKey: String): Transaction =
        withTimeoutOf(CallKind.WRITE) { inner.transfer(request, idempotencyKey) }

    override suspend fun getTransferByKey(idempotencyKey: String): Transaction =
        withTimeoutOf { inner.getTransferByKey(idempotencyKey) }

    private suspend fun <T> withTimeoutOf(kind: CallKind = CallKind.READ, call: suspend () -> T): T {
        val timeout = timeoutMs(kind)
        return try {
            withTimeout(timeout) { call() }
        } catch (e: TimeoutCancellationException) {
            throw CoreException(ErrorCode.NETWORK_TIMEOUT, "No response after $timeout ms")
        }
    }
}
