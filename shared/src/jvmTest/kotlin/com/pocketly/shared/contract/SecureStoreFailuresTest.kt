package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.UnlockOutcome
import com.pocketly.shared.security.FaultySecureStore
import com.pocketly.shared.security.PinAuthenticator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import java.io.File
import java.nio.file.Files
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * ADR-0010 §2.7: "can't read" isn't "corrupt". Temporarily unavailable → SECURE_STORAGE_UNAVAILABLE,
 * nothing wiped; permanently unreadable → onboarding restarts. Same cases as
 * packages/core-js/__tests__/secureStoreFailures.test.ts.
 */
class SecureStoreFailuresTest {
    private lateinit var dir: File
    private lateinit var store: FaultySecureStore

    /** A core on files, so a "restart" sees the same replica (and install id). */
    @OptIn(ExperimentalCoroutinesApi::class)
    private fun start() = PocketlyCore.create(
        JvmDatabaseDrivers(File(dir, "server.db").path, File(dir, "cache.db").path),
        DatasetConfig.DEFAULT,
        Dispatchers.Default.limitedParallelism(1),
        store,
        pinIterations = FAST,
    )

    private suspend fun assertUnavailable(block: suspend () -> Unit) =
        assertEquals(ErrorCode.SECURE_STORAGE_UNAVAILABLE, assertFailsWith<CoreException> { block() }.code)

    @BeforeTest
    fun setUp() = runTest {
        dir = Files.createTempDirectory("pocketly-store-").toFile()
        store = FaultySecureStore()
        val core = start()
        core.resetData(DatasetConfig.DEFAULT)
        core.setPin(GOOD)
    }

    @Test
    fun temporarilyUnavailableWipesNothing() = runTest {
        val core = start() // e.g. launched in the background before the user unlocks
        val before = LinkedHashMap(store.values)
        store.unavailable = true
        assertUnavailable { core.getAuthState() }
        assertUnavailable { core.verifyPin(GOOD) }
        assertUnavailable { core.setPin("135792") }
        assertEquals(before, store.values)

        store.unavailable = false // the user unlocked the phone
        assertEquals(AuthState(pinSet = true, failedAttempts = 0), core.getAuthState())
        assertEquals(UnlockOutcome.UNLOCKED, core.verifyPin(GOOD).outcome)
    }

    @Test
    fun aCounterWriteThatFailsNeverUnlocks() = runTest {
        val core = start()
        store.failingWrites += PinAuthenticator.KEY_LOCKOUT
        assertUnavailable { core.verifyPin(GOOD) }
        store.failingWrites.clear()
        assertEquals(AuthState(pinSet = true, failedAttempts = 0), core.getAuthState())
        assertEquals(UnlockOutcome.UNLOCKED, core.verifyPin(GOOD).outcome)
    }

    @Test
    fun aPermanentlyUnreadablePinRecordRestartsOnboarding() = runTest {
        store.unreadable += PinAuthenticator.KEY_PIN
        val core = start()
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), core.getAuthState())
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.verifyPin(GOOD) }.code)
    }

    @Test
    fun aPermanentlyUnreadableInstallIdWipesEverySecret() = runTest {
        store.unreadable += PinAuthenticator.KEY_INSTALL_ID
        val core = start()
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), core.getAuthState())
        assertEquals(listOf(PinAuthenticator.KEY_INSTALL_ID), store.values.keys.toList())
    }

    private companion object {
        const val GOOD = "482915"
        const val FAST = 1000
    }
}
