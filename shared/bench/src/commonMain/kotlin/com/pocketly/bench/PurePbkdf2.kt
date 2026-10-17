package com.pocketly.bench

import com.pocketly.shared.domain.CoreException
import com.pocketly.shared.domain.ErrorCode
import org.kotlincrypto.macs.hmac.sha2.HmacSHA256

/**
 * BM-10 what-if (ADR-0010 §8): PBKDF2-HMAC-SHA256 in pure Kotlin, never used by the PIN. The HMAC
 * is KotlinCrypto's (pure Kotlin on every platform; on Android and the JVM it sits behind a
 * `javax.crypto.Mac` facade, but no platform provider does the hashing). Only the PBKDF2 loop
 * (RFC 8018, one 32-byte block) is ours. Mirrors packages/core-js-bench/src/purePbkdf2.ts.
 */
object PurePbkdf2 {
    /** Upper bound on iterations, so a typo can't hang the app for minutes. */
    const val MAX_ITERATIONS = 1_000_000

    private val ASCII = Regex("^[\\x20-\\x7e]*$")
    private val HEX = Regex("^(?:[0-9a-f]{2})*$")

    fun sha256Hex(password: String, saltHex: String, iterations: Int): String {
        if (!ASCII.matches(password)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "password must be printable ASCII")
        if (!HEX.matches(saltHex)) throw CoreException(ErrorCode.INVALID_ARGUMENT, "salt must be lowercase hex")
        if (iterations !in 1..MAX_ITERATIONS) {
            throw CoreException(ErrorCode.INVALID_ARGUMENT, "iterations must be 1..$MAX_ITERATIONS, got $iterations")
        }
        val salt = ByteArray(saltHex.length / 2) { saltHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        return sha256(password.encodeToByteArray(), salt, iterations).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    }

    /** T1 = U1 ^ … ^ Uc, U1 = HMAC(P, S || INT(1)), Ui = HMAC(P, Ui-1). Allocates nothing per iteration. */
    private fun sha256(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
        val mac = HmacSHA256(password)
        val u = ByteArray(32)
        mac.update(salt)
        mac.update(byteArrayOf(0, 0, 0, 1))
        mac.doFinalInto(u, 0)
        val t = u.copyOf()
        repeat(iterations - 1) {
            mac.update(u)
            mac.doFinalInto(u, 0)
            for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
        }
        return t
    }
}
