package com.pocketly.shared.security

import com.pocketly.shared.domain.PhoneCheck
import com.pocketly.shared.domain.PhoneRejectReason

/**
 * FR-AUTH-01/02, Indonesia (+62) mobile numbers only (ADR-0013). Identical to
 * packages/core-contract/src/constants.ts and core-js/src/security/phonePolicy.ts
 * (fixtures/phone.json checks both).
 */
object PhonePolicy {
    const val COUNTRY_CODE = "+62"
    const val MIN_DIGITS = 9
    const val MAX_DIGITS = 12
    const val OTP_LENGTH = 6
    const val FAKE_OTP_CODE = "123456"
    const val OTP_MAX_ATTEMPTS = 3
    const val OTP_COOLDOWN_MS = 30_000L
    const val OTP_RESEND_MS = 30_000L
    const val OTP_TTL_MS = 5 * 60_000L

    /** ASCII digits; one typed leading 0 is dropped; starts with 8; 9–12 digits. */
    fun check(nationalNumber: String): PhoneCheck {
        if (nationalNumber.any { it !in '0'..'9' }) return PhoneCheck(null, PhoneRejectReason.NOT_DIGITS)
        val n = nationalNumber.removePrefix("0")
        return when {
            n.isEmpty() -> PhoneCheck(null, PhoneRejectReason.TOO_SHORT)
            n[0] != '8' -> PhoneCheck(null, PhoneRejectReason.NOT_MOBILE)
            n.length < MIN_DIGITS -> PhoneCheck(null, PhoneRejectReason.TOO_SHORT)
            n.length > MAX_DIGITS -> PhoneCheck(null, PhoneRejectReason.TOO_LONG)
            else -> PhoneCheck("$COUNTRY_CODE$n", null)
        }
    }

    /** True for an E.164 number [check] would produce. */
    fun isValidE164(phone: String): Boolean {
        if (!phone.startsWith(COUNTRY_CODE)) return false
        val national = phone.removePrefix(COUNTRY_CODE)
        return !national.startsWith("0") && check(national).e164 == phone
    }

    fun isOtpCode(code: String): Boolean = code.length == OTP_LENGTH && code.all { it in '0'..'9' }
}
