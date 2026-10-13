package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.data.db.JvmDatabaseDrivers
import com.pocketly.shared.domain.AuthState
import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.DatasetConfig
import com.pocketly.shared.domain.ErrorCode
import com.pocketly.shared.domain.NetworkMode
import com.pocketly.shared.domain.NetworkSimulation
import com.pocketly.shared.domain.OtpSendOutcome
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.OtpVerifyOutcome
import com.pocketly.shared.domain.OtpVerifyResult
import com.pocketly.shared.security.MemorySecureStore
import com.pocketly.shared.security.PhonePolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import kotlin.test.assertNull

/**
 * FR-AUTH-01/02 (ADR-0013): fixtures/phone.json, the contract suite's "phone and OTP" block, and
 * the timing cases of packages/core-js/__tests__/otp.test.ts, on a test clock.
 */
class OtpTest {
    private val phone = Json.parseToJsonElement(
        File(System.getProperty("pocketly.fixtures") ?: error("pocketly.fixtures not set"), "phone.json").readText(),
    ).jsonObject

    private var now = 1_790_856_000_000L
    private lateinit var core: PocketlyCore

    @OptIn(ExperimentalCoroutinesApi::class)
    @BeforeTest
    fun setUp() = runTest {
        now = 1_790_856_000_000L
        core = PocketlyCore.create(
            JvmDatabaseDrivers(), DatasetConfig.DEFAULT, Dispatchers.Default.limitedParallelism(1), MemorySecureStore(),
            clock = { now }, pinIterations = 1000,
        )
    }

    private suspend fun wrong() = core.verifyOtp(TEST_PHONE, "000000")

    @Test
    fun parametersMatchTheFixture() {
        val p = phone["params"]!!.jsonObject
        assertEquals(p["countryCode"]!!.jsonPrimitive.content, PhonePolicy.COUNTRY_CODE)
        assertEquals(p["minDigits"]!!.jsonPrimitive.int, PhonePolicy.MIN_DIGITS)
        assertEquals(p["maxDigits"]!!.jsonPrimitive.int, PhonePolicy.MAX_DIGITS)
        assertEquals(p["otpLength"]!!.jsonPrimitive.int, PhonePolicy.OTP_LENGTH)
        assertEquals(p["fakeCode"]!!.jsonPrimitive.content, PhonePolicy.FAKE_OTP_CODE)
        assertEquals(p["maxAttempts"]!!.jsonPrimitive.int, PhonePolicy.OTP_MAX_ATTEMPTS)
        assertEquals(p["cooldownMs"]!!.jsonPrimitive.long, PhonePolicy.OTP_COOLDOWN_MS)
        assertEquals(p["resendMs"]!!.jsonPrimitive.long, PhonePolicy.OTP_RESEND_MS)
        assertEquals(p["ttlMs"]!!.jsonPrimitive.long, PhonePolicy.OTP_TTL_MS)
    }

    @Test
    fun checkPhone() {
        for (case in phone["check"]!!.jsonArray.map { it.jsonObject }) {
            val input = case["input"]!!.jsonPrimitive.content
            val check = core.checkPhone(input)
            assertEquals(case["ok"]!!.jsonPrimitive.boolean, check.ok, input)
            assertEquals(case["e164"]?.jsonPrimitive?.content, check.e164, input)
            assertEquals(case["reason"]?.jsonPrimitive?.content, check.reason?.name, input)
        }
    }

    @Test
    fun refusesBadNumbersAndCodes() = runTest {
        for (bad in listOf("+62081234567890", "081234567890")) {
            assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { core.requestOtp(bad) }.code, bad)
        }
        assertEquals(ErrorCode.INVALID_ARGUMENT, assertFailsWith<CoreException> { core.verifyOtp(TEST_PHONE, "12345") }.code)
    }

    @Test
    fun noPinBeforeThePhoneIsVerified() = runTest {
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.setPin("482915") }.code)
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.NO_CODE), core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
    }

    @Test
    fun sendsRefusesAnEarlyResendAndVerifiesOnce() = runTest {
        val sent = core.requestOtp(TEST_PHONE)
        assertEquals(OtpSendResult(OtpSendOutcome.SENT, now + PhonePolicy.OTP_RESEND_MS), sent)
        assertEquals(OtpSendResult(OtpSendOutcome.TOO_SOON, sent.resendAt), core.requestOtp(TEST_PHONE))
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.VERIFIED), core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
        assertEquals(AuthState(pinSet = false, failedAttempts = 0, phone = TEST_PHONE), core.getAuthState())
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.NO_CODE), core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
        core.setPin("482915")
        assertEquals(true, core.getAuthState().pinSet)
    }

    @Test
    fun threeWrongCodesStartACooldownTheRightCodeDoesntSkip() = runTest {
        core.requestOtp(TEST_PHONE)
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.WRONG_CODE, attemptsLeft = 2), wrong())
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.WRONG_CODE, attemptsLeft = 1), wrong())
        val cooldown = wrong()
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.COOLDOWN, retryAt = now + PhonePolicy.OTP_COOLDOWN_MS), cooldown)
        assertEquals(cooldown, core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
        assertNull(core.getAuthState().phone)
        now += PhonePolicy.OTP_COOLDOWN_MS
        assertEquals(OtpVerifyOutcome.VERIFIED, core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE).outcome)
    }

    @Test
    fun resendIsAllowedAfterTheWindowAndANewCodeStartsTheCountOver() = runTest {
        core.requestOtp(TEST_PHONE)
        wrong()
        wrong()
        now += PhonePolicy.OTP_RESEND_MS - 1
        assertEquals(OtpSendOutcome.TOO_SOON, core.requestOtp(TEST_PHONE).outcome)
        now += 1
        assertEquals(OtpSendOutcome.SENT, core.requestOtp(TEST_PHONE).outcome)
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.WRONG_CODE, attemptsLeft = 2), wrong())
    }

    @Test
    fun aNewCodeDoesntEndARunningCooldown() = runTest {
        core.requestOtp(TEST_PHONE) // t = 0
        now += 20_000
        repeat(3) { wrong() } // cooldown until t = 50 s
        now += PhonePolicy.OTP_RESEND_MS - 20_000 // t = 30 s
        assertEquals(OtpSendOutcome.SENT, core.requestOtp(TEST_PHONE).outcome)
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.COOLDOWN, retryAt = now + 20_000), core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
    }

    @Test
    fun aCodeExpires() = runTest {
        core.requestOtp(TEST_PHONE)
        now += PhonePolicy.OTP_TTL_MS + 1
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.EXPIRED), core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
        assertEquals(OtpVerifyResult(OtpVerifyOutcome.NO_CODE), core.verifyOtp(TEST_PHONE, PhonePolicy.FAKE_OTP_CODE))
    }

    @Test
    fun resetAuthForgetsThePhoneAndOtpCallsUseTheNetwork() = runTest {
        core.verifyTestPhone()
        core.resetAuth()
        assertNull(core.getAuthState().phone)
        assertEquals(ErrorCode.NOT_FOUND, assertFailsWith<CoreException> { core.setPin("482915") }.code)
        core.setNetworkSimulation(NetworkSimulation(NetworkMode.OFFLINE, 0))
        assertEquals(ErrorCode.NETWORK_UNAVAILABLE, assertFailsWith<CoreException> { core.requestOtp(TEST_PHONE) }.code)
    }
}
