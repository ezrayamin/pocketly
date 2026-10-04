package com.pocketly.shared.data

import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.TransactionPage
import com.pocketly.shared.domain.TxFilter
import com.pocketly.shared.domain.Wallet

/**
 * Backend boundary (requirements §4.1, NFR-ARCH-03). Swapping FakeWalletApi for a
 * real implementation only changes `bridge/di/CoreModule.kt`.
 *
 * transfer / topUp / payMerchant / searchContacts / incomingEvents() arrive with M3–M4.
 */
interface WalletApi {
    suspend fun getWallet(): Wallet
    suspend fun getTransactions(cursor: String?, limit: Int = 20, filter: TxFilter? = null): TransactionPage
    suspend fun getTransaction(id: String): Transaction
}

/** Developer-menu controls (FR-DEV-*). Only the fake backend implements this. */
interface FakeBackendControls {
    /** FR-DEV-05: reset to a seeded state. */
    fun reset(config: DatasetConfig)

    /** FR-DEV-04: the backend receives a deterministic incoming transfer, now. */
    fun simulateIncomingTransfer(): Transaction

    /** FR-DEV-02/03. */
    var networkSimulation: NetworkSimulation
}
