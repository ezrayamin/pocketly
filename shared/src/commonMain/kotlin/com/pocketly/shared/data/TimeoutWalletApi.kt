package com.pocketly.shared.data

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
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

    override suspend fun getTransactions(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage =
        withReadTimeout { inner.getTransactions(cursor, limit, filter) }

    override suspend fun getTransaction(id: String): Transaction = withReadTimeout { inner.getTransaction(id) }

    private suspend fun <T> withReadTimeout(call: suspend () -> T): T {
        val timeout = timeoutMs()
        return try {
            withTimeout(timeout) { call() }
        } catch (e: TimeoutCancellationException) {
            throw CoreException(ErrorCode.NETWORK_TIMEOUT, "No response after $timeout ms")
        }
    }
}
