package com.pocketly.shared.security

import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.UnlockOutcome
import com.pocketly.shared.domain.UnlockResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Mirrors packages/core-js/__tests__/pinAuth.test.ts ("PinAuth"). */
class PinAuthenticatorTest {
    private class MemoryMarker(var id: String? = null) : InstallMarker {
        override suspend fun get() = id
        override suspend fun set(id: String) {
            this.id = id
        }
    }

    private var now = 1_790_856_000_000L

    /** A PinAuthenticator whose install has a verified phone, unless [verified] is false (setPin needs one, ADR-0013). */
    private suspend fun auth(
        store: MemorySecureStore,
        marker: MemoryMarker,
        crypto: PinCrypto = platformPinCrypto(),
        iterations: Int = FAST,
        verified: Boolean = true,
    ) = PinAuthenticator(store, crypto, marker, Dispatchers.Default, { now }, iterations).also {
        if (verified) it.rememberVerifiedPhone(PHONE, "token")
    }

    private val dying = object : PinCrypto by platformPinCrypto() {
        override fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int, keyLength: Int): ByteArray =
            throw IllegalStateException("process killed")
    }

    @Test
    fun storesOnlyASaltedRecordWithAFreshSalt() = runTest {
        val store = MemorySecureStore()
        val auth = auth(store, MemoryMarker())
        auth.setPin(GOOD)
        val first = store.values[PinAuthenticator.KEY_PIN]!!
        auth.setPin(GOOD)
        val second = store.values[PinAuthenticator.KEY_PIN]!!
        store.values.values.forEach { assertTrue(GOOD !in it) }
        assertNotEquals(PinRecord.decode(first)!!.salt.toHexString(), PinRecord.decode(second)!!.salt.toHexString())
    }

    @Test
    fun theCounterSurvivesARestart() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        val auth = auth(store, marker)
        auth.setPin(GOOD)
        auth.verifyPin(WRONG)
        auth.verifyPin(WRONG)
        assertEquals(AuthState(pinSet = true, failedAttempts = 2, phone = PHONE), auth(store, marker).getAuthState())
    }

    @Test
    fun dyingMidHashStillCostsAnAttempt() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        val auth = auth(store, marker)
        auth.setPin(GOOD)
        assertFailsWith<IllegalStateException> { auth(store, marker, dying).verifyPin(GOOD) }
        assertEquals(AuthState(pinSet = true, failedAttempts = 1, phone = PHONE), auth.getAuthState())
    }

    @Test
    fun dyingMidHashOnTheLastAttemptKeepsTheLockout() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        val auth = auth(store, marker)
        auth.setPin(GOOD)
        repeat(PinPolicy.MAX_ATTEMPTS - 1) { auth.verifyPin(WRONG) }
        assertFailsWith<IllegalStateException> { auth(store, marker, dying).verifyPin(GOOD) }
        assertNotNull(auth.getAuthState().lockedUntil)
    }

    @Test
    fun aLockoutEndsAndGivesFreshAttempts() = runTest {
        val auth = auth(MemorySecureStore(), MemoryMarker())
        auth.setPin(GOOD)
        repeat(PinPolicy.MAX_ATTEMPTS) { auth.verifyPin(WRONG) }
        val until = now + PinPolicy.LOCKOUT_MS
        now += PinPolicy.LOCKOUT_MS - 1
        assertEquals(UnlockResult(UnlockOutcome.LOCKED_OUT, 0, until), auth.verifyPin(GOOD))
        now += 1
        assertEquals(AuthState(pinSet = true, failedAttempts = 0, phone = PHONE), auth.getAuthState())
        assertEquals(UnlockResult(UnlockOutcome.WRONG_PIN, PinPolicy.MAX_ATTEMPTS - 1), auth.verifyPin(WRONG))
        assertEquals(UnlockOutcome.UNLOCKED, auth.verifyPin(GOOD).outcome)
    }

    @Test
    fun concurrentWrongAttemptsAreAllCounted() = runTest {
        val auth = auth(MemorySecureStore(), MemoryMarker())
        auth.setPin(GOOD)
        val left = List(3) { async { auth.verifyPin(WRONG).attemptsLeft } }.awaitAll()
        assertEquals(listOf(2, 3, 4), left.sorted())
    }

    @Test
    fun reHashesWithTheCurrentWorkFactorAfterAnUnlock() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        auth(store, marker, iterations = FAST).setPin(GOOD)
        val upgraded = auth(store, marker, iterations = 2 * FAST)
        assertEquals(UnlockOutcome.UNLOCKED, upgraded.verifyPin(GOOD).outcome)
        assertEquals(2 * FAST, PinRecord.decode(store.values[PinAuthenticator.KEY_PIN]!!)!!.iterations)
        assertEquals(UnlockOutcome.UNLOCKED, upgraded.verifyPin(GOOD).outcome)
    }

    @Test
    fun anUnreadableRecordWipesTheSecrets() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        auth(store, marker).setPin(GOOD)
        store.values[PinAuthenticator.KEY_PIN] = """{"v":99}"""
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), auth(store, marker).getAuthState())
        assertEquals(listOf(PinAuthenticator.KEY_INSTALL_ID), store.values.keys.toList())
    }

    @Test
    fun anUnreadableCounterFailsClosed() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        auth(store, marker).setPin(GOOD)
        store.values[PinAuthenticator.KEY_LOCKOUT] = "garbage"
        assertEquals(UnlockResult(UnlockOutcome.LOCKED_OUT, 0, now + PinPolicy.LOCKOUT_MS), auth(store, marker).verifyPin(GOOD))
    }

    @Test
    fun aCounterMissingWhileAPinIsSetFailsClosed() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        auth(store, marker).setPin(GOOD)
        store.values.remove(PinAuthenticator.KEY_LOCKOUT)
        assertEquals(AuthState(pinSet = true, failedAttempts = 0, lockedUntil = now + PinPolicy.LOCKOUT_MS, phone = PHONE), auth(store, marker).getAuthState())
    }

    @Test
    fun aFreshInstallWipesSecretsItFinds() = runTest {
        val store = MemorySecureStore()
        store.values[PinAuthenticator.KEY_PIN] = RECORD
        store.values[PinAuthenticator.KEY_INSTALL_ID] = "old-install"
        val marker = MemoryMarker(null)
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), auth(store, marker, verified = false).getAuthState())
        assertTrue(Regex("^[0-9a-f]{32}$").matches(marker.id!!))
        assertEquals(marker.id, store.values[PinAuthenticator.KEY_INSTALL_ID])
    }

    @Test
    fun secretsFromAnotherInstallAreWiped() = runTest {
        val store = MemorySecureStore()
        store.values[PinAuthenticator.KEY_PIN] = RECORD
        store.values[PinAuthenticator.KEY_INSTALL_ID] = "old-install"
        assertEquals(false, auth(store, MemoryMarker("new-install"), verified = false).getAuthState().pinSet)
        assertEquals("new-install", store.values[PinAuthenticator.KEY_INSTALL_ID])
    }

    @Test
    fun theSameInstallKeepsItsSecrets() = runTest {
        val store = MemorySecureStore()
        val marker = MemoryMarker()
        auth(store, marker).setPin(GOOD)
        assertEquals(true, auth(store, marker).getAuthState().pinSet)
    }

    private companion object {
        const val PHONE = "+6281234567890"
        const val GOOD = "482915"
        const val WRONG = "731048"
        const val FAST = 1000
        const val RECORD = """{"v":1,"iterations":1000,"salt":"000102030405060708090a0b0c0d0e0f","hash":"457849cec2fbbef4ff72b363da5f883a0384c67cd642c67f74ca85fc3cc48a83"}"""
    }
}
