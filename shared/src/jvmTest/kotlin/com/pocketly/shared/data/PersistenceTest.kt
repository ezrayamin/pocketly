package com.pocketly.shared.data

import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

/** FR-FAKE-07 + FR-HIST-04 on real files. Mirrors core-js/__tests__/persistence.test.ts. */
class PersistenceTest {
    @Test
    fun serverStateCountersAndReplicaPersist() = runTest {
        val dir = Files.createTempDirectory("pocketly-").toFile().apply { deleteOnExit() }
        val drivers = { JvmDatabaseDrivers(dir.resolve("server.db").path, dir.resolve("cache.db").path) }

        val first = PocketlyCore.create(drivers(), MemorySecureStore(), DatasetConfig.DEFAULT)
        first.resetData(DatasetConfig.DEFAULT)
        first.simulateIncomingTransfer()
        assertEquals("sim-000001", first.getTransactions(null, 20, null).items.first().id)

        val second = PocketlyCore.create(drivers(), MemorySecureStore(), DatasetConfig.DEFAULT.copy(seed = 999)) // ignored: not empty
        second.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, failureRatePercent = 0))
        val offline = second.getTransactions(null, 20, null)
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, offline.stale?.reason)
        assertEquals("sim-000001", offline.items.first().id)

        second.setNetworkSimulation(NetworkSimulation.NORMAL)
        assertEquals("sim-000002", second.simulateIncomingTransfer().id)
        assertEquals(listOf("sim-000002", "sim-000001"), second.getTransactions(null, 20, null).items.take(2).map { it.id })
    }
}
