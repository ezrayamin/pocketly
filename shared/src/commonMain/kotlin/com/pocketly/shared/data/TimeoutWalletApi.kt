package com.pocketly.shared.data

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
internal class TimeoutWalletApi(
    private val inner: WalletApi,
    private val timeoutMs: () -> Long,
) : WalletApi {
    override suspend fun getWallet() = withReadTimeout { inner.getWallet() }

    override suspend fun getChanges(afterToken: String?, limit: Int): ChangesPage =
        withReadTimeout { inner.getChanges(afterToken, limit) }

    override suspend fun getTransaction(id: String): Transaction = withReadTimeout { inner.getTransaction(id) }

    override suspend fun requestOtp(phone: String): OtpSendResult = withReadTimeout { inner.requestOtp(phone) }

    override suspend fun verifyOtp(phone: String, code: String): ServerOtpVerify = withReadTimeout { inner.verifyOtp(phone, code) }

    private suspend fun <T> withReadTimeout(call: suspend () -> T): T {
        val timeout = timeoutMs()
        return try {
            withTimeout(timeout) { call() }
        } catch (e: TimeoutCancellationException) {
            throw CoreException(ErrorCode.NETWORK_TIMEOUT, "No response after $timeout ms")
        }
    }
}
