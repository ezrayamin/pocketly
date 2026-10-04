package com.pocketly.shared.bridge.di

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.FakeBackendControls
import com.pocketly.shared.data.InMemoryTransactionStore
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.data.TransactionIngestor
import com.pocketly.shared.data.TransactionStore
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.fake.FakeWalletApi
import org.koin.dsl.binds
import org.koin.dsl.module

/**
 * Composition root (NFR-ARCH-03). Switching to a real backend means replacing the
 * FakeWalletApi binding here and nothing else.
 *
 * A function, not a `val`: Koin keeps `single` instances on the Module object, so a
 * shared module would leak one store across every "isolated" PocketlyCore.
 */
internal fun coreModule(initialDataset: DatasetConfig) = module {
    single { TimeZoneHolder() }
    single<TransactionStore> { InMemoryTransactionStore() }
    single { FakeWalletApi(get(), get()) } binds arrayOf(WalletApi::class, FakeBackendControls::class)
    single { TransactionIngestor(get()) }
    single {
        PocketlyCore(api = get(), backend = get(), store = get(), ingestor = get(), timeZone = get(), initialDataset = initialDataset)
    }
}
