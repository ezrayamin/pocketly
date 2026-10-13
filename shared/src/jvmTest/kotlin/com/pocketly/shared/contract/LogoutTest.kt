package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.UnlockOutcome
import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.security.PinPolicy
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** NFR-SEC-05: the contract suite's "logout" block. */
class LogoutTest {
    private val allIds = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "golden.json").readText(),
    ).jsonObject["defaultDataset"]!!.jsonObject["allIds"]!!.jsonArray.map { it.jsonPrimitive.content }

    private lateinit var core: PocketlyCore

    @BeforeTest
    fun setUp() = runTest {
        core = PocketlyCore.create(JvmDatabaseDrivers(), MemorySecureStore())
        core.setTimeZone("UTC")
        core.resetData(DatasetConfig.DEFAULT)
        core.verifyTestPhone()
        core.setPin(PIN)
        core.getWallet()
        core.getTransactions(null, 20, null)
    }

    /** Nothing is cached: with the server out of reach, there is nothing to show. */
    private suspend fun assertReplicaEmpty() {
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, failureRatePercent = 0))
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, assertFailsWith<CoreException> { core.getWallet() }.code)
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, assertFailsWith<CoreException> { core.getTransactions(null, 20, null) }.code)
        assertEquals(0, core.computeSpendingSummary("2026-09").transactionCount)
        core.setNetworkSimulation(NetworkSimulation.NORMAL)
    }

    @Test
    fun clearsTheReplicaAndEverySecretTheServerKeepsTheAccount() = runTest {
        core.setAutoLockTimeout(5000)
        core.logout()
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), core.getAuthState())
        assertEquals(PinPolicy.DEFAULT_AUTO_LOCK_MS, core.getAutoLockTimeout())
        assertReplicaEmpty()
        // The next sync starts from scratch.
        val ids = mutableListOf<String>()
        var cursor: String? = null
        do {
            val page = core.getTransactions(cursor, 20, null)
            ids += page.items.map { it.id }
            cursor = page.nextCursor
        } while (cursor != null)
        assertEquals(allIds, ids)
    }

    @Test
    fun aSyncOrFetchStillInFlightWritesNothingAfterwards() = runTest {
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.NORMAL, failureRatePercent = 0, normalLatencyMs = 200))
        coroutineScope {
            // UNDISPATCHED: both reach the core before logout does.
            val page = async(start = CoroutineStart.UNDISPATCHED) { core.getTransactions(null, 20, null) }
            val wallet = async(start = CoroutineStart.UNDISPATCHED) { core.getWallet() }
            core.logout()
            // They still answer the caller; the cleared replica just isn't refilled.
            assertTrue(page.await().items.isEmpty())
            wallet.await()
        }
        assertReplicaEmpty()
    }

    @Test
    fun theNextPersonCanOnboardOnTheSameInstall() = runTest {
        val nextPhone = "+6285712345678"
        core.logout()
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.setPin(PIN) }.code)
        core.verifyTestPhone(nextPhone)
        core.setPin("731048")
        assertEquals(AuthState(pinSet = true, failedAttempts = 0, phone = nextPhone), core.getAuthState())
        assertEquals(UnlockOutcome.UNLOCKED, core.verifyPin("731048").outcome)
    }

    private companion object {
        const val PIN = "482915"
    }
}
