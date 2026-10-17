package com.pocketly.shared.bridge.di

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.CacheStore
import com.pocketly.shared.data.TimeZoneHolder
import com.pocketly.shared.data.TimeoutWalletApi
import com.pocketly.shared.data.WalletApi
import com.pocketly.shared.data.db.DatabaseDrivers
import com.pocketly.shared.data.fake.FakeWalletApi
import com.pocketly.shared.data.fake.ServerStore
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.security.BiometricAuthenticator
import com.pocketly.shared.security.InstallMarker
import com.pocketly.shared.security.PinAuthenticator
import kotlinx.coroutines.CoroutineDispatcher
import org.koin.dsl.module

/**
 * Composition root (NFR-ARCH-03). Switching to a real backend means replacing the
 * FakeWalletApi binding here and nothing else.
 *
 * A function, not a `val`: Koin keeps `single` instances on the Module object, so a
 * shared module would leak one store across every "isolated" PocketlyCore.
 */
internal fun coreModule(
    drivers: DatabaseDrivers,
    initialDataset: DatasetConfig,
    db: CoroutineDispatcher,
    pin: (InstallMarker) -> PinAuthenticator,
    biometric: (PinAuthenticator) -> BiometricAuthenticator,
    /** The device clock (or a test clock) for the fake server's OTP side (ADR-0013). */
    clock: () -> Long,
) = module {
    single { TimeZoneHolder() }
    // ADR-0009: two databases, two files. Only the fake backend touches the server's.
    single { FakeWalletApi(ServerStore(drivers.server()), get(), clock) }
    single { CacheStore(drivers.cache()) }
    // NFR-REL-01: the core only talks to the backend through a timeout.
    single<WalletApi> {
        val backend = get<FakeWalletApi>()
        TimeoutWalletApi(backend) { backend.networkSimulation.readTimeoutMs.toLong() }
    }
    single {
        PocketlyCore(api = get(), backend = get(), cache = get(), timeZone = get(), initialDataset = initialDataset, db = db, pin = pin, biometric = biometric)
    }
}
