package com.pocketly.shared.data.fake

import com.pocketly.shared.data.ServerOtpVerify
import com.pocketly.shared.domain.OtpSendOutcome
import com.pocketly.shared.domain.OtpSendResult
import com.pocketly.shared.domain.OtpVerifyOutcome
import com.pocketly.shared.domain.OtpVerifyResult
import com.pocketly.shared.security.PhonePolicy

/**
 * The fake server's OTP side (FR-AUTH-02, ADR-0013). The code is always FAKE_OTP_CODE; the
 * server counts wrong codes per phone (OTP_MAX_ATTEMPTS → OTP_COOLDOWN_MS cooldown), refuses a
 * resend within OTP_RESEND_MS and expires codes after OTP_TTL_MS, as a real backend would. It
 * runs on the device clock (or a test clock), not the dataset's frozen one. Memory only: a
 * restarted app needs a new code. Mirrors packages/core-js/src/data/fake/otpServer.ts.
 */
internal class OtpServer(private val clock: () -> Long) {
    private class Pending(val sentAt: Long, var failed: Int, var cooldownUntil: Long, var live: Boolean)

    private val pending = HashMap<String, Pending>()
    private var issued = 0

    fun send(phone: String): OtpSendResult {
        val now = clock()
        val current = pending[phone]
        if (current != null && now - current.sentAt < PhonePolicy.OTP_RESEND_MS) {
            return OtpSendResult(OtpSendOutcome.TOO_SOON, current.sentAt + PhonePolicy.OTP_RESEND_MS)
        }
        // A new code: wrong attempts start over, a running cooldown doesn't.
        pending[phone] = Pending(now, failed = 0, cooldownUntil = current?.cooldownUntil ?: 0, live = true)
        return OtpSendResult(OtpSendOutcome.SENT, now + PhonePolicy.OTP_RESEND_MS)
    }

    fun verify(phone: String, code: String): ServerOtpVerify {
        val now = clock()
        val p = pending[phone]
        if (p == null || !p.live) return ServerOtpVerify(OtpVerifyResult(OtpVerifyOutcome.NO_CODE))
        if (p.cooldownUntil > now) return ServerOtpVerify(OtpVerifyResult(OtpVerifyOutcome.COOLDOWN, retryAt = p.cooldownUntil))
        if (now - p.sentAt > PhonePolicy.OTP_TTL_MS) {
            p.live = false
            return ServerOtpVerify(OtpVerifyResult(OtpVerifyOutcome.EXPIRED))
        }
        if (code != PhonePolicy.FAKE_OTP_CODE) {
            p.failed += 1
            if (p.failed >= PhonePolicy.OTP_MAX_ATTEMPTS) {
                p.failed = 0
                p.cooldownUntil = now + PhonePolicy.OTP_COOLDOWN_MS
                return ServerOtpVerify(OtpVerifyResult(OtpVerifyOutcome.COOLDOWN, retryAt = p.cooldownUntil))
            }
            return ServerOtpVerify(OtpVerifyResult(OtpVerifyOutcome.WRONG_CODE, attemptsLeft = PhonePolicy.OTP_MAX_ATTEMPTS - p.failed))
        }
        p.live = false
        issued += 1
        return ServerOtpVerify(OtpVerifyResult(OtpVerifyOutcome.VERIFIED), sessionToken = "fake-session-$issued-$now")
    }
}
