package com.pocketly.shared.data.fake

import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.TransactionStore
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet

/**
 * In-process fake backend (requirements §4.2). Serves straight from the store.
 * Latency/failure simulation (FR-FAKE-04) arrives with the developer menu.
 * Mirrors packages/core-js/src/data/fakeWalletApi.ts.
 */
internal class FakeWalletApi(private val store: TransactionStore) : WalletApi, FakeBackendControls {
    private var nowMillis = 0L

    override fun reset(config: DatasetConfig) {
        if (config.transactionCount < 1) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "transactionCount must be >= 1")
        }
        store.replaceAll(SeedData.generate(config), config.nowMillis)
        nowMillis = config.nowMillis
    }

    override suspend fun getWallet() = Wallet(
        id = SeedData.WALLET_ID,
        balance = store.balance(),
        dailyLimit = SeedData.DAILY_LIMIT,
        usedToday = store.usedToday(),
        updatedAt = nowMillis,
    )

    override suspend fun getTransactions(cursor: String?, limit: Int, filter: TxFilter?): TransactionPage {
        if (limit !in 1..MAX_PAGE_SIZE) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "limit must be 1..$MAX_PAGE_SIZE, got $limit")
        }
        return store.page(cursor, limit, filter)
    }

    override suspend fun getTransaction(id: String): Transaction =
        store.get(id) ?: throw CoreException(ErrorCode.NOT_FOUND, "No transaction $id")

    companion object {
        const val MAX_PAGE_SIZE = 100
    }
}
