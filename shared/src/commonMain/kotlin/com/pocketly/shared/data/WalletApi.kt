package com.pocketly.shared.data

import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.Transaction
import com.pocketly.shared.domain.Wallet

/** One page of server changes, ordered by (updatedAt, id). */
data class ChangesPage(val items: List<Transaction>, val nextToken: String?, val hasMore: Boolean)

/**
 * Backend boundary (requirements §4.1, NFR-ARCH-03). Swapping FakeWalletApi for a real
 * implementation only changes `bridge/di/CoreModule.kt`. History reads the local replica
 * (ADR-0009), so the backend exposes a change feed instead of paged history.
 * transfer / topUp / payMerchant / searchContacts / incomingEvents() arrive with M3–M4.
 * Mirrors packages/core-js/src/data/walletApi.ts.
 */
interface WalletApi {
    suspend fun getWallet(): Wallet

    /** Changes after [afterToken] (all, when null): the replica's delta sync. */
    suspend fun getChanges(afterToken: String?, limit: Int): ChangesPage
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
