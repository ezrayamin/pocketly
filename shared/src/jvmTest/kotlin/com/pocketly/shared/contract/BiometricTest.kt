package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.BiometricEnableOutcome
import com.pocketly.shared.domain.BiometricEnableResult
import com.pocketly.shared.domain.BiometricKind
import com.pocketly.shared.domain.BiometricPromptText
import com.pocketly.shared.domain.BiometricStatus
import com.pocketly.shared.domain.BiometricUnavailableReason
import com.pocketly.shared.domain.BiometricUnlockOutcome
import com.pocketly.shared.domain.BiometricUnlockResult
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.security.BiometricMessages
import com.pocketly.shared.security.FakeBiometricSigner
import com.pocketly.shared.security.FakeBiometricSigner.Scan
import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.security.PhonePolicy
import com.pocketly.shared.security.PinPolicy
import com.pocketly.shared.security.platformPinCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** ADR-0012. Same cases as packages/core-js/__tests__/biometric.test.ts. */
class BiometricTest {
    private val bio = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "biometric.json").readText(),
    ).jsonObject

    private lateinit var signer: FakeBiometricSigner
    private var now = 1_790_856_000_000L
    private lateinit var core: PocketlyCore

    @OptIn(ExperimentalCoroutinesApi::class)
    @BeforeTest
    fun setUp() = runTest {
        signer = FakeBiometricSigner()
        now = 1_790_856_000_000L
        core = PocketlyCore.create(
            JvmDatabaseDrivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), MemorySecureStore(),
            clock = { now }, pinIterations = 1000, biometricSigner = signer,
        )
        core.verifyTestPhone()
        core.setPin(GOOD)
    }

    private suspend fun enable() = assertEquals(BiometricEnableResult(BiometricEnableOutcome.ENABLED), core.enableBiometrics(GOOD, PROMPT))

    private fun String.hex() = hexToByteArray()

    // ── fixtures/biometric.json ────────────────────────────────────────────

    @Test
    fun messagesByteForByte() {
        val unlock = bio["unlock"]!!.jsonObject
        assertEquals(unlock["message"]!!.jsonPrimitive.content, BiometricMessages.unlock(unlock["nonceHex"]!!.jsonPrimitive.content))
        val t = bio["transfer"]!!.jsonObject
        assertEquals(
            t["message"]!!.jsonPrimitive.content,
            BiometricMessages.transfer(t["amount"]!!.jsonPrimitive.long, t["recipientId"]!!.jsonPrimitive.content, t["idempotencyKey"]!!.jsonPrimitive.content),
        )
        for (bad in bio["invalidTransfers"]!!.jsonArray.map { it.jsonObject }) {
            val e = assertFailsWith<CoreException>(bad["why"]!!.jsonPrimitive.content) {
                BiometricMessages.transfer(bad["amount"]!!.jsonPrimitive.long, bad["recipientId"]!!.jsonPrimitive.content, bad["idempotencyKey"]!!.jsonPrimitive.content)
            }
            assertEquals(ErrorCode.INVALID_ARGUMENT, e.code)
        }
        assertEquals(bio["params"]!!.jsonObject["challengeTtlMs"]!!.jsonPrimitive.long, BiometricMessages.CHALLENGE_TTL_MS)
    }

    @Test
    fun fixtureSignatures() {
        val crypto = platformPinCrypto()
        val key = bio["publicKeyHex"]!!.jsonPrimitive.content.hex()
        for (name in listOf("unlock", "transfer")) {
            val v = bio[name]!!.jsonObject
            assertTrue(crypto.verifyP256(key, v["message"]!!.jsonPrimitive.content.encodeToByteArray(), v["signatureHex"]!!.jsonPrimitive.content.hex()), name)
        }
        for (r in bio["rejected"]!!.jsonArray.map { it.jsonObject }) {
            assertFalse(
                crypto.verifyP256(key, r["message"]!!.jsonPrimitive.content.encodeToByteArray(), r["signatureHex"]!!.jsonPrimitive.content.hex()),
                r["why"]!!.jsonPrimitive.content,
            )
        }
    }

    // ── biometric unlock ───────────────────────────────────────────────────

    @Test
    fun startsOffAndReportsTheHardware() = runTest {
        assertEquals(BiometricStatus(true, null, BiometricKind.FINGERPRINT, false), core.getBiometricStatus())
        signer.hardwareState = signer.hardwareState.copy(available = false, reason = BiometricUnavailableReason.NOT_STRONG, kind = null)
        assertEquals(BiometricStatus(false, BiometricUnavailableReason.NOT_STRONG, null, false), core.getBiometricStatus())
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.unlockWithBiometrics(PROMPT) }.code)
    }

    @Test
    fun enablingChecksThePinFirst() = runTest {
        assertEquals(BiometricEnableResult(BiometricEnableOutcome.WRONG_PIN, attemptsLeft = PinPolicy.MAX_ATTEMPTS - 1), core.enableBiometrics(WRONG, PROMPT))
        assertEquals(1, core.getAuthState().failedAttempts)
        assertFalse(signer.hasKey)
        assertFalse(core.getBiometricStatus().enabled)
    }

    @Test
    fun enablingNeedsAStrongBiometric() = runTest {
        signer.hardwareState = signer.hardwareState.copy(available = false, reason = BiometricUnavailableReason.NOT_ENROLLED)
        assertEquals(BiometricEnableOutcome.NOT_AVAILABLE, core.enableBiometrics(GOOD, PROMPT).outcome)
    }

    @Test
    fun enablingIsConfirmedByOneScan() = runTest {
        signer.scans += Scan.CANCEL
        assertEquals(BiometricEnableOutcome.CANCELLED, core.enableBiometrics(GOOD, PROMPT).outcome)
        assertFalse(signer.hasKey)
        assertFalse(core.getBiometricStatus().enabled)
        enable()
        assertEquals(listOf(PROMPT, PROMPT), signer.prompts)
        assertTrue(core.getBiometricStatus().enabled)
    }

    @Test
    fun unlocksAndCancelOrLockoutChangeNothing() = runTest {
        enable()
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.UNLOCKED, false), core.unlockWithBiometrics(PROMPT))
        signer.scans += listOf(Scan.CANCEL, Scan.LOCKOUT)
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.CANCELLED, false), core.unlockWithBiometrics(PROMPT))
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.BIOMETRIC_LOCKED_OUT, false), core.unlockWithBiometrics(PROMPT))
        assertTrue(core.getBiometricStatus().enabled)
    }

    @Test
    fun temporarilyUnavailableKeepsTheKey() = runTest {
        enable()
        signer.scans += Scan.DEVICE_LOCKED
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.UNAVAILABLE, false), core.unlockWithBiometrics(PROMPT))
        assertTrue(signer.hasKey)
        assertTrue(core.getBiometricStatus().enabled)
        assertEquals(BiometricUnlockOutcome.UNLOCKED, core.unlockWithBiometrics(PROMPT).outcome)
    }

    @Test
    fun anInvalidatedKeyTurnsBiometricsOff() = runTest {
        enable()
        signer.scans += Scan.INVALIDATED
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.KEY_INVALIDATED, false), core.unlockWithBiometrics(PROMPT))
        assertFalse(signer.hasKey)
        assertFalse(core.getBiometricStatus().enabled)
        assertEquals(BiometricEnableOutcome.WRONG_PIN, core.enableBiometrics(WRONG, PROMPT).outcome)
        enable()
    }

    @Test
    fun rejectsAReplayedSignature() = runTest {
        enable()
        assertEquals(BiometricUnlockOutcome.UNLOCKED, core.unlockWithBiometrics(PROMPT).outcome)
        signer.scans += Scan.REPLAY
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.FAILED, false), core.unlockWithBiometrics(PROMPT))
        assertFalse(core.getBiometricStatus().enabled)
    }

    @Test
    fun rejectsAnotherKeysSignature() = runTest {
        enable()
        signer.scans += Scan.OTHER_KEY
        assertEquals(BiometricUnlockOutcome.FAILED, core.unlockWithBiometrics(PROMPT).outcome)
        assertFalse(core.getBiometricStatus().enabled)
    }

    @Test
    fun rejectsAnExpiredAnswerButStaysOn() = runTest {
        enable()
        signer.duringPrompt = { now += BiometricMessages.CHALLENGE_TTL_MS + 1 }
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.FAILED, false), core.unlockWithBiometrics(PROMPT))
        assertTrue(core.getBiometricStatus().enabled)
    }

    @Test
    fun unlocksDuringAPinLockoutWithoutTouchingIt() = runTest {
        enable()
        repeat(PinPolicy.MAX_ATTEMPTS) { core.verifyPin(WRONG) }
        val before = core.getAuthState()
        assertNotNull(before.lockedUntil)
        assertEquals(BiometricUnlockResult(BiometricUnlockOutcome.UNLOCKED, pinLockedOut = true), core.unlockWithBiometrics(PROMPT))
        assertEquals(before, core.getAuthState())
    }

    @Test
    fun resetAuthAndDisableDeleteTheKey() = runTest {
        enable()
        core.resetAuth()
        assertFalse(signer.hasKey)
        assertFalse(core.getBiometricStatus().enabled)
        now += PhonePolicy.OTP_RESEND_MS // a new code is only sent once the last one is 30 s old
        core.verifyTestPhone()
        core.setPin(GOOD)
        enable()
        core.disableBiometrics()
        assertFalse(signer.hasKey)
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.unlockWithBiometrics(PROMPT) }.code)
    }

    private companion object {
        const val GOOD = "482915"
        const val WRONG = "731048"
        val PROMPT = BiometricPromptText("Unlock Pocketly", null, "Use PIN")
    }
}
