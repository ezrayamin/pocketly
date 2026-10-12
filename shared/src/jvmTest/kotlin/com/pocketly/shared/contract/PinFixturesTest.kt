package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.UnlockOutcome
import com.pocketly.shared.domain.UnlockResult
import com.pocketly.shared.security.LockoutState
import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.security.PinAuthenticator
import com.pocketly.shared.security.PinPolicy
import com.pocketly.shared.security.PinRecord
import com.pocketly.shared.security.platformPinCrypto
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * BM-PAR-01 for the PIN (ADR-0010): fixtures/pin.json, and the same flow as the "PIN and lockout"
 * block of packages/core-contract/src/testing/contractSuite.ts, against the facade the adapters call.
 */
class PinFixturesTest {
    private val pin = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "pin.json").readText(),
    ).jsonObject

    private lateinit var store: MemorySecureStore
    private lateinit var core: PocketlyCore

    @BeforeTest
    fun setUp() = runTest {
        store = MemorySecureStore()
        core = PocketlyCore.create(JvmDatabaseDrivers(), store)
        core.resetData(DatasetConfig.DEFAULT)
    }

    @Test
    fun parametersMatchTheFixture() {
        val p = pin["params"]!!.jsonObject
        assertEquals("PBKDF2-HMAC-SHA256", p["algorithm"]!!.jsonPrimitive.content)
        assertEquals(p["iterations"]!!.jsonPrimitive.int, PinPolicy.ITERATIONS)
        assertEquals(p["saltBytes"]!!.jsonPrimitive.int, PinPolicy.SALT_BYTES)
        assertEquals(p["hashBytes"]!!.jsonPrimitive.int, PinPolicy.HASH_BYTES)
        assertEquals(p["recordVersion"]!!.jsonPrimitive.int, PinPolicy.RECORD_VERSION)
        assertEquals(p["maxAttempts"]!!.jsonPrimitive.int, PinPolicy.MAX_ATTEMPTS)
        assertEquals(p["lockoutMs"]!!.jsonPrimitive.long, PinPolicy.LOCKOUT_MS)
    }

    @Test
    fun checkPin() {
        for (case in pin["check"]!!.jsonArray.map { it.jsonObject }) {
            val candidate = case["pin"]!!.jsonPrimitive.content
            val check = core.checkPin(candidate)
            assertEquals(case["ok"]!!.jsonPrimitive.boolean, check.ok, candidate)
            assertEquals(case["reason"]?.jsonPrimitive?.content, check.reason?.name, candidate)
        }
    }

    /** Same PIN, salt and iterations → same hash as core-js (and Node, and Python). */
    @Test
    fun pbkdf2Vectors() {
        for (case in pin["pbkdf2"]!!.jsonArray.map { it.jsonObject }) {
            val hash = PinPolicy.hash(
                platformPinCrypto(),
                case["pin"]!!.jsonPrimitive.content,
                case["saltHex"]!!.jsonPrimitive.content.hexToByteArray(),
                case["iterations"]!!.jsonPrimitive.int,
            )
            assertEquals(case["hashHex"]!!.jsonPrimitive.content, hash.toHexString(), case.toString())
        }
    }

    @Test
    fun recordEncoding() {
        val record = pin["record"]!!.jsonObject
        val v = pin["pbkdf2"]!!.jsonArray[3].jsonObject
        val encoded = record["encoded"]!!.jsonPrimitive.content
        val built = PinRecord(
            v["iterations"]!!.jsonPrimitive.int,
            v["saltHex"]!!.jsonPrimitive.content.hexToByteArray(),
            v["hashHex"]!!.jsonPrimitive.content.hexToByteArray(),
        )
        assertEquals(encoded, built.encode())
        assertEquals(encoded, assertNotNull(PinRecord.decode(encoded)).encode())
        for (bad in record["unreadable"]!!.jsonArray) assertNull(PinRecord.decode(bad.jsonPrimitive.content), bad.toString())
    }

    @Test
    fun fixtureRecordVerifiesAtTheProductionWorkFactor() = runTest {
        core.getAuthState() // binds the install id
        store.put(PinAuthenticator.KEY_PIN, pin["record"]!!.jsonObject["encoded"]!!.jsonPrimitive.content)
        store.put(PinAuthenticator.KEY_LOCKOUT, LockoutState.NONE.encode())
        assertEquals(UnlockOutcome.UNLOCKED, core.verifyPin(pin["record"]!!.jsonObject["pin"]!!.jsonPrimitive.content).outcome)
        assertEquals(UnlockOutcome.WRONG_PIN, core.verifyPin(GOOD).outcome)
    }

    // ── The contract suite's "PIN and lockout" block ───────────────────────

    @Test
    fun startsWithNoPin() = runTest {
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), core.getAuthState())
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.verifyPin(GOOD) }.code)
    }

    @Test
    fun refusedPinsAreInvalidArgument() = runTest {
        for (bad in listOf("123456", "000000", "12345", "12a456")) {
            assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { core.setPin(bad) }.code, bad)
        }
        assertEquals(false, core.getAuthState().pinSet)
    }

    @Test
    fun unlocksWithTheRightPinOnly() = runTest {
        core.setPin(GOOD)
        assertEquals(UnlockResult(UnlockOutcome.WRONG_PIN, 4), core.verifyPin(OTHER))
        assertEquals(UnlockResult(UnlockOutcome.WRONG_PIN, 3), core.verifyPin(OTHER))
        assertEquals(AuthState(pinSet = true, failedAttempts = 2), core.getAuthState())
        assertEquals(UnlockResult(UnlockOutcome.UNLOCKED, 5), core.verifyPin(GOOD))
        assertEquals(AuthState(pinSet = true, failedAttempts = 0), core.getAuthState())
    }

    @Test
    fun fiveWrongPinsLockOutEvenForTheRightPin() = runTest {
        core.setPin(GOOD)
        repeat(PinPolicy.MAX_ATTEMPTS - 1) { assertEquals(UnlockOutcome.WRONG_PIN, core.verifyPin(OTHER).outcome) }
        val before = System.currentTimeMillis()
        val locked = core.verifyPin(OTHER)
        assertEquals(UnlockOutcome.LOCKED_OUT, locked.outcome)
        assertEquals(0, locked.attemptsLeft)
        val until = assertNotNull(locked.lockedUntil)
        assertTrue(until >= before + PinPolicy.LOCKOUT_MS && until <= System.currentTimeMillis() + PinPolicy.LOCKOUT_MS)
        assertEquals(locked, core.verifyPin(GOOD))
        assertEquals(AuthState(pinSet = true, failedAttempts = 0, lockedUntil = until), core.getAuthState())
    }

    @Test
    fun setPinReplacesThePinAndClearsTheCounter() = runTest {
        core.setPin(GOOD)
        core.verifyPin(GOOD.reversed())
        core.setPin(OTHER)
        assertEquals(AuthState(pinSet = true, failedAttempts = 0), core.getAuthState())
        assertEquals(UnlockOutcome.WRONG_PIN, core.verifyPin(GOOD).outcome)
        assertEquals(UnlockOutcome.UNLOCKED, core.verifyPin(OTHER).outcome)
    }

    @Test
    fun resetAuthDeletesSecretsAndResetDataKeepsThem() = runTest {
        core.setPin(GOOD)
        core.verifyPin(OTHER)
        core.resetData(DatasetConfig.DEFAULT)
        assertEquals(AuthState(pinSet = true, failedAttempts = 1), core.getAuthState())
        core.resetAuth()
        assertEquals(AuthState(pinSet = false, failedAttempts = 0), core.getAuthState())
    }

    private companion object {
        const val GOOD = "482915"
        const val OTHER = "731048"
    }
}
