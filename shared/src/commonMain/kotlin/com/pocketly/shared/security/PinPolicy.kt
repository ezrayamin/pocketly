package com.pocketly.shared.security

import com.pocketly.shared.domain.PinCheck
import com.pocketly.shared.domain.PinRejectReason
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * FR-AUTH-03/05, FR-LOCK-04: the PIN parameters and the stored formats. Identical to
 * packages/core-contract/src/constants.ts and core-js/src/security/pinPolicy.ts
 * (fixtures/pin.json checks both).
 */
object PinPolicy {
    const val LENGTH = 6
    /** PBKDF2-HMAC-SHA256 work factor, OWASP's 2023 figure. */
    const val ITERATIONS = 600_000
    const val SALT_BYTES = 16
    const val HASH_BYTES = 32
    const val RECORD_VERSION = 1
    const val MAX_ATTEMPTS = 5
    const val LOCKOUT_MS = 5 * 60_000L

    /** ASCII digits only, exactly [LENGTH], not all one digit, not a straight run up or down. */
    fun check(pin: String): PinCheck {
        if (pin.any { it !in '0'..'9' }) return PinCheck(PinRejectReason.NOT_DIGITS)
        if (pin.length != LENGTH) return PinCheck(PinRejectReason.WRONG_LENGTH)
        val step = pin[1] - pin[0]
        val straight = step in -1..1 && (2 until pin.length).all { pin[it] - pin[it - 1] == step }
        return PinCheck(if (straight) PinRejectReason.TOO_SIMPLE else null)
    }

    /** PBKDF2-HMAC-SHA256 over the PIN's ASCII bytes. Both cores must agree byte for byte. */
    fun hash(crypto: PinCrypto, pin: String, salt: ByteArray, iterations: Int): ByteArray =
        crypto.pbkdf2Sha256(pin.encodeToByteArray(), salt, iterations, HASH_BYTES)
}

/** What secure storage holds for a PIN. Never the PIN itself (FR-AUTH-05). */
class PinRecord(val iterations: Int, val salt: ByteArray, val hash: ByteArray) {
    /** `{"v":1,"iterations":…,"salt":"<hex>","hash":"<hex>"}`, key order fixed (fixtures/pin.json). */
    fun encode(): String = buildJsonObject {
        put("v", PinPolicy.RECORD_VERSION)
        put("iterations", iterations)
        put("salt", salt.toHex())
        put("hash", hash.toHex())
    }.toString()

    companion object {
        /** null for anything this version can't verify against. */
        fun decode(encoded: String): PinRecord? {
            val o = parseObject(encoded) ?: return null
            if (o.number("v")?.intOrNull != PinPolicy.RECORD_VERSION) return null
            val iterations = o.number("iterations")?.intOrNull?.takeIf { it >= 1 } ?: return null
            val salt = o.hex("salt", PinPolicy.SALT_BYTES) ?: return null
            val hash = o.hex("hash", PinPolicy.HASH_BYTES) ?: return null
            return PinRecord(iterations, salt, hash)
        }
    }
}

/** The attempt counter (FR-LOCK-04), kept in secure storage so force-closing can't reset it. */
data class LockoutState(val failedAttempts: Int, /** 0 = no lockout. */ val lockedUntil: Long) {
    fun encode(): String = buildJsonObject {
        put("failedAttempts", failedAttempts)
        put("lockedUntil", lockedUntil)
    }.toString()

    companion object {
        val NONE = LockoutState(0, 0)

        fun decode(encoded: String): LockoutState? {
            val o = parseObject(encoded) ?: return null
            val failed = o.number("failedAttempts")?.intOrNull?.takeIf { it >= 0 } ?: return null
            val until = o.number("lockedUntil")?.longOrNull?.takeIf { it >= 0 } ?: return null
            return LockoutState(failed, until)
        }
    }
}

private fun parseObject(encoded: String): JsonObject? =
    try {
        Json.parseToJsonElement(encoded) as? JsonObject
    } catch (_: IllegalArgumentException) {
        null // kotlinx.serialization's JsonDecodingException
    }

private fun JsonObject.number(key: String): JsonPrimitive? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }

private val HEX = Regex("^[0-9a-f]*$")

private fun JsonObject.hex(key: String, bytes: Int): ByteArray? {
    val s = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    if (s.length != bytes * 2 || !HEX.matches(s)) return null
    return ByteArray(bytes) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}

internal fun ByteArray.toHex(): String = joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
