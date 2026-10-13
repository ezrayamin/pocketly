package com.pocketly.shared.contract

import com.pocketly.shared.bridge.PocketlyCore
import com.pocketly.shared.domain.OtpVerifyOutcome
import com.pocketly.shared.security.PhonePolicy

/** Tests only (ADR-0013): setPin needs a phone verified by OTP first. Mirrors core-contract/src/testing/onboarding.ts. */
const val TEST_PHONE = "+6281234567890"

suspend fun PocketlyCore.verifyTestPhone(phone: String = TEST_PHONE) {
    requestOtp(phone)
    val result = verifyOtp(phone, PhonePolicy.FAKE_OTP_CODE)
    check(result.outcome == OtpVerifyOutcome.VERIFIED) { "test phone not verified: ${result.outcome}" }
}
